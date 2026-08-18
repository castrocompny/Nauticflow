"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createDeparture } from "./actions";
import type { Tour, Vessel } from "@/lib/types";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Criando..." : "Criar saída"}
    </button>
  );
}

export function NewDepartureForm({ vessels, tours }: { vessels: Vessel[]; tours: Tour[] }) {
  const [open, setOpen] = useState(false);
  const [vesselId, setVesselId] = useState(vessels[0]?.id ?? "");
  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const r = await createDeparture(p, f);
      if (!r.error) setOpen(false);
      return r;
    },
    { error: "" }
  );

  const vessel = vessels.find((v) => v.id === vesselId);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={vessels.length === 0}
        className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
      >
        + Nova saída
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-5">
      <h3 className="mb-3 font-display font-semibold text-heading">Nova saída</h3>
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Embarcação</label>
            <select name="vessel_id" className="mt-1" value={vesselId} onChange={(e) => setVesselId(e.target.value)}>
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.commercial_capacity} lugares)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Passeio</label>
            <select name="tour_id" className="mt-1" defaultValue="">
              <option value="">Novo passeio...</option>
              {tours.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Nome do novo passeio (se aplicável)</label>
            <input name="new_tour" className="mt-1" placeholder="Ex: Passeio Ilhas" />
          </div>
          <div>
            <label>Capacidade (padrão: comercial)</label>
            <input name="capacity" type="number" min={1} className="mt-1" placeholder={String(vessel?.commercial_capacity ?? "")} />
          </div>
          <div>
            <label>Data</label>
            <input name="date" type="date" required className="mt-1" />
          </div>
          <div>
            <label>Hora</label>
            <input name="time" type="time" required min="08:00" max="19:00" className="mt-1" />
          </div>
        </div>
        <div className="flex gap-2">
          <Save />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-4 py-2 text-sm text-body">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
