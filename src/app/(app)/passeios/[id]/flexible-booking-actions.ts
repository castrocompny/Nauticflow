"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Disponibilidade do privativo flexível (RPC save_flexible_booking_rule,
// migration 0073) -- mesma filosofia de saveRecurringSchedule
// (schedule-actions.ts): a REGRA de validação mora só no banco (constraints
// + triggers da tabela tour_flexible_booking_rules), aqui só parse de
// FormData + tradução de erro pra mensagem legível.
export async function saveFlexibleBookingRule(
  tourId: string,
  _prev: { error: string; ok?: boolean },
  formData: FormData
): Promise<{ error: string; ok?: boolean }> {
  const vesselId = String(formData.get("vessel_id") || "");
  if (!vesselId) return { error: "Selecione uma embarcação." };

  const daysOfWeek = formData.getAll("days_of_week").map(Number);
  if (daysOfWeek.length === 0) return { error: "Selecione ao menos um dia da semana." };

  const windowStart = String(formData.get("window_start") || "");
  const windowEnd = String(formData.get("window_end") || "");
  if (!windowStart || !windowEnd) return { error: "Informe a janela de funcionamento." };

  const minHours = Number(String(formData.get("min_duration_hours") || "0").replace(",", "."));
  const maxHours = Number(String(formData.get("max_duration_hours") || "0").replace(",", "."));
  if (!Number.isFinite(minHours) || minHours <= 0) return { error: "Duração mínima inválida." };
  if (!Number.isFinite(maxHours) || maxHours < minHours) return { error: "Duração máxima inválida (precisa ser maior ou igual à mínima)." };

  const slotInterval = Number(formData.get("slot_interval_minutes") || 30);
  const pricingMode = String(formData.get("pricing_mode") || "fixed");
  const hourlyRaw = String(formData.get("hourly_price_reais") || "").trim();
  const hourlyReais = hourlyRaw ? Number(hourlyRaw.replace(",", ".")) : null;
  if (pricingMode === "per_hour") {
    if (hourlyReais == null || !Number.isFinite(hourlyReais) || hourlyReais < 0) {
      return { error: "Informe o preço por hora." };
    }
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("save_flexible_booking_rule", {
    p_tour_id: tourId,
    p_vessel_id: vesselId,
    p_days_of_week: daysOfWeek,
    p_window_start: windowStart,
    p_window_end: windowEnd,
    p_min_duration_minutes: Math.round(minHours * 60),
    p_max_duration_minutes: Math.round(maxHours * 60),
    p_slot_interval_minutes: slotInterval,
    p_pricing_mode: pricingMode,
    p_hourly_price_cents: hourlyReais != null ? Math.round(hourlyReais * 100) : null,
  });

  if (error) {
    const msg = error.message;
    if (msg.includes("TOUR_NOT_FLEXIBLE") || msg.includes("TOUR_NOT_FOUND")) {
      return { error: "Este passeio não está configurado como horário flexível." };
    }
    if (msg.includes("VESSEL_NOT_FOUND")) return { error: "Embarcação inválida." };
    if (msg.includes("window_check")) return { error: "O horário de término deve ser depois do início." };
    if (msg.includes("min_duration_check")) return { error: "Duração mínima inválida." };
    if (msg.includes("max_duration_check")) return { error: "Duração máxima precisa ser maior ou igual à mínima." };
    if (msg.includes("hourly_price_required")) return { error: "Informe o preço por hora para o modo \"por hora\"." };
    if (msg.includes("days_")) return { error: "Dias da semana inválidos." };
    console.error("saveFlexibleBookingRule:", error);
    return { error: "Não foi possível salvar a disponibilidade. Verifique os valores e tente novamente." };
  }

  revalidatePath(`/passeios/${tourId}`);
  return { error: "", ok: true };
}

export async function setFlexibleBookingRuleActive(tourId: string, active: boolean): Promise<{ ok: boolean; error: string }> {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_flexible_booking_rule_active", { p_tour_id: tourId, p_active: active });
  if (error) {
    console.error("setFlexibleBookingRuleActive:", error);
    return { ok: false, error: "Não foi possível atualizar a disponibilidade." };
  }
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, error: "" };
}
