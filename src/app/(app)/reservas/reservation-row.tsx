"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { ReservationStatusSelect } from "@/components/reservation-status-select";
import { brl, fmtTime } from "@/lib/format";
import { deleteReservation, updateReservation, updateReservationStatus } from "./actions";

type DepOption = { id: string; label: string; available: number };
type ClientOption = { id: string; name: string };

type ResRow = {
  id: string;
  people_count: number;
  total_cents: number;
  status: string;
  origin_name: string | null;
  client_id: string;
  departure_id: string;
  clients: { name: string } | null;
  departures: { departs_at: string; vessels: { name: string } | null } | null;
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

export function ReservationRow({
  r,
  departures,
  clients,
}: {
  r: ResRow;
  departures: DepOption[];
  clients: ClientOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const res = await updateReservation(p, f);
      if (!res.error) setEditing(false);
      return res;
    },
    { error: "" }
  );

  return (
    <>
      <tr className="border-b border-slate-50 last:border-0">
        <td className="px-4 py-3 font-medium text-navy">{r.clients?.name}</td>
        <td className="px-4 py-3 text-slate-600">
          {r.departures?.vessels?.name}
          {r.departures && ` · ${fmtTime(r.departures.departs_at)}`}
        </td>
        <td className="px-4 py-3 text-center">{r.people_count}</td>
        <td className="px-4 py-3 text-right">{brl(r.total_cents)}</td>
        <td className="px-4 py-3 text-right">
          <ReservationStatusSelect id={r.id} status={r.status} action={updateReservationStatus} />
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <a href={`/voucher/${r.id}`} target="_blank" rel="noreferrer" className="text-sm text-brand">
              voucher
            </a>
            <Link href={`/reservas/${r.id}`} className="text-sm text-brand">
              passageiros
            </Link>
            <Link
              href={`/clientes/${r.client_id}`}
              title="Histórico do cliente"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-navy"
            >
              <History size={16} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title="Editar reserva"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-navy"
            >
              <Pencil size={16} />
            </button>
            <DeleteButton action={deleteReservation} id={r.id} confirmText="Excluir esta reserva?" />
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0">
          <td colSpan={6} className="px-4 py-4">
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
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
