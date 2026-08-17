"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Pencil, Check, Ban } from "lucide-react";
import { Card, OccupancyBar, Badge } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { fmtDate, fmtTime } from "@/lib/format";
import { deleteDeparture, confirmDeparture, cancelDeparture } from "./actions";
import type { Tour, Vessel } from "@/lib/types";

const DepartureEditForm = dynamic(
  () => import("./departure-edit-form").then((m) => m.DepartureEditForm),
  { ssr: false, loading: () => <p className="text-sm text-muted">Carregando formulário...</p> }
);

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

export function DepartureRow({ r, vessels, tours }: { r: Row; vessels: Vessel[]; tours: Tour[] }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  const booked = r.reservations.filter((x) => x.status === "confirmada").reduce((s, x) => s + x.people_count, 0);
  const full = booked >= r.capacity;
  const finished = r.status === "encerrada" || r.status === "cancelada";

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
          <DepartureEditForm r={r} vessels={vessels} tours={tours} onClose={() => setEditing(false)} />
        </Card>
      )}
    </div>
  );
}
