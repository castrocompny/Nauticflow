"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { logSecurityEvent } from "@/lib/security-log";
import { initiateMarketplacePaymentRefund } from "@/lib/asaas";

type InitiateRealRefundResult = { error: string; ok?: boolean; status?: string; refundId?: string };

type RefundRequestRow = { id: string; status: string; customer_refund_cents: number; operator_deduction_cents: number; is_replay: boolean };
type RefundProviderContextRow = {
  refund_id: string;
  refund_status: string;
  customer_refund_cents: number;
  provider_refund_id: string | null;
  payment_status: string;
  provider_payment_id: string | null;
};

// Dispara um reembolso REAL no Asaas pra uma reserva específica -- fecha o
// gap documentado no ADR 0007 ("nenhum provider refund real está ativado").
// Só super_admin: create_marketplace_refund_request (migration 0055) já
// autoriza company_admin normalmente pro pedido interno (reserva o efeito no
// ledger, sem tocar o provider) -- essa ação aqui é a camada SEGUINTE
// (chamar o Asaas de verdade), deliberadamente mais restrita, nunca exposta
// ao ToursFlow, nunca um endpoint público. idempotencyKey determinístico por
// reserva -- uma segunda chamada pra mesma reserva nunca cria um segundo
// pedido, sempre reconcilia o existente.
export async function initiateRealMarketplaceRefund(reservationId: string): Promise<InitiateRealRefundResult> {
  const profile = await getProfile();
  if (!profile || profile.role !== "super_admin") {
    return { error: "Apenas um administrador do sistema pode acionar um reembolso real." };
  }

  const supabase = createClient();
  const idempotencyKey = `real-refund-${reservationId}`;
  const { data: reqData, error: reqError } = await supabase
    .rpc("create_marketplace_refund_request", {
      p_reservation_id: reservationId,
      p_idempotency_key: idempotencyKey,
      p_reason_code: "admin_manual",
    })
    .maybeSingle();

  if (reqError) {
    if (reqError.message.includes("PAYMENT_NOT_PAID")) return { error: "Esta reserva não tem um pagamento pago para reembolsar." };
    if (reqError.message.includes("RESERVATION_OUTCOME_UNDETERMINED")) return { error: "O resultado da reserva ainda não foi definido." };
    if (reqError.message.includes("BOOKING_NOT_FOUND")) return { error: "Reserva não encontrada." };
    console.error("initiateRealMarketplaceRefund/create:", reqError);
    return { error: "Não foi possível criar o pedido de reembolso." };
  }

  const req = reqData as RefundRequestRow | null;
  if (!req) return { error: "Não foi possível criar o pedido de reembolso." };

  if (req.status === "manual_review") {
    return { error: "O pedido caiu em revisão manual (saldo insuficiente no bucket de origem) -- não é possível prosseguir automaticamente.", refundId: req.id };
  }
  if (req.status !== "pending") {
    // já processing/completed/failed -- replay seguro, nunca chama o
    // provider de novo.
    return { error: "", ok: true, status: req.status, refundId: req.id };
  }

  const admin = createAdminClient();
  const { data: ctxData, error: ctxError } = await admin
    .rpc("get_marketplace_refund_provider_context", { p_refund_id: req.id })
    .maybeSingle();

  if (ctxError || !ctxData) {
    console.error("initiateRealMarketplaceRefund/context:", ctxError);
    return { error: "Não foi possível carregar o contexto do reembolso.", refundId: req.id };
  }

  const ctx = ctxData as RefundProviderContextRow;
  if (ctx.payment_status !== "paid" || !ctx.provider_payment_id) {
    return { error: "Pagamento associado não está pago ou não tem identificador do provider.", refundId: req.id };
  }
  if (ctx.refund_status !== "pending") {
    // corrida com outra chamada concorrente -- o estado já avançou,
    // informa sem tentar de novo.
    return { error: "", ok: true, status: ctx.refund_status, refundId: req.id };
  }

  const result = await initiateMarketplacePaymentRefund({
    providerPaymentId: ctx.provider_payment_id,
    amountCents: ctx.customer_refund_cents,
  });

  if (!result.ok) {
    logSecurityEvent("marketplace_refund_provider_initiation_failed", { refundId: req.id, errorCode: result.error.slice(0, 64) });
    return { error: result.error, refundId: req.id };
  }

  await admin.rpc("mark_marketplace_refund_processing", {
    p_refund_id: req.id,
    p_provider_refund_id: result.data.providerRefundId,
  });

  logSecurityEvent("marketplace_refund_provider_initiated", { refundId: req.id });
  revalidatePath(`/reservas/${reservationId}`);
  return { error: "", ok: true, status: "processing", refundId: req.id };
}
