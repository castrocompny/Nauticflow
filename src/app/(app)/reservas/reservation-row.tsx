"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { ReservationStatusSelect } from "@/components/reservation-status-select";
import { Badge } from "@/components/ui";
import { brl, fmtTimeRange } from "@/lib/format";
import { deleteReservation, updateReservationStatus } from "./actions";

const ReservationEditForm = dynamic(
  () => import("./reservation-edit-form").then((m) => m.ReservationEditForm),
  { ssr: false, loading: () => <p className="text-sm text-muted">Carregando formulário...</p> }
);

type DepOption = { id: string; label: string; available: number };
type ClientOption = { id: string; name: string };

type ResRow = {
  id: string;
  people_count: number;
  total_cents: number;
  status: string;
  origin_name: string | null;
  source: string;
  client_id: string;
  departure_id: string;
  clients: { name: string } | null;
  departures: { departs_at: string; ends_at: string | null; vessels: { name: string } | null } | null;
};

// Origem/canal da reserva (reservations.source, migration 0035) -- rótulo e
// cor discretos pra tabela. 'manual' já significava "reserva de balcão"
// desde que a coluna existe (ver comentário na própria 0035 e na migration
// 0072); nenhuma coluna nova foi criada pra "canal", esta é a primitive
// canônica reaproveitada.
const sourceLabel: Record<string, string> = {
  manual: "Balcão",
  marketplace: "ToursFlow",
  partner: "Parceiro",
  operator: "Operador",
  website: "Site",
  agency: "Agência",
};
const sourceTone: Record<string, "green" | "amber" | "slate" | "red"> = {
  manual: "slate",
  marketplace: "green",
  partner: "amber",
};

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

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3 font-medium text-heading">
          {r.clients?.name}
          <div className="mt-1">
            <Badge tone={sourceTone[r.source] ?? "slate"}>{sourceLabel[r.source] ?? r.source}</Badge>
          </div>
        </td>
        <td className="px-4 py-3 text-body">
          {r.departures?.vessels?.name}
          {r.departures && ` · ${fmtTimeRange(r.departures.departs_at, r.departures.ends_at)}`}
        </td>
        <td className="px-4 py-3 text-center">{r.people_count}</td>
        <td className="px-4 py-3 text-right">{brl(r.total_cents)}</td>
        <td className="px-4 py-3 text-right">
          <ReservationStatusSelect id={r.id} status={r.status} action={updateReservationStatus} />
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <a
              href={`/voucher/${r.id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-surfaceHover"
            >
              Voucher
            </a>
            <Link
              href={`/reservas/${r.id}`}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-surfaceHover"
            >
              Passageiros
            </Link>
            <Link
              href={`/clientes/${r.client_id}`}
              title="Histórico do cliente"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <History size={16} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title="Editar reserva"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <Pencil size={16} />
            </button>
            <DeleteButton action={deleteReservation} id={r.id} confirmText="Excluir esta reserva?" />
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-line bg-surfaceHover/60 last:border-0">
          <td colSpan={6} className="px-4 py-4">
            <ReservationEditForm r={r} departures={departures} clients={clients} onClose={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}
