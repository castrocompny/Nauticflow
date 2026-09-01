"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security-log";
import { getProfile } from "@/lib/profile";
import { createMarketplacePixTransfer, isMarketplaceWithdrawalPayoutEnabled } from "@/lib/asaas";
import type { PixKeyType } from "@/lib/payout-accounts";

export type WithdrawalDTO = {
  id: string;
  amountCents: number;
  status: string;
  requestedAt: string;
  processedAt: string | null;
  payoutPixKeyType: PixKeyType | null;
  payoutPixKeyMasked: string | null;
  failureReasonSafe: string | null;
};

type CreateWithdrawalResult = { error: string; ok?: boolean; id?: string };

// Cliente da SESSÃO (nunca admin) pra criar o saque -- request_marketplace_
// withdrawal (migration 0056) é `authenticated`-scoped, deriva company_id/
// role de auth.uid() por dentro, mesmo modelo de payout accounts (0054) e
// outcome (0055).
export async function createWithdrawal(_prev: CreateWithdrawalResult, formData: FormData): Promise<CreateWithdrawalResult> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { error: "Você não tem permissão para solicitar saques." };
  }

  const amountReais = Number(formData.get("amount_reais"));
  if (!Number.isFinite(amountReais) || amountReais <= 0) {
    return { error: "Valor inválido." };
  }
  const amountCents = Math.round(amountReais * 100);

  const idempotencyKey = randomUUID();
  const supabase = createClient();
  const { data, error } = await supabase
    .rpc("request_marketplace_withdrawal", { p_amount_cents: amountCents, p_idempotency_key: idempotencyKey })
    .maybeSingle();

  if (error) {
    if (error.message.includes("PAYOUT_ACCOUNT_NOT_FOUND")) return { error: "Cadastre uma chave Pix antes de solicitar um saque." };
    if (error.message.includes("PAYOUT_ACCOUNT_NOT_VERIFIED")) return { error: "Sua chave Pix ainda não foi verificada -- não é possível sacar ainda." };
    if (error.message.includes("MANUAL_REVIEW_PENDING")) return { error: "Existe uma pendência financeira que precisa ser resolvida antes de um novo saque. Fale com o suporte." };
    if (error.message.includes("INSUFFICIENT_AVAILABLE_BALANCE")) return { error: "Saldo disponível insuficiente para este valor." };
    if (error.message.includes("INVALID_WITHDRAWAL_AMOUNT")) return { error: "Valor inválido." };
    console.error("createWithdrawal:", error);
    return { error: "Não foi possível solicitar o saque. Tente novamente." };
  }

  const row = data as { id: string; status: string; is_replay: boolean } | null;
  if (!row) return { error: "Não foi possível solicitar o saque. Tente novamente." };

  logSecurityEvent("marketplace_withdrawal_requested", { companyId: profile.company_id, withdrawalId: row.id, amountCents });

  // Dispara a transferência pro provider -- SEM bloquear a resposta ao
  // operador nela: a AUTORIDADE final de status é o webhook (ver
  // src/app/api/webhooks/asaas/route.ts), a resposta síncrona aqui só marca
  // 'processing' quando o provider aceitou a solicitação. Se
  // MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED estiver desligado (default), a
  // adapter recusa e o saque fica 'pending' -- nunca falha silenciosamente,
  // mas também não trava a criação do pedido em si.
  if (!row.is_replay && isMarketplaceWithdrawalPayoutEnabled()) {
    await dispatchWithdrawalToProvider(row.id);
  }

  revalidatePath("/financeiro");
  return { error: "", ok: true, id: row.id };
}

// Chamado logo após a criação (acima) e, no futuro, por um job de retry --
// usa o client ADMIN de propósito: resolver a chave Pix (crua, pra enviar
// ao provider) e marcar processing/failed são operações de BACKEND, nunca
// da sessão do operador (mesma separação de todo o resto do marketplace:
// service_role pra mutação financeira automatizada, authenticated só pra
// autoservice do próprio operador).
async function dispatchWithdrawalToProvider(withdrawalId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: w } = await admin
    .from("marketplace_withdrawals")
    .select("id, amount_cents, payout_account_id")
    .eq("id", withdrawalId)
    .maybeSingle();
  if (!w || !w.payout_account_id) return;

  // ÚNICO ponto do sistema que lê a chave Pix CRUA -- exclusivamente pra
  // repassar ao provider, nunca devolvida a nenhuma resposta de API/UI.
  // get_marketplace_payout_account_raw_for_transfer (migration 0056) é uma
  // exceção deliberada e estreita à decisão de 0054 ("nenhuma leitura crua,
  // nem pro backend") -- só existe pra este caminho específico.
  const { data: payout } = await admin.rpc("get_marketplace_payout_account_raw_for_transfer", {
    p_payout_account_id: w.payout_account_id,
  });
  const payoutRow = (Array.isArray(payout) ? payout[0] : payout) as { pix_key_type: PixKeyType; pix_key_normalized: string } | undefined;
  if (!payoutRow) return;

  const transferResult = await createMarketplacePixTransfer({
    withdrawalId: w.id,
    amountCents: w.amount_cents,
    pixKeyType: payoutRow.pix_key_type,
    pixKeyNormalized: payoutRow.pix_key_normalized,
  });

  if (transferResult.ok) {
    await admin.rpc("mark_marketplace_withdrawal_processing", {
      p_withdrawal_id: w.id,
      p_provider_transfer_id: transferResult.data.providerTransferId,
    });
  }
}

export async function listWithdrawals(): Promise<WithdrawalDTO[] | { error: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_marketplace_withdrawals", { p_limit: 20 });

  if (error) {
    console.error("listWithdrawals:", error);
    return { error: "Não foi possível carregar o histórico de saques." };
  }

  const rows = (data ?? []) as {
    id: string;
    amount_cents: number;
    status: string;
    requested_at: string;
    processed_at: string | null;
    payout_pix_key_type: PixKeyType | null;
    payout_pix_key_masked: string | null;
    failure_reason_safe: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amount_cents,
    status: r.status,
    requestedAt: r.requested_at,
    processedAt: r.processed_at,
    payoutPixKeyType: r.payout_pix_key_type,
    payoutPixKeyMasked: r.payout_pix_key_masked,
    failureReasonSafe: r.failure_reason_safe,
  }));
}
