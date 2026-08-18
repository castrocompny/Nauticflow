"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateDeparture } from "./actions";
import type { Tour, Vessel } from "@/lib/types";

type Row = {
  id: string;
  departs_at: string;
  capacity: number;
  vessel_id: string;
  tour_id: string;
};

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

export function DepartureEditForm({
  r,
  vessels,
  tours,
  onClose,
}: {
  r: Row;
  vessels: Vessel[];
  tours: Tour[];
  onClose: () => void;
}) {
  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const res = await updateDeparture(p, f);
      if (!res.error) onClose();
      return res;
    },
    { error: "" }
  );

  const local = new Date(r.departs_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateISO = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
  const timeHM = `${pad(local.getHours())}:${pad(local.getMinutes())}`;

  return (
    <div className="space-y-2">
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={r.id} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label>Embarcação</label>
            <select name="vessel_id" className="mt-1" defaultValue={r.vessel_id}>
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.commercial_capacity} lugares)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Passeio</label>
            <select name="tour_id" className="mt-1" defaultValue={r.tour_id}>
              {tours.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Capacidade</label>
            <input name="capacity" type="number" min={1} defaultValue={r.capacity} className="mt-1" />
          </div>
          <div>
            <label>Data</label>
            <input name="date" type="date" required defaultValue={dateISO} className="mt-1" />
          </div>
          <div>
            <label>Hora</label>
            <input name="time" type="time" required min="08:00" max="19:00" defaultValue={timeHM} className="mt-1" />
          </div>
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
    </div>
  );
}
