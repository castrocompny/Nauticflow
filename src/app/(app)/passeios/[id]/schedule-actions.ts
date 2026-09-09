"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { createDeparture } from "../../saidas/actions";
import { validateRecurringScheduleInput, summarizeGenerateRows, resolveOneOffPriceReais, type GenerateRow } from "@/lib/tour-schedule";
import type { TourScheduleRule } from "@/lib/types";

type ActionResult = {
  error: string;
  ok?: boolean;
  generated?: number;
  conflicts?: number;
  removed?: number;
  updated?: number;
  protected?: number;
};

type ReconcileRow = { removed_count: number; updated_count: number; protected_count: number };

// Roda reconcile_departures_for_schedule_rule (0063) SEMPRE antes de
// generate_departures_for_schedule_rule -- primeiro reconcilia (remove/
// atualiza o que não bate mais com a regra ATUAL, protege o que tem reserva
// relevante), só depois gera as ocorrências que ainda faltam. As duas RPCs
// são service_role-only, chamadas via admin client depois que o chamador já
// confirmou (via RLS, client de sessão) que a regra pertence à empresa dele.
async function reconcileAndGenerate(
  admin: ReturnType<typeof createAdminClient>,
  scheduleRuleId: string
): Promise<{ generated: number; conflicts: number; removed: number; updated: number; protected: number }> {
  const { data: reconcileData, error: reconcileError } = await admin
    .rpc("reconcile_departures_for_schedule_rule", { p_schedule_rule_id: scheduleRuleId })
    .maybeSingle();
  if (reconcileError) console.error("reconcileAndGenerate/reconcile:", reconcileError);
  const reconcileRow = reconcileData as ReconcileRow | null;

  const { data: generateData, error: generateError } = await admin.rpc("generate_departures_for_schedule_rule", {
    p_schedule_rule_id: scheduleRuleId,
  });
  if (generateError) console.error("reconcileAndGenerate/generate:", generateError);
  const { generated, conflicts } = summarizeGenerateRows((generateData ?? []) as GenerateRow[]);

  return {
    generated,
    conflicts,
    removed: reconcileRow?.removed_count ?? 0,
    updated: reconcileRow?.updated_count ?? 0,
    protected: reconcileRow?.protected_count ?? 0,
  };
}

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

  // upsert no unique(tour_id) (migration 0063) -- garantia de UMA regra por
  // passeio é do BANCO, não de um SELECT-before-INSERT (que teria uma
  // corrida real entre duas chamadas concorrentes: as duas veriam "não
  // existe" e as duas tentariam INSERT). ON CONFLICT resolve atomicamente.
  const { data: ruleRow, error } = await supabase
    .from("tour_schedule_rules")
    .upsert(payload, { onConflict: "tour_id" })
    .select("id")
    .single();

  if (error) {
    if (error.message.includes("capacidade comercial")) return { error: error.message };
    if (error.message.includes("duplicados") || error.message.includes("08:00 e 19:00")) return { error: error.message };
    console.error("saveRecurringSchedule:", error);
    return { error: "Não foi possível salvar a agenda. Tente novamente." };
  }

  // regra salva -- reconcilia o que não bate mais com os parâmetros ATUAIS
  // (remove automáticas sem reserva relevante fora da nova regra, atualiza
  // preço/capacidade das que continuam válidas) e só então gera as
  // ocorrências que ainda faltam dentro do horizonte. Falha aqui nunca é
  // fatal -- a regra já foi salva, e tanto reconcile quanto generate são
  // idempotentes, podem ser tentados de novo num próximo save.
  const admin = createAdminClient();
  const result = await reconcileAndGenerate(admin, ruleRow!.id);

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "", ok: true, ...result };
}

export async function pauseRecurringSchedule(tourId: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  const supabase = createClient();
  const { data: rule, error } = await supabase
    .from("tour_schedule_rules")
    .update({ active: false })
    .eq("tour_id", tourId)
    .eq("company_id", profile.company_id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("pauseRecurringSchedule:", error);
    return { error: "Não foi possível pausar a agenda." };
  }
  if (!rule) return { error: "Agenda não encontrada." };

  // com a regra já inativa, reconcile trata todo slot como inválido --
  // remove as automáticas futuras sem reserva relevante (retira da
  // disponibilidade), preserva as que têm reserva. Nunca gera nada nova
  // (generate recusa regra inativa).
  const admin = createAdminClient();
  const { data: reconcileData, error: reconcileError } = await admin
    .rpc("reconcile_departures_for_schedule_rule", { p_schedule_rule_id: rule.id })
    .maybeSingle();
  if (reconcileError) console.error("pauseRecurringSchedule/reconcile:", reconcileError);
  const reconcileRow = reconcileData as ReconcileRow | null;

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  return {
    error: "",
    ok: true,
    removed: reconcileRow?.removed_count ?? 0,
    protected: reconcileRow?.protected_count ?? 0,
  };
}

// Reativa uma agenda pausada -- só gera as ocorrências faltantes dentro do
// horizonte (idempotente, nunca duplica); nada foi removido/alterado além
// do que reconcile já tinha feito na pausa, então não há nada a "restaurar".
export async function reactivateRecurringSchedule(tourId: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  const supabase = createClient();
  const { data: rule, error } = await supabase
    .from("tour_schedule_rules")
    .update({ active: true })
    .eq("tour_id", tourId)
    .eq("company_id", profile.company_id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("reactivateRecurringSchedule:", error);
    return { error: "Não foi possível reativar a agenda." };
  }
  if (!rule) return { error: "Agenda não encontrada." };

  const admin = createAdminClient();
  const result = await reconcileAndGenerate(admin, rule.id);

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "", ok: true, ...result };
}

// "Datas específicas" -- reaproveita createDeparture (src/app/(app)/saidas/actions.ts)
// direto, sem duplicar validação/insert -- só garante tour_id pré-preenchido
// e revalida a página do passeio também.
//
// Herança de preço (achado de hardening): createDeparture(), quando
// price_cents vem vazio, grava NULL -- correto pro contexto de /saidas
// (uso genérico, sem "preço do passeio" implícito na UX daquela tela), mas
// contradiz a UX aqui ("Preço opcional -- usar preço do passeio"). Resolvido
// SÓ nesta camada (nunca em createDeparture, que fica inalterado pra não
// mudar o comportamento existente de /saidas): se o campo vier vazio,
// resolve tours.base_price_cents no servidor (nunca confia no browser) e
// pré-preenche o formData ANTES de delegar -- a departure nasce com
// price_cents efetivo, porque departures.price_cents continua sendo a
// única fonte de verdade do marketplace (sem fallback pra tours em tempo de
// leitura).
export async function createOneOffDepartureForTour(tourId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  formData.set("tour_id", tourId);

  const priceRaw = String(formData.get("price_cents") || "");
  if (!priceRaw.trim()) {
    const profile = await getProfile();
    if (!profile?.company_id) return { error: "Sessão inválida." };
    const supabase = createClient();
    const { data: tour } = await supabase
      .from("tours")
      .select("base_price_cents")
      .eq("id", tourId)
      .eq("company_id", profile.company_id)
      .maybeSingle();
    if (tour) formData.set("price_cents", resolveOneOffPriceReais(priceRaw, tour.base_price_cents));
  }

  const result = await createDeparture(_prev, formData);
  if (!result.error) revalidatePath(`/passeios/${tourId}`);
  return result;
}
