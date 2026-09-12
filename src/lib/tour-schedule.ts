// Validação pura do input de "agenda recorrente" (migration 0063) -- separada
// do server action (que exige contexto de sessão Next.js) pra ser testável
// isoladamente. A geração de departures em si (dias/horários -> timestamps
// UTC, idempotência) fica inteiramente em SQL (generate_departures_for_
// schedule_rule) -- mesmo motivo de toda a geometria de capacidade/reserva
// deste projeto viver no banco: atomicidade real, ver ADR correspondente.
// Nenhuma duplicação da lógica de geração em TS -- só validação de input,
// que TEM um caller real (saveRecurringSchedule).

export type RecurringScheduleInput = {
  vesselId: string;
  daysOfWeek: number[];
  times: string[];
  horizonDays: number;
  useCustomPrice: boolean;
  priceRaw: string;
  capacityRaw: string;
};

export type RecurringScheduleValidated = {
  vesselId: string;
  daysOfWeek: number[];
  times: string[];
  horizonDays: number;
  priceCentsOverride: number | null;
  capacityOverride: number | null;
};

export type ValidationResult = { ok: true; value: RecurringScheduleValidated } | { ok: false; error: string };

const VALID_HORIZONS = [30, 60, 90];

export function validateRecurringScheduleInput(input: RecurringScheduleInput): ValidationResult {
  if (!input.vesselId) return { ok: false, error: "Selecione uma embarcação." };

  const daysOfWeek = [...new Set(input.daysOfWeek)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (daysOfWeek.length === 0) return { ok: false, error: "Selecione ao menos um dia da semana." };

  const times = [...new Set(input.times.filter(Boolean))];
  if (times.length === 0) return { ok: false, error: "Adicione ao menos um horário." };
  for (const t of times) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return { ok: false, error: `Horário inválido: ${t}.` };
  }

  if (!VALID_HORIZONS.includes(input.horizonDays)) return { ok: false, error: "Horizonte de disponibilidade inválido." };

  let priceCentsOverride: number | null = null;
  if (input.useCustomPrice) {
    const priceReais = input.priceRaw ? Number(input.priceRaw.replace(",", ".")) : NaN;
    if (!Number.isFinite(priceReais) || priceReais < 0) return { ok: false, error: "Preço personalizado inválido." };
    priceCentsOverride = Math.round(priceReais * 100);
  }

  let capacityOverride: number | null = null;
  if (input.capacityRaw) {
    const capacity = Number(input.capacityRaw);
    if (!Number.isInteger(capacity) || capacity <= 0) return { ok: false, error: "Capacidade personalizada inválida." };
    capacityOverride = capacity;
  }

  return {
    ok: true,
    value: { vesselId: input.vesselId, daysOfWeek, times, horizonDays: input.horizonDays, priceCentsOverride, capacityOverride },
  };
}

// Agrega o retorno de generate_departures_for_schedule_rule (0063) -- uma
// linha por slot TENTADO, was_conflict distinguindo sucesso de conflito real
// (o SQL já filtra bookkeeping normal da própria regra antes de marcar
// was_conflict=true, ver comentário na migration). Separado do server action
// pra ser testável sem mockar o client Supabase inteiro.
export type GenerateRow = { departure_id: string | null; departs_at: string; was_conflict: boolean };
export type GenerateSummary = { generated: number; conflicts: number };

export function summarizeGenerateRows(rows: GenerateRow[]): GenerateSummary {
  let generated = 0;
  let conflicts = 0;
  for (const row of rows) {
    if (row.was_conflict) conflicts++;
    else generated++;
  }
  return { generated, conflicts };
}

// Herança de preço pra "Datas específicas" (achado de hardening --
// createDeparture(), reaproveitada sem alteração, grava NULL quando o campo
// vem vazio; a UX aqui promete "opcional -- usa o preço do passeio"). Devolve
// a STRING em reais que createOneOffDepartureForTour injeta no formData
// antes de delegar -- nunca confia em preço vindo do browser: quando vazio,
// resolve a partir de base_price_cents, sempre lido do servidor.
export function resolveOneOffPriceReais(priceRaw: string, basePriceCents: number): string {
  const trimmed = priceRaw.trim();
  if (trimmed) return trimmed;
  return (basePriceCents / 100).toFixed(2);
}

// Interpreta o retorno de save_recurring_schedule/pause_recurring_schedule/
// reactivate_recurring_schedule (0063, release candidate) -- as três fazem
// upsert/update da regra + reconcile + generate numa ÚNICA transação
// atômica, então NÃO existe mais "reconcile falhou mas generate rodou" --
// qualquer erro da RPC, não importa qual passo interno falhou, significa que
// a transação inteira foi revertida pelo Postgres (nada foi salvo). Esta
// função só garante, do lado TS, que um erro NUNCA vira `ok: true` -- a
// garantia real de atomicidade é do banco, não testável nesta sessão sem
// Postgres disponível (ver DOCUMENTACAO.md).
export type ScheduleRpcRow = {
  schedule_rule_id: string;
  generated_count?: number;
  updated_count?: number;
  removed_count?: number;
  protected_count?: number;
  conflict_count?: number;
};
export type ScheduleRpcOutcome =
  | { ok: true; generated: number; conflicts: number; removed: number; updated: number; protected: number }
  | { ok: false; error: string };

export function interpretScheduleRpcResult(
  data: ScheduleRpcRow | null,
  error: { message: string } | null,
  fallbackError: string
): ScheduleRpcOutcome {
  if (error) {
    if (error.message.includes("capacidade comercial")) return { ok: false, error: error.message };
    // janela global 08:00-19:00 removida (migration 0073) -- só duplicata
    // de dias/horários continua sendo uma regra real aqui.
    if (error.message.includes("duplicados")) return { ok: false, error: error.message };
    if (error.message.includes("VESSEL_NOT_FOUND")) return { ok: false, error: "Embarcação inválida." };
    if (error.message.includes("TOUR_NOT_FOUND")) return { ok: false, error: "Passeio inválido." };
    if (error.message.includes("TOUR_NOT_FIXED_SCHEDULE")) {
      return { ok: false, error: "Este passeio está configurado como horário flexível -- a agenda recorrente é só para horários fixos." };
    }
    if (error.message.includes("SCHEDULE_RULE_NOT_FOUND")) return { ok: false, error: "Agenda não encontrada." };
    return { ok: false, error: fallbackError };
  }
  if (!data) return { ok: false, error: fallbackError };

  return {
    ok: true,
    generated: data.generated_count ?? 0,
    conflicts: data.conflict_count ?? 0,
    removed: data.removed_count ?? 0,
    updated: data.updated_count ?? 0,
    protected: data.protected_count ?? 0,
  };
}
