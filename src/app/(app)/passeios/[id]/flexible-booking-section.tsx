"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveFlexibleBookingRule, setFlexibleBookingRuleActive } from "./flexible-booking-actions";
import type { TourFlexibleBookingRule, Vessel } from "@/lib/types";

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar disponibilidade"}
    </button>
  );
}

// Configuração do modelo flexible_private (migration 0073) -- só aparece
// quando o passeio está nesse modelo (ver page.tsx). Substitui a agenda
// recorrente tradicional como configuração principal (pedido explícito,
// seção 7): embarcação, dias, janela de funcionamento, duração min/máx,
// intervalo de início e forma de precificar -- nunca a agenda recorrente,
// que pertence só a fixed_schedule (bloqueada no banco, ver 0073).
export function FlexibleBookingSection({
  tourId,
  vessels,
  rule,
}: {
  tourId: string;
  vessels: Vessel[];
  rule: TourFlexibleBookingRule | null;
}) {
  const [pricingMode, setPricingMode] = useState<"fixed" | "per_hour">(
    (rule?.pricing_mode as "fixed" | "per_hour") ?? "fixed"
  );
  const [state, action] = useActionState(
    async (_prev: { error: string; ok?: boolean }, formData: FormData) => saveFlexibleBookingRule(tourId, _prev, formData),
    { error: "" }
  );
  const [togglePending, setTogglePending] = useState(false);
  const [toggleResult, setToggleResult] = useState<{ ok: boolean; error: string } | null>(null);

  async function toggle(active: boolean) {
    setTogglePending(true);
    setToggleResult(await setFlexibleBookingRuleActive(tourId, active));
    setTogglePending(false);
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h3 className="mb-1 font-display font-semibold text-heading">Disponibilidade do passeio privativo</h3>
      <p className="mb-4 text-xs text-muted">
        {rule
          ? rule.active
            ? "Disponibilidade ativa -- o balcão já pode criar reservas privativas para este passeio."
            : "Disponibilidade pausada -- o balcão não consegue criar reservas até reativar."
          : "Configure a disponibilidade deste passeio privativo."}
      </p>

      <form action={action} className="space-y-3">
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
        {state.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Disponibilidade salva.</p>}

        <div>
          <label>Embarcação</label>
          <select name="vessel_id" defaultValue={rule?.vessel_id ?? vessels[0]?.id ?? ""} className="mt-1" disabled={vessels.length === 0}>
            {vessels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.commercial_capacity} lugares)
              </option>
            ))}
          </select>
          {vessels.length === 0 && (
            <p className="mt-1 text-xs text-muted">Cadastre uma embarcação antes de configurar a disponibilidade.</p>
          )}
        </div>

        <div>
          <label>Dias disponíveis</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {DAY_LABELS.map((label, day) => (
              <label
                key={day}
                className="flex cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand/10"
              >
                <input
                  type="checkbox"
                  name="days_of_week"
                  value={day}
                  defaultChecked={rule?.days_of_week.includes(day) ?? false}
                  className="accent-brand"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label>Janela de funcionamento</label>
          <div className="mt-1 flex items-center gap-2">
            <input name="window_start" type="time" required defaultValue={rule?.window_start.slice(0, 5) ?? "08:00"} />
            <span className="text-sm text-muted">até</span>
            <input name="window_end" type="time" required defaultValue={rule?.window_end.slice(0, 5) ?? "19:00"} />
          </div>
          <p className="mt-1 text-xs text-muted">
            Esses horários são configuráveis pelo operador -- não são uma regra global. Outro operador pode configurar, por
            exemplo, 06:00 até 22:00.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Duração mínima (horas)</label>
            <input
              name="min_duration_hours"
              type="number"
              min={0.5}
              step={0.5}
              required
              defaultValue={rule ? rule.min_duration_minutes / 60 : 2}
              className="mt-1"
            />
          </div>
          <div>
            <label>Duração máxima (horas)</label>
            <input
              name="max_duration_hours"
              type="number"
              min={0.5}
              step={0.5}
              required
              defaultValue={rule ? rule.max_duration_minutes / 60 : 8}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <label>Intervalos para início</label>
          <select name="slot_interval_minutes" defaultValue={rule?.slot_interval_minutes ?? 30} className="mt-1">
            <option value={15}>15 minutos</option>
            <option value={30}>30 minutos</option>
            <option value={60}>60 minutos</option>
          </select>
        </div>

        <div>
          <label>Como precificar</label>
          <select
            name="pricing_mode"
            value={pricingMode}
            onChange={(e) => setPricingMode(e.target.value as "fixed" | "per_hour")}
            className="mt-1"
          >
            <option value="fixed">Valor fixo (sugere o preço-base do passeio)</option>
            <option value="per_hour">Por hora (sugere preço/h × duração)</option>
          </select>
          {pricingMode === "per_hour" && (
            <input
              name="hourly_price_reais"
              type="number"
              min={0}
              step="0.01"
              required
              defaultValue={rule?.hourly_price_cents != null ? (rule.hourly_price_cents / 100).toFixed(2) : ""}
              placeholder="Preço por hora (R$)"
              className="mt-2"
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <SaveButton />
          {rule?.active && (
            <button
              type="button"
              disabled={togglePending}
              onClick={() => toggle(false)}
              className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
            >
              {togglePending ? "Pausando..." : "Pausar disponibilidade"}
            </button>
          )}
          {rule && !rule.active && (
            <button
              type="button"
              disabled={togglePending}
              onClick={() => toggle(true)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-body transition hover:border-brand disabled:opacity-60"
            >
              {togglePending ? "Reativando..." : "Reativar disponibilidade"}
            </button>
          )}
        </div>
        {toggleResult?.error && <p className="text-xs text-red-700">{toggleResult.error}</p>}
      </form>
    </div>
  );
}
