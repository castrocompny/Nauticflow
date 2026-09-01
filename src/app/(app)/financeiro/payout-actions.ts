"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/security-log";
import { getProfile } from "@/lib/profile";
import { PIX_KEY_TYPES, validatePixKey, type PixKeyType } from "@/lib/payout-accounts";

export type PayoutAccountDTO = {
  id: string;
  pixKeyType: PixKeyType;
  pixKeyMasked: string;
  status: string;
  verificationStatus: string;
  createdAt: string;
};

export type FinancialSummaryDTO = {
  blockedCents: number;
  availableCents: number;
  pendingWithdrawalCents: number;
  transferredCents: number;
  payout: PayoutAccountDTO | null;
};

// Shape cru devolvido por get_marketplace_financial_summary (migration
// 0054) -- o client de sessão não tem tipos gerados pra RPCs novas ainda,
// então o resultado precisa de um cast explícito (mesmo padrão já usado em
// PaymentRpcRow na rota de pagamento do marketplace).
type FinancialSummaryRpcRow = {
  blocked_balance_cents: number | null;
  available_balance_cents: number | null;
  pending_withdrawal_cents: number | null;
  transferred_cents: number | null;
  payout_pix_key_type: PixKeyType | null;
  payout_pix_key_masked: string | null;
  payout_status: string | null;
  payout_verification_status: string | null;
};

// Cliente da SESSÃO do usuário (nunca admin/service_role) -- as RPCs desta
// etapa (migration 0054) são `authenticated`-scoped de propósito: derivam
// company_id/role de auth.uid() por dentro, então precisam rodar com a
// sessão real do operador, não com um cliente que já bypassa RLS/identidade.
export async function getFinancialSummary(): Promise<FinancialSummaryDTO | { error: string }> {
  const supabase = createClient();
  const { data: rawData, error } = await supabase.rpc("get_marketplace_financial_summary").maybeSingle();
  const data = rawData as FinancialSummaryRpcRow | null;

  if (error) {
    console.error("getFinancialSummary:", error);
    return { error: "Não foi possível carregar o resumo financeiro." };
  }
  if (!data) return { error: "Não foi possível carregar o resumo financeiro." };

  return {
    blockedCents: data.blocked_balance_cents ?? 0,
    availableCents: data.available_balance_cents ?? 0,
    pendingWithdrawalCents: data.pending_withdrawal_cents ?? 0,
    transferredCents: data.transferred_cents ?? 0,
    payout: data.payout_pix_key_type
      ? {
          id: "", // não exposto pelo resumo -- só type/masked/status importam pra UI
          pixKeyType: data.payout_pix_key_type,
          pixKeyMasked: data.payout_pix_key_masked ?? "",
          status: data.payout_status ?? "",
          verificationStatus: data.payout_verification_status ?? "unverified",
          createdAt: "",
        }
      : null,
  };
}

type SetPayoutAccountState = { error: string; ok?: boolean };

export async function setPayoutAccount(_prev: SetPayoutAccountState, formData: FormData): Promise<SetPayoutAccountState> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  // mesmo corte da RPC (defesa em profundidade -- a RPC recusa de qualquer
  // jeito, mas dar o erro certo aqui evita uma viagem desnecessária).
  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { error: "Você não tem permissão para alterar a conta de recebimento." };
  }

  const rawType = String(formData.get("pix_key_type") || "");
  const rawValue = String(formData.get("pix_key_value") || "");

  if (!PIX_KEY_TYPES.includes(rawType as PixKeyType)) {
    return { error: "Tipo de chave inválido." };
  }
  const type = rawType as PixKeyType;

  const validation = validatePixKey(type, rawValue);
  if (!validation.valid) return { error: validation.error };

  const supabase = createClient();
  const { error } = await supabase.rpc("set_marketplace_payout_account", {
    p_pix_key_type: type,
    p_pix_key_normalized: validation.normalized,
  });

  if (error) {
    if (error.message.includes("FORBIDDEN")) return { error: "Você não tem permissão para alterar a conta de recebimento." };
    if (error.message.includes("INVALID_PIX_KEY")) return { error: "Chave Pix inválida." };
    console.error("setPayoutAccount:", error);
    return { error: "Não foi possível salvar a chave Pix. Tente novamente." };
  }

  // log de segurança -- alteração sensível (destino de saque). NUNCA a chave
  // completa, só o tipo e a empresa -- mesmo contrato de logSecurityEvent já
  // usado no resto do projeto (só ids/enums de baixa cardinalidade em extra,
  // nunca segredo/PII).
  logSecurityEvent("marketplace_payout_account_changed", { companyId: profile.company_id, pixKeyType: type });

  revalidatePath("/financeiro");
  return { error: "", ok: true };
}
