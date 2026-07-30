"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createVessel } from "./actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar embarcação"}
    </button>
  );
}

export function NewVesselForm() {
  const [open, setOpen] = useState(false);
  const [official, setOfficial] = useState(50);
  const [crew, setCrew] = useState(4);
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const r = await createVessel(p, f);
      if (!r.error) setOpen(false);
      return r;
    },
    { error: "" }
  );

  const commercial = Math.max(official - crew, 0);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
      >
        + Nova embarcação
      </button>
    );
  }

  return (
    <div className="rounded-card border border-slate-200 bg-white p-5">
      <h3 className="mb-3 font-display font-semibold text-navy">Nova embarcação</h3>
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Nome</label>
            <input name="name" required className="mt-1" />
          </div>
          <div>
            <label>Tipo</label>
            <select name="type" className="mt-1" defaultValue="escuna">
              <option value="escuna">Escuna</option>
              <option value="lancha">Lancha</option>
              <option value="jet_ski">Jet ski</option>
              <option value="catamara">Catamarã</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label>Capacidade oficial</label>
            <input
              name="official_capacity"
              type="number"
              min={1}
              value={official}
              onChange={(e) => setOfficial(Number(e.target.value))}
              className="mt-1"
            />
          </div>
          <div>
            <label>Tripulação padrão</label>
            <input
              name="default_crew"
              type="number"
              min={0}
              value={crew}
              onChange={(e) => setCrew(Number(e.target.value))}
              className="mt-1"
            />
          </div>
          <div>
            <label>Arqueação bruta (opcional)</label>
            <input name="gross_tonnage" type="number" step="0.01" className="mt-1" />
          </div>
          <div>
            <label>Registro / TIE</label>
            <input name="registration" className="mt-1" />
          </div>
        </div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-brand-dark">
          Capacidade comercial: <strong>{commercial}</strong> (oficial menos tripulação)
        </div>
        <div className="flex gap-2">
          <Save />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
