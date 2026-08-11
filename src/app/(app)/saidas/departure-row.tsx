"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Pencil, Check, Ban } from "lucide-react";
import { Card, OccupancyBar, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { fmtDate, fmtTime } from "@/lib/format";
import { deleteDeparture, updateDeparture, confirmDeparture, cancelDeparture } from "./actions";
import type { Tour, Vessel } from "@/lib/types";

type Row = {
  id: string;
  departs_at: string;
  capacity: number;
  status: string;
  vessel_id: string;
  tour_id: string;
  vessels: { name: string } | null;
  tours: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

const statusTone: Record<string, "green" | "amber" | "slate" | "red"> = {
  agendada: "amber",
  em_andamento: "green",
  encerrada: "slate",
  cancelada: "red",
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

export function DepartureRow({ r, vessels, tours }: { r: Row; vessels: Vessel[]; tours: Tour[] }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const res = await updateDeparture(p, f);
      if (!res.error) setEditing(false);
      return res;
    },
    { error: "" }
  );

  const booked = r.reservations.filter((x) => x.status === "confirmada").reduce((s, x) => s + x.people_count, 0);
  const full = booked >= r.capacity;
  const finished = r.status === "encerrada" || r.status === "cancelada";
  const local = new Date(r.departs_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateISO = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
  const timeHM = `${pad(local.getHours())}:${pad(local.getMinutes())}`;

  function run(fn: (id: string) => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await fn(r.id);
      if (!res.ok) {
        setMsg(res.message);
        setTimeout(() => setMsg(""), 4000);
      }
    });
  }

  return (
    <div className="space-y-2">
      <Card className="flex items-center gap-4">
        <Link href={`/saidas/${r.id}`} className="flex min-w-0 flex-1 items-center gap-4">
          <div className="w-20">
            <p className="font-display font-semibold text-heading">{fmtTime(r.departs_at)}</p>
            <p className="text-xs text-muted">{fmtDate(r.departs_at)}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {r.vessels?.name} · {r.tours?.name}
            </p>
            <div className="mt-1.5">
              <OccupancyBar booked={booked} capacity={r.capacity} />
            </div>
          </div>
        </Link>
        <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge>
        <div className="w-20 text-right">
          <p className={`text-sm font-medium ${full ? "text-danger" : ""}`}>
            {booked}/{r.capacity}
          </p>
          <Badge tone={full ? "red" : "slate"}>{full ? "lotada" : `${r.capacity - booked} vagas`}</Badge>
        </div>
        <Link
          href={`/manifesto/${r.id}`}
          className="whitespace-nowrap rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-surfaceHover"
        >
          Manifesto
        </Link>
        {r.status === "agendada" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(confirmDeparture)}
            title="Confirmar saída"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-green-600 transition hover:bg-green-50 disabled:opacity-50"
          >
            <Check size={16} />
          </button>
        )}
        {!finished && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Cancelar esta saída?")) run(cancelDeparture);
            }}
            title="Cancelar saída"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-danger transition hover:bg-red-50 disabled:opacity-50"
          >
            <Ban size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          title="Editar saída"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
        >
          <Pencil size={16} />
        </button>
        <DeleteButton action={deleteDeparture} id={r.id} confirmText="Excluir esta saída?" />
      </Card>
      {msg && <p className="px-1 text-xs text-danger">{msg}</p>}
      {editing && (
        <Card>
          {state.error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
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
                onClick={() => setEditing(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-body"
              >
                Cancelar
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
