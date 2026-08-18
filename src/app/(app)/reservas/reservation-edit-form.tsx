"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateReservation } from "./actions";

type DepOption = { id: string; label: string; available: number };
type ClientOption = { id: string; name: string };

type ResRow = {
  id: string;
  people_count: number;
  total_cents: number;
  origin_name: string | null;
  client_id: string;
  departure_id: string;
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

export function ReservationEditForm({
  r,
  departures,
  clients,
  onClose,
}: {
  r: ResRow;
  departures: DepOption[];
  clients: ClientOption[];
  onClose: () => void;
}) {
  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const res = await updateReservation(p, f);
      if (!res.error) onClose();
      return res;
    },
    { error: "" }
  );

  return (
    <>
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={r.id} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label>Saída</label>
            <select name="departure_id" className="mt-1" defaultValue={r.departure_id}>
              {departures.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} ({d.available} livres)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Cliente</label>
            <select name="client_id" className="mt-1" defaultValue={r.client_id}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Pessoas</label>
            <input name="people_count" type="number" min={1} defaultValue={r.people_count} className="mt-1" />
          </div>
          <div>
            <label>Valor (R$)</label>
            <input name="value" defaultValue={(r.total_cents / 100).toFixed(2).replace(".", ",")} className="mt-1" />
          </div>
          <div className="col-span-2 lg:col-span-4">
            <label>Origem (parceiro / hotel)</label>
            <input name="origin_name" defaultValue={r.origin_name ?? ""} className="mt-1" />
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
    </>
  );
}
