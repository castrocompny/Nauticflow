"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { quickSetupSchedule } from "./schedule-actions";
import type { Vessel } from "@/lib/types";

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Criando agenda..." : "Criar agenda e gerar saídas"}
    </button>
  );
}

// Passo único depois de nomear o passeio: embarcação + preço-base + dias +
// horários -- o mínimo pra já existir saída vendável. Defaults fixos (nunca
// pedidos aqui): capacidade = capacidade comercial da embarcação (sem
// override), preço da saída = preço-base informado (sem override),
// auto_extend=true, horizon_days=90 -- ver quickSetupSchedule. Sem "datas
// específicas"/opções avançadas aqui -- isso tudo continua disponível em
// Agenda e disponibilidade depois que a regra existir.
export function QuickScheduleSetup({
  tourId,
  vessels,
  tourBasePriceCents,
  onSkip,
}: {
  tourId: string;
  vessels: Vessel[];
  tourBasePriceCents: number;
  onSkip: () => void;
}) {
  const [times, setTimes] = useState<string[]>(["10:00"]);
  const [state, action] = useActionState(
    async (_prev: Awaited<ReturnType<typeof quickSetupSchedule>>, formData: FormData) => quickSetupSchedule(tourId, _prev, formData),
    { error: "" }
  );

  return (
    <div className="rounded-card border border-brand/30 bg-brand/5 p-5">
      <h3 className="mb-1 font-display font-semibold text-heading">Configure a agenda deste passeio</h3>
      <p className="mb-4 text-xs text-muted">
        Escolha embarcação, preço, dias e horários -- as saídas são criadas automaticamente, sem precisar cadastrar uma por uma.
      </p>

      {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}

      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label>Embarcação</label>
            <select name="vessel_id" defaultValue={vessels[0]?.id ?? ""} className="mt-1" disabled={vessels.length === 0}>
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.commercial_capacity} lugares)
                </option>
              ))}
            </select>
            {vessels.length === 0 && <p className="mt-1 text-xs text-muted">Cadastre uma embarcação antes de configurar a agenda.</p>}
          </div>
          <div>
            <label>Preço-base (R$)</label>
            <input
              name="base_price_cents"
              type="number"
              min={0}
              step="0.01"
              required
              defaultValue={tourBasePriceCents > 0 ? (tourBasePriceCents / 100).toFixed(2) : ""}
              placeholder="0,00"
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <label>Dias da semana</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {DAY_LABELS.map((label, day) => (
              <label key={day} className="flex cursor-pointer items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand/10">
                <input type="checkbox" name="days_of_week" value={day} className="accent-brand" />
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

        <p className="text-xs text-muted">
          Capacidade usa a capacidade comercial da embarcação, o passeio fica disponível pelos próximos 90 dias e
          continua se estendendo sozinho. Dá pra ajustar tudo isso depois em &quot;Agenda e disponibilidade&quot;.
        </p>

        <div className="flex items-center gap-3">
          <SaveButton />
          <button type="button" onClick={onSkip} className="text-xs text-muted hover:text-body hover:underline">
            Prefiro configurar manualmente (agenda recorrente ou datas específicas)
          </button>
        </div>
      </form>
    </div>
  );
}
