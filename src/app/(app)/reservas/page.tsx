import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { fmtDate, fmtTime, saoPauloHHMM } from "@/lib/format";
import { NewReservationForm } from "./new-reservation-form";
import { ReservationRow } from "./reservation-row";

type DepRow = {
  id: string;
  departs_at: string;
  capacity: number;
  vessels: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

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

export default async function ReservationsPage() {
  const supabase = createClient();

  const [{ data: deps }, { data: clients }, { data: res }] = await Promise.all([
    supabase
      .from("departures")
      .select("id, departs_at, capacity, vessels(name), reservations(people_count, status)")
      .neq("status", "cancelada")
      .order("departs_at"),
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("reservations")
      .select(
        "id, people_count, total_cents, status, origin_name, client_id, departure_id, clients(name), departures(departs_at, vessels(name))"
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const depRows = (deps ?? []) as unknown as DepRow[];
  const depOptions = depRows.map((d) => {
    const booked = d.reservations
      .filter((r) => r.status === "confirmada")
      .reduce((s, r) => s + r.people_count, 0);
    return {
      id: d.id,
      label: `${d.vessels?.name} · ${fmtDate(d.departs_at)} ${fmtTime(d.departs_at)}`,
      available: d.capacity - booked,
    };
  });
  // novas reservas só podem ser feitas em saidas dentro do horario comercial (08:00-19:00);
  // reservas ja existentes ligadas a saidas fora disso continuam editaveis normalmente
  const createDepOptions = depOptions.filter((d, i) => {
    const h = saoPauloHHMM(depRows[i].departs_at);
    return h >= "08:00" && h <= "19:00";
  });

  const reservations = (res ?? []) as unknown as ResRow[];

  return (
    <>
      <PageHeader title="Reservas" />
      <NewReservationForm departures={createDepOptions} clients={(clients ?? []) as { id: string; name: string }[]} />

      {reservations.length === 0 ? (
        <EmptyState
          title="Nenhuma reserva ainda"
          hint="Crie uma saída e um cliente, depois registre a primeira reserva."
        />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
              <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Saída</th>
                <th className="px-4 py-3 text-center">Pessoas</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <ReservationRow
                  key={r.id}
                  r={r}
                  departures={depOptions}
                  clients={(clients ?? []) as { id: string; name: string }[]}
                />
              ))}
            </tbody>
          </table>

          </div>
        </Card>
      )}
    </>
  );
}
