"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { createDeparture } from "../../saidas/actions";
import { validateRecurringScheduleInput } from "@/lib/tour-schedule";
import type { TourScheduleRule } from "@/lib/types";

type ActionResult = { error: string; ok?: boolean; generated?: number };

// Um passeio tem no máximo UMA regra recorrente ativa por vez (modelo
// simples pedido: "quando esse passeio acontece", não uma lista de agendas
// nomeadas) -- salvar de novo edita a existente, nunca cria uma segunda.
export async function getScheduleRule(tourId: string): Promise<TourScheduleRule | null> {
  const profile = await getProfile();
  if (!profile?.company_id) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("tour_schedule_rules")
    .select("*")
    .eq("tour_id", tourId)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  return (data as TourScheduleRule) ?? null;
}

// Cliente da SESSÃO (nunca admin) pra criar/editar a regra -- RLS
// (tour_schedule_rules, migration 0063) já garante que só a própria empresa
// mexe na própria regra, mesmo modelo de tours/departures/vessels. Depois de
// salvar, dispara a geração via admin client -- generate_departures_for_
// schedule_rule é service_role-only, chamada só DEPOIS que a regra já foi
// confirmada como dona da empresa certa pelo insert/update acima.
export async function saveRecurringSchedule(tourId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const validated = validateRecurringScheduleInput({
    vesselId: String(formData.get("vessel_id") || ""),
    daysOfWeek: formData.getAll("days_of_week").map(Number),
    times: formData.getAll("times").map(String),
    horizonDays: Number(formData.get("horizon_days") || 90),
    useCustomPrice: formData.get("use_custom_price") === "on",
    priceRaw: String(formData.get("price_cents_override") || "").trim(),
    capacityRaw: String(formData.get("capacity_override") || "").trim(),
  });
  if (!validated.ok) return { error: validated.error };
  const { vesselId, daysOfWeek, times, horizonDays, priceCentsOverride, capacityOverride } = validated.value;
  const autoExtend = formData.get("auto_extend") === "on";

  const supabase = createClient();
  const { data: vessel } = await supabase.from("vessels").select("company_id").eq("id", vesselId).maybeSingle();
  if (!vessel || vessel.company_id !== profile.company_id) return { error: "Embarcação inválida." };

  const { data: existing } = await supabase
    .from("tour_schedule_rules")
    .select("id")
    .eq("tour_id", tourId)
    .eq("company_id", profile.company_id)
    .maybeSingle();

  const payload = {
    company_id: profile.company_id,
    tour_id: tourId,
    vessel_id: vesselId,
    days_of_week: daysOfWeek,
    times,
    horizon_days: horizonDays,
    capacity_override: capacityOverride,
    price_cents_override: priceCentsOverride,
    auto_extend: autoExtend,
    active: true,
  };

  const { data: ruleRow, error } = existing
    ? await supabase.from("tour_schedule_rules").update(payload).eq("id", existing.id).select("id").single()
    : await supabase.from("tour_schedule_rules").insert(payload).select("id").single();

  if (error) {
    if (error.message.includes("capacidade comercial")) return { error: error.message };
    console.error("saveRecurringSchedule:", error);
    return { error: "Não foi possível salvar a agenda. Tente novamente." };
  }

  const admin = createAdminClient();
  const { data: generated, error: genError } = await admin.rpc("generate_departures_for_schedule_rule", {
    p_schedule_rule_id: ruleRow!.id,
  });
  if (genError) {
    console.error("saveRecurringSchedule/generate:", genError);
    // a regra já foi salva -- a geração pode ser tentada de novo (idempotente,
    // ver migration 0063), não é um erro fatal pro operador.
  }

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "", ok: true, generated: Array.isArray(generated) ? generated.length : 0 };
}

export async function pauseRecurringSchedule(tourId: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  const supabase = createClient();
  const { error } = await supabase
    .from("tour_schedule_rules")
    .update({ active: false })
    .eq("tour_id", tourId)
    .eq("company_id", profile.company_id);
  if (error) {
    console.error("pauseRecurringSchedule:", error);
    return { error: "Não foi possível pausar a agenda." };
  }
  revalidatePath(`/passeios/${tourId}`);
  return { error: "", ok: true };
}

// "Datas específicas" -- reaproveita createDeparture (src/app/(app)/saidas/actions.ts)
// direto, sem duplicar validação/insert -- só garante tour_id pré-preenchido
// e revalida a página do passeio também.
export async function createOneOffDepartureForTour(tourId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  formData.set("tour_id", tourId);
  const result = await createDeparture(_prev, formData);
  if (!result.error) revalidatePath(`/passeios/${tourId}`);
  return result;
}
