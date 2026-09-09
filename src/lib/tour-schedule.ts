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
