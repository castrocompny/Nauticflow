"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { createDeparture } from "../../saidas/actions";
import { validateRecurringScheduleInput, resolveOneOffPriceReais, interpretScheduleRpcResult, type ScheduleRpcRow } from "@/lib/tour-schedule";
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

// Cliente da SESSÃO (nunca admin) -- save_recurring_schedule (migration
// 0063, release candidate) é `authenticated`-scoped, deriva company_id de
// auth.uid() por dentro (mesmo modelo de create_marketplace_refund_
// request/request_marketplace_withdrawal), e faz upsert da regra + reconcile
// + generate numa ÚNICA transação -- nunca duas requests PostgREST
// separadas. Se qualquer parte falhar, a exception aborta tudo -- nunca
// existe "regra salva mas nunca reconciliada" (achado de hardening que
// motivou essa RPC única).
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
  const { data, error } = await supabase
    .rpc("save_recurring_schedule", {
      p_tour_id: tourId,
      p_vessel_id: vesselId,
      p_days_of_week: daysOfWeek,
      p_times: times,
      p_horizon_days: horizonDays,
      p_capacity_override: capacityOverride,
      p_price_cents_override: priceCentsOverride,
      p_auto_extend: autoExtend,
    })
    .maybeSingle();

  // falha em QUALQUER parte (upsert, reconcile, generate) -- transação
  // inteira revertida pelo banco (release candidate), nunca reporta
  // sucesso parcial. interpretScheduleRpcResult() (pura, testável) garante
  // isso também do lado TS -- nunca ok:true quando error existe.
  if (error) console.error("saveRecurringSchedule:", error);
  const outcome = interpretScheduleRpcResult(data as ScheduleRpcRow | null, error, "Não foi possível salvar a agenda. Tente novamente.");
  if (!outcome.ok) return { error: outcome.error };

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "", ...outcome };
}

// Configuração inicial simplificada (chamada logo depois de createTourDraft) --
// reúne num único passo o que hoje exige o operador entrar em "Preço" (TourForm)
// e DEPOIS em "Agenda e disponibilidade" (saveRecurringSchedule) separadamente.
// Reaproveita a MESMA validação e a MESMA RPC de saveRecurringSchedule -- nenhuma
// lógica nova, só um formulário menor com defaults fixos (capacity_override=null,
// price_cents_override=null, auto_extend=true, horizon_days=90) em vez de expor
// essas opções avançadas logo de cara. Depois deste passo, a tela normal de
// edição (ScheduleManager) assume, com a regra já criada, pra ajustes finos.
export async function quickSetupSchedule(tourId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const priceReais = Number(String(formData.get("base_price_cents") || "").replace(",", "."));
  if (!Number.isFinite(priceReais) || priceReais < 0) return { error: "Informe o preço-base do passeio." };

  const validated = validateRecurringScheduleInput({
    vesselId: String(formData.get("vessel_id") || ""),
    daysOfWeek: formData.getAll("days_of_week").map(Number),
    times: formData.getAll("times").map(String),
    horizonDays: 90,
    useCustomPrice: false,
    priceRaw: "",
    capacityRaw: "",
  });
  if (!validated.ok) return { error: validated.error };
  const { vesselId, daysOfWeek, times } = validated.value;

  const supabase = createClient();

  // preço-base do passeio -- mesmo UPDATE direto que updateTourFull faz (RLS
  // já restringe à própria empresa); dispara trg_tours_base_price_reconcile
  // (migration 0063), que é no-op aqui porque a regra recorrente ainda não
  // existe (nenhuma linha em tour_schedule_rules pra este tour ainda).
  const { error: priceError } = await supabase
    .from("tours")
    .update({ base_price_cents: Math.round(priceReais * 100) })
    .eq("id", tourId)
    .eq("company_id", profile.company_id);
  if (priceError) {
    console.error("quickSetupSchedule/price:", priceError);
    return { error: "Não foi possível salvar o preço-base. Tente novamente." };
  }

  const { data, error } = await supabase
    .rpc("save_recurring_schedule", {
      p_tour_id: tourId,
      p_vessel_id: vesselId,
      p_days_of_week: daysOfWeek,
      p_times: times,
      p_horizon_days: 90,
      p_capacity_override: null,
      p_price_cents_override: null,
      p_auto_extend: true,
    })
    .maybeSingle();

  if (error) console.error("quickSetupSchedule/rpc:", error);
  const outcome = interpretScheduleRpcResult(data as ScheduleRpcRow | null, error, "Não foi possível criar a agenda. Tente novamente.");
  if (!outcome.ok) return { error: outcome.error };

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "", ...outcome };
}

export async function pauseRecurringSchedule(tourId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("pause_recurring_schedule", { p_tour_id: tourId }).maybeSingle();

  // se reconcile falhar dentro da RPC, a exception reverte o active=false
  // junto -- nunca existe "pausada, mas saída antiga continua vendável".
  if (error) console.error("pauseRecurringSchedule:", error);
  const outcome = interpretScheduleRpcResult(data as ScheduleRpcRow | null, error, "Não foi possível pausar a agenda. Tente novamente.");
  if (!outcome.ok) return { error: outcome.error };

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  return { error: "", ok: true, removed: outcome.removed, protected: outcome.protected };
}

// Reativa uma agenda pausada -- reconcile+generate na mesma transação
// (mesma garantia de save_recurring_schedule).
export async function reactivateRecurringSchedule(tourId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reactivate_recurring_schedule", { p_tour_id: tourId }).maybeSingle();

  if (error) console.error("reactivateRecurringSchedule:", error);
  const outcome = interpretScheduleRpcResult(data as ScheduleRpcRow | null, error, "Não foi possível reativar a agenda. Tente novamente.");
  if (!outcome.ok) return { error: outcome.error };

  revalidatePath(`/passeios/${tourId}`);
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "", ...outcome };
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
