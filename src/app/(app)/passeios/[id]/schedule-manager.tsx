"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveRecurringSchedule, pauseRecurringSchedule, reactivateRecurringSchedule, createOneOffDepartureForTour } from "./schedule-actions";
import type { TourScheduleRule, Vessel } from "@/lib/types";

type ScheduleActionResult = Awaited<ReturnType<typeof saveRecurringSchedule>>;

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function ScheduleManager({
  tourId,
  vessels,
  rule,
  upcomingCount,
}: {
  tourId: string;
  vessels: Vessel[];
  rule: TourScheduleRule | null;
  upcomingCount: number;
}) {
  const [mode, setMode] = useState<"recurring" | "specific">("recurring");
  const [times, setTimes] = useState<string[]>(rule?.times ?? ["10:00"]);
  const [useCustomPrice, setUseCustomPrice] = useState(rule?.price_cents_override != null);

  const [recurringState, recurringAction] = useActionState(
    async (_prev: ScheduleActionResult, formData: FormData) => saveRecurringSchedule(tourId, _prev, formData),
    { error: "" }
  );
  const [oneOffState, oneOffAction] = useActionState(
    async (_prev: { error: string; ok?: boolean }, formData: FormData) => createOneOffDepartureForTour(tourId, _prev, formData),
    { error: "" }
  );

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h3 className="mb-1 font-display font-semibold text-heading">Agenda e disponibilidade</h3>
      <div className="mb-4">
        <p className="text-xs text-muted">
          {upcomingCount > 0
            ? `${upcomingCount} saída${upcomingCount === 1 ? "" : "s"} futura${upcomingCount === 1 ? "" : "s"} agendada${upcomingCount === 1 ? "" : "s"}.`
            : "Nenhuma saída futura ainda -- escolha quando esse passeio acontece."}
        </p>
        {rule && !rule.active && <p className="text-xs font-medium text-amber-700">Agenda automática pausada.</p>}
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("recurring")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            mode === "recurring" ? "bg-brand text-white" : "border border-line text-muted hover:text-body"
          }`}
        >
          Recorrente
        </button>
        <button
          type="button"
          onClick={() => setMode("specific")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            mode === "specific" ? "bg-brand text-white" : "border border-line text-muted hover:text-body"
          }`}
        >
          Datas específicas
        </button>
      </div>

      {mode === "recurring" && (
        <form action={recurringAction} className="space-y-3">
          {recurringState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{recurringState.error}</p>}
          {recurringState.ok && <ScheduleResultSummary result={recurringState} savedLabel="Agenda salva" />}

          <div>
            <label>Dias da semana</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DAY_LABELS.map((label, day) => (
                <label key={day} className="flex cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand/10">
                  <input type="checkbox" name="days_of_week" value={day} defaultChecked={rule?.days_of_week.includes(day) ?? false} className="accent-brand" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label>Horários</label>
            <div className="mt-1 space-y-1.5">
              {times.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    name="times"
                    value={t}
                    onChange={(e) => setTimes((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                  />
                  {times.length > 1 && (
                    <button type="button" onClick={() => setTimes((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs text-muted hover:text-red-600">
                      remover
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setTimes((prev) => [...prev, "10:00"])} className="text-xs font-medium text-brand hover:underline">
                + Adicionar horário
              </button>
            </div>
          </div>

          <div>
            <label>Embarcação</label>
            <select name="vessel_id" defaultValue={rule?.vessel_id ?? vessels[0]?.id ?? ""} className="mt-1" disabled={vessels.length === 0}>
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.commercial_capacity} lugares)
                </option>
              ))}
            </select>
            {vessels.length === 0 && <p className="mt-1 text-xs text-muted">Cadastre uma embarcação antes de configurar a agenda.</p>}
          </div>

          <div>
            <p className="text-sm text-body">
              Preço: <strong>usa o preço do passeio</strong> por padrão.
            </p>
            <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" name="use_custom_price" checked={useCustomPrice} onChange={(e) => setUseCustomPrice(e.target.checked)} className="accent-brand" />
              Usar preço diferente para esta agenda
            </label>
            {useCustomPrice && (
              <input
                name="price_cents_override"
                type="number"
                step="0.01"
                min="0"
                placeholder="Preço desta agenda (R$)"
                defaultValue={rule?.price_cents_override != null ? (rule.price_cents_override / 100).toFixed(2) : ""}
                className="mt-1.5"
              />
            )}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Opções avançadas</summary>
            <div className="mt-2 space-y-2">
              <div>
                <label>Capacidade personalizada (opcional)</label>
                <input name="capacity_override" type="number" min="1" defaultValue={rule?.capacity_override ?? ""} placeholder="Usar capacidade comercial da embarcação" className="mt-1" />
              </div>
            </div>
          </details>

          <div>
            <label>Disponibilidade futura</label>
            <select name="horizon_days" defaultValue={rule?.horizon_days ?? 90} className="mt-1">
              <option value={30}>30 dias</option>
              <option value={60}>60 dias</option>
              <option value={90}>90 dias</option>
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="auto_extend" defaultChecked={rule?.auto_extend ?? true} className="accent-brand" />
            Manter sempre os próximos dias disponíveis automaticamente
          </label>

          <div className="flex items-center gap-3">
            <SaveButton label="Salvar agenda" pendingLabel="Salvando..." />
            {rule?.active && <PauseButton tourId={tourId} />}
            {rule && !rule.active && <ReactivateButton tourId={tourId} />}
          </div>
        </form>
      )}

      {mode === "specific" && (
        <form action={oneOffAction} className="space-y-3">
          {oneOffState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{oneOffState.error}</p>}
          {oneOffState.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Data adicionada.</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label>Data</label>
              <input name="date" type="date" required className="mt-1" />
            </div>
            <div>
              <label>Hora</label>
              <input name="time" type="time" required className="mt-1" />
            </div>
            <div>
              <label>Embarcação</label>
              <select name="vessel_id" defaultValue={vessels[0]?.id ?? ""} className="mt-1" disabled={vessels.length === 0}>
                {vessels.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Capacidade (opcional)</label>
              <input name="capacity" type="number" min="1" placeholder="Capacidade comercial" className="mt-1" />
            </div>
          </div>
          <div>
            <label>Preço para esta data (opcional, R$)</label>
            <input name="price_cents" type="number" step="0.01" min="0" placeholder="Usar preço do passeio" className="mt-1" />
          </div>
          <SaveButton label="+ Adicionar data" pendingLabel="Adicionando..." />
        </form>
      )}
    </div>
  );
}

// Mensagem humana pós-ação -- nunca expõe "departure"/"schedule_rule" pro
// operador, só o resultado em termos de saídas.
function ScheduleResultSummary({ result, savedLabel }: { result: ScheduleActionResult; savedLabel: string }) {
  const parts: string[] = [];
  if (result.generated) parts.push(`${result.generated} nova(s) saída(s) gerada(s)`);
  if (result.updated) parts.push(`${result.updated} atualizada(s) para a nova configuração`);
  if (result.removed) parts.push(`${result.removed} removida(s) (não fazem mais parte da agenda, sem reserva)`);
  if (result.protected) parts.push(`${result.protected} preservada(s) por ter reserva`);
  if (result.conflicts) parts.push(`${result.conflicts} horário(s) não criado(s) porque a embarcação já tinha outra saída`);

  return (
    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
      {savedLabel}
      {parts.length > 0 ? ` -- ${parts.join(", ")}.` : "."}
    </p>
  );
}

function PauseButton({ tourId }: { tourId: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ScheduleActionResult | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setResult(await pauseRecurringSchedule(tourId));
          setPending(false);
        }}
        className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
      >
        {pending ? "Pausando..." : "Pausar agenda automática"}
      </button>
      {result?.ok && <ScheduleResultSummary result={result} savedLabel="Agenda pausada" />}
      {result?.error && <p className="mt-1 text-xs text-red-700">{result.error}</p>}
    </div>
  );
}

function ReactivateButton({ tourId }: { tourId: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ScheduleActionResult | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setResult(await reactivateRecurringSchedule(tourId));
          setPending(false);
        }}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-body transition hover:border-brand disabled:opacity-60"
      >
        {pending ? "Reativando..." : "Reativar agenda automática"}
      </button>
      {result?.ok && <ScheduleResultSummary result={result} savedLabel="Agenda reativada" />}
      {result?.error && <p className="mt-1 text-xs text-red-700">{result.error}</p>}
    </div>
  );
}
