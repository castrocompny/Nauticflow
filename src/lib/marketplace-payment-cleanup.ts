// Cleanup LAZY de cobranças Pix pending cujo hold já venceu -- sem
// infraestrutura de cron nesta fase (pedido explícito: "não criar
// infraestrutura de cron complexa agora"). Chamado a partir de pontos que
// já tocam o pagamento de qualquer forma: GET /bookings/[id] (status),
// POST /bookings/[id]/payment (quando uma tentativa anterior bloqueia uma
// nova). A mesma função funciona perfeitamente como corpo de um cron
// futuro -- só precisaria de uma lista de candidatos pra iterar, nunca
// precisaria mudar a lógica de decisão em si.
//
// RACE COM PAYMENT_RECEIVED (docs/adr/0007-...md): a segurança real contra
// cancelar um pagamento que acabou de ser recebido vive no banco
// (cancel_marketplace_pending_payment, migration 0060, UPDATE atômico com
// WHERE status='pending') e na consulta de status ao provider ANTES do
// DELETE (cancelMarketplacePendingPayment, src/lib/asaas.ts) -- esta
// função só ORQUESTRA os dois, nunca decide sozinha que algo foi recebido.
// Se o provider indicar que a cobrança já não está mais PENDING lá, esta
// função DELIBERADAMENTE não tenta reconciliar o pagamento como pago aqui
// -- só registra o achado (log seguro) e deixa pro webhook (autoridade
// financeira real) resolver, evitando duplicar a lógica de settlement em
// dois lugares.

import { createAdminClient } from "@/lib/supabase/admin";
import { cancelMarketplacePendingPayment } from "@/lib/asaas";
import { logSecurityEvent } from "@/lib/security-log";

export type CleanupOutcome = "not_applicable" | "cancelled" | "deferred" | "failed";

// admin: sempre o client service_role (nunca a sessão do operador -- este
// fluxo roda em rotas server-to-server do marketplace, nunca autenticado
// como um usuário do NauticFlow).
export async function attemptMarketplacePaymentCleanup(
  admin: ReturnType<typeof createAdminClient>,
  payment: { id: string; status: string; providerPaymentId: string | null }
): Promise<CleanupOutcome> {
  if (payment.status !== "pending") return "not_applicable";

  if (!payment.providerPaymentId) {
    // nunca chegou a criar cobrança no provider -- cancela só
    // internamente, direto, sem nenhuma chamada de rede.
    const { error } = await admin.rpc("cancel_marketplace_pending_payment", { p_payment_id: payment.id });
    if (error) {
      if (error.message.includes("HOLD_STILL_VALID")) return "not_applicable";
      logSecurityEvent("payment_cleanup_failed", { paymentId: payment.id });
      return "failed";
    }
    return "cancelled";
  }

  const result = await cancelMarketplacePendingPayment(payment.providerPaymentId);
  if (!result.ok) {
    logSecurityEvent("payment_cleanup_failed", { paymentId: payment.id });
    return "failed";
  }

  if (!result.data.cancelled) {
    // provider diz que não está mais removível -- pode já ter sido
    // recebida nesse meio tempo. NUNCA mexe no estado interno aqui --
    // registra pra observabilidade e deixa o webhook resolver de verdade.
    logSecurityEvent("payment_cleanup_deferred", { paymentId: payment.id, providerStatus: result.data.currentStatus ?? "unknown" });
    return "deferred";
  }

  const { error } = await admin.rpc("cancel_marketplace_pending_payment", { p_payment_id: payment.id });
  if (error) {
    if (error.message.includes("HOLD_STILL_VALID")) return "not_applicable";
    // cobrança já foi removida no provider, mas o banco não deixou marcar
    // (ex: PAYMENT_RECEIVED venceu a corrida entre o DELETE e este ponto)
    // -- nunca um erro real, o estado correto (paid) já está lá.
    logSecurityEvent("payment_cleanup_deferred", { paymentId: payment.id, providerStatus: "deleted_but_already_settled" });
    return "deferred";
  }
  return "cancelled";
}
