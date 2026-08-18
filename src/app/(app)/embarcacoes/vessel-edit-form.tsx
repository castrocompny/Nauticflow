"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateVessel } from "./actions";
import type { Vessel } from "@/lib/types";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar"}
    </button>
  );
}

export function VesselEditForm({ v, onClose }: { v: Vessel; onClose: () => void }) {
  const [official, setOfficial] = useState(v.official_capacity);
  const [crew, setCrew] = useState(v.default_crew);
  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const res = await updateVessel(p, f);
      if (!res.error) onClose();
      return res;
    },
    { error: "" }
  );
  const commercial = Math.max(official - crew, 0);

  return (
    <>
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={v.id} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div>
            <label>Nome</label>
            <input name="name" required defaultValue={v.name} className="mt-1" />
          </div>
          <div>
            <label>Tipo</label>
            <select name="type" className="mt-1" defaultValue={v.type}>
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
            <label>Arqueação bruta</label>
            <input name="gross_tonnage" type="number" step="0.01" defaultValue={v.gross_tonnage ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Registro / TIE</label>
            <input name="registration" defaultValue={v.registration ?? ""} className="mt-1" />
          </div>
        </div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-brand-dark">
          Capacidade comercial: <strong>{commercial}</strong> (oficial menos tripulação)
        </div>
        <div className="flex gap-2">
          <Save />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-body"
          >
            Cancelar
          </button>
        </div>
      </form>
    </>
  );
}
