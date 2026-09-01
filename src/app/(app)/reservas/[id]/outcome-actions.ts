"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/security-log";
import { getProfile } from "@/lib/profile";

export type ReservationOutcome = "completed" | "no_show";

type SetOutcomeResult = { error: string; ok?: boolean };

// Cliente da SESSÃO (nunca admin) -- set_marketplace_reservation_outcome
// (migration 0055) é `authenticated`-scoped de propósito, deriva company_id/
// role de auth.uid() por dentro, mesmo modelo de confiança das RPCs de
// payout (0054).
export async function setReservationOutcome(reservationId: string, outcome: ReservationOutcome): Promise<SetOutcomeResult> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const supabase = createClient();
  const { data, error } = await supabase
    .rpc("set_marketplace_reservation_outcome", { p_reservation_id: reservationId, p_outcome: outcome })
    .maybeSingle();

  if (error) {
    if (error.message.includes("OUTCOME_TOO_EARLY")) {
      // tentativa de marcar completed/no_show antes da saída acontecer --
      // sinal de possível tentativa de acelerar o relógio financeiro, nunca
      // PII no evento.
      logSecurityEvent("marketplace_outcome_too_early", { companyId: profile.company_id, reservationId, outcome });
      return { error: "Ainda não é possível marcar este resultado -- a saída ainda não aconteceu." };
    }
    if (error.message.includes("FORBIDDEN_OUTCOME_OVERRIDE")) {
      logSecurityEvent("marketplace_outcome_override_denied", { companyId: profile.company_id, reservationId, outcome });
      return { error: "Este resultado já foi definido antes -- só um administrador do sistema pode corrigir." };
    }
    if (error.message.includes("BOOKING_NOT_CONFIRMED")) return { error: "Só é possível marcar resultado em reservas confirmadas." };
    console.error("setReservationOutcome:", error);
    return { error: "Não foi possível salvar o resultado. Tente novamente." };
  }

  const row = data as { id: string; outcome: string; is_override: boolean } | null;
  if (row?.is_override) {
    // super_admin corrigindo um outcome já definido -- sensível o
    // suficiente pra logar mesmo em caso de sucesso.
    logSecurityEvent("marketplace_outcome_overridden", { companyId: profile.company_id, reservationId, outcome });
  }

  revalidatePath(`/reservas/${reservationId}`);
  return { error: "", ok: true };
}

export type PaymentBreakdownDTO = {
  grossAmountCents: number;
  platformFeeCents: number;
  operatorAmountCents: number;
  status: string;
} | null;

// Detalhamento da venda (marketplace) -- só os snapshots JÁ congelados na
// confirmação (get_marketplace_payment_breakdown, migration 0057). Nunca
// recalcula com a comissão atual -- se a venda ainda não foi confirmada
// (sem gross_amount_cents), devolve null e a UI não mostra nada.
export async function getPaymentBreakdown(reservationId: string): Promise<PaymentBreakdownDTO> {
  const supabase = createClient();
  const { data, error } = await supabase
    .rpc("get_marketplace_payment_breakdown", { p_reservation_id: reservationId })
    .maybeSingle();

  if (error || !data) return null;

  const row = data as { gross_amount_cents: number | null; platform_fee_cents: number | null; operator_amount_cents: number | null; status: string };
  if (row.gross_amount_cents == null || row.platform_fee_cents == null || row.operator_amount_cents == null) return null;

  return {
    grossAmountCents: row.gross_amount_cents,
    platformFeeCents: row.platform_fee_cents,
    operatorAmountCents: row.operator_amount_cents,
    status: row.status,
  };
}
