import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";
import { AddPassengerForm } from "./passengers-ui";
import { setPassengerStatus, removePassenger } from "./passenger-actions";
import { resendVoucher } from "../actions";
import { VoucherActions } from "@/components/voucher-actions";

type Detail = {
  id: string;
  people_count: number;
  status: string;
  clients: { name: string } | null;
  departures: { departs_at: string; vessels: { name: string } | null } | null;
  passengers: {
    id: string;
    name: string;
    document: string | null;
    nationality: string | null;
    status: string;
  }[];
};

const statusTone: Record<string, "green" | "red" | "slate"> = {
  embarcado: "green",
  ausente: "red",
  confirmado: "slate",
};

export default async function ReservationDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("reservations")
    .select(
      "id, people_count, status, clients(name), departures(departs_at, vessels(name)), passengers(id, name, document, nationality, status)"
    )
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const r = data as unknown as Detail;
  const used = r.passengers.length;
  const remaining = r.people_count - used;

  return (
    <>
      <Link href="/reservas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-heading">
        <ArrowLeft size={16} /> Reservas
      </Link>

      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-heading">
            Passageiros · {r.clients?.name}
          </h1>
          {r.departures && (
            <p className="mt-0.5 text-sm text-muted">
              {r.departures.vessels?.name} · {fmtDate(r.departures.departs_at)}{" "}
              {fmtTime(r.departures.departs_at)}
            </p>
          )}
        </div>
        <Badge tone={remaining === 0 ? "green" : "amber"}>
          {used} de {r.people_count}
        </Badge>
      </div>

      <div className="mb-5 rounded-card border border-line bg-surface p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Voucher do cliente</p>
        <VoucherActions reservationId={r.id} resend={resendVoucher} />
      </div>

      <div className="space-y-2">
        {r.passengers.map((p) => (
          <Card key={p.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-heading">{p.name}</p>
              <p className="text-xs text-muted">
                {p.document ?? "sem documento"}
                {p.nationality ? ` · ${p.nationality}` : ""}
              </p>
            </div>
            <Badge tone={statusTone[p.status] ?? "slate"}>{p.status}</Badge>
            <form action={setPassengerStatus}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="reservation_id" value={r.id} />
              <input type="hidden" name="status" value={p.status === "embarcado" ? "confirmado" : "embarcado"} />
              <button
                title="Marcar embarcado"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-green-600 hover:bg-green-50"
              >
                <Check size={16} />
              </button>
            </form>
            <form action={setPassengerStatus}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="reservation_id" value={r.id} />
              <input type="hidden" name="status" value="ausente" />
              <button
                title="Marcar ausente"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line text-red-600 hover:bg-red-50"
              >
                <X size={16} />
              </button>
            </form>
            <form action={removePassenger}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="reservation_id" value={r.id} />
              <button className="text-xs text-muted hover:text-danger">remover</button>
            </form>
          </Card>
        ))}

        <AddPassengerForm reservationId={r.id} remaining={remaining} />
      </div>
    </>
  );
}
