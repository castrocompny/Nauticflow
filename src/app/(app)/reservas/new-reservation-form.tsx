"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createReservation } from "./actions";

type DepOption = { id: string; label: string; available: number };
type ClientOption = { id: string; name: string };

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar reserva"}
    </button>
  );
}

export function NewReservationForm({
  departures,
  clients,
}: {
  departures: DepOption[];
  clients: ClientOption[];
}) {
  const [open, setOpen] = useState(false);
  const [depId, setDepId] = useState(departures[0]?.id ?? "");
  const [toast, setToast] = useState("");
  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const r = await createReservation(p, f);
      if (!r.error) {
        setOpen(false);
        if ((r as any).info) {
          setToast((r as any).info);
          setTimeout(() => setToast(""), 4500);
        }
      }
      return r;
    },
    { error: "" }
  );

  const dep = departures.find((d) => d.id === depId);

  const Toast = toast ? (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg bg-navy px-4 py-3 text-sm text-white shadow-lg">
      {toast}
    </div>
  ) : null;

  if (!open) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          disabled={departures.length === 0 || clients.length === 0}
          className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          + Nova reserva
        </button>
        {Toast}
      </>
    );
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-5">
      <h3 className="mb-3 font-display font-semibold text-heading">Nova reserva</h3>

      {dep && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-sm text-brand-dark">
          <span>{dep.label}</span>
          <span className="font-medium">{dep.available} vagas livres</span>
        </div>
      )}

      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}

      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Saída</label>
            <select name="departure_id" className="mt-1" value={depId} onChange={(e) => setDepId(e.target.value)}>
              {departures.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} ({d.available} livres)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Cliente</label>
            <select name="client_id" className="mt-1" defaultValue={clients[0]?.id}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Pessoas</label>
            <input name="people_count" type="number" min={1} defaultValue={1} className="mt-1" />
          </div>
          <div>
            <label>Valor (R$)</label>
            <input name="value" className="mt-1" placeholder="320,00" />
          </div>
          <div className="col-span-2">
            <label>Origem (parceiro / hotel)</label>
            <input name="origin_name" className="mt-1" placeholder="Pousada Águas Claras" />
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
