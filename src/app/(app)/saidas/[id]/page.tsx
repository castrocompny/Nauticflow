import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, OccupancyBar } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";
import { ReservationStatusSelect } from "@/components/reservation-status-select";
import { updateReservationStatus } from "../../reservas/actions";
import { FinalizeButton } from "./finalize-button";

type Dep = {
  id: string;
  departs_at: string;
  capacity: number;
  status: string;
  vessels: { name: string; official_capacity: number; default_crew: number } | null;
  tours: { name: string } | null;
  reservations: {
    id: string;
    people_count: number;
    status: string;
    client_id: string;
    clients: { name: string } | null;
    passengers: { id: string }[];
  }[];
};

export default async function DepartureDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data } = await supabase
    .from("departures")
    .select(
      "id, departs_at, capacity, status, vessels(name, official_capacity, default_crew), tours(name), reservations(id, people_count, status, client_id, clients(name), passengers(id))"
    )
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const d = data as unknown as Dep;
  const active = d.reservations.filter((r) => r.status === "confirmada");
  const booked = active.reduce((s, r) => s + r.people_count, 0);
  const pax = active.reduce((s, r) => s + r.passengers.length, 0);

  return (
    <>
      <Link href="/saidas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-heading">
        <ArrowLeft size={16} /> Saídas
      </Link>

      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-heading">
            {d.vessels?.name} · {d.tours?.name}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {fmtDate(d.departs_at)} às {fmtTime(d.departs_at)} · lotação oficial{" "}
            {d.vessels?.official_capacity} ({d.vessels?.default_crew} tripulação)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FinalizeButton id={d.id} status={d.status} />
          <Link
            href={`/manifesto/${d.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            <FileText size={16} /> Ver manifesto
          </Link>
        </div>
      </div>

      <Card className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-muted">Ocupação comercial</span>
          <span className="font-medium">
            {booked}/{d.capacity} · {pax} passageiros cadastrados
          </span>
        </div>
        <OccupancyBar booked={booked} capacity={d.capacity} />
      </Card>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-center">Pessoas</th>
              <th className="px-4 py-3 text-center">Passageiros</th>
              <th className="px-4 py-3 text-right">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {d.reservations.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium text-heading">{r.clients?.name}</td>
                <td className="px-4 py-3 text-center">{r.people_count}</td>
                <td className="px-4 py-3 text-center">
                  {r.passengers.length}/{r.people_count}
                </td>
                <td className="px-4 py-3 text-right">
                  <ReservationStatusSelect id={r.id} status={r.status} action={updateReservationStatus} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/reservas/${r.id}`}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-surfaceHover"
                    >
                      Abrir
                    </Link>
                    <Link
                      href={`/clientes/${r.client_id}`}
                      title="Histórico do cliente"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
                    >
                      <History size={16} />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
