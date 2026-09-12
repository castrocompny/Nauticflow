import { ScrollShadowX } from "@/components/scroll-shadow-x";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { fmtDate, fmtTime } from "@/lib/format";
import { NewReservationForm } from "./new-reservation-form";
import { ReservationRow } from "./reservation-row";

type DepRow = {
  id: string;
  departs_at: string;
  capacity: number;
  vessels: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

// Departures pra o fluxo NOVO de reserva de balcão, modelo fixed_schedule
// (Cliente -> Passeio -> Data -> Horário) -- consulta separada da `deps`
// acima porque precisa de campos que o dropdown simples do formulário de
// EDIÇÃO não usa (tour_id, price_cents); a `deps`/`depOptions` continuam
// intocadas, alimentando só ReservationRow/ReservationEditForm como sempre
// alimentaram. Janela global 08:00-19:00 REMOVIDA (pedido explícito) --
// horário permitido agora é decidido pelo modelo/regra de cada passeio, não
// mais um número fixo do NauticFlow inteiro.
type NewFormDepRow = {
  id: string;
  tour_id: string;
  departs_at: string;
  capacity: number;
  price_cents: number | null;
  price_type: string | null;
  vessels: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

type TourRow = {
  id: string;
  name: string;
  base_price_cents: number;
  price_type: string;
  booking_model: string;
  duration_minutes: number | null;
};

// Regra de disponibilidade do privativo flexível (migration 0073) -- uma por
// passeio flexible_private. Embarcação/capacidade nunca escolhidas pelo
// operador na hora da reserva, sempre inferidas daqui.
type FlexibleRuleRow = {
  tour_id: string;
  vessel_id: string;
  days_of_week: number[];
  window_start: string;
  window_end: string;
  min_duration_minutes: number;
  max_duration_minutes: number;
  slot_interval_minutes: number;
  pricing_mode: string;
  hourly_price_cents: number | null;
  vessels: { name: string; commercial_capacity: number } | null;
};

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

export default async function ReservationsPage() {
  const supabase = createClient();

  const [{ data: deps }, { data: newFormDeps }, { data: tours }, { data: flexRules }, { data: clients }, { data: res }] =
    await Promise.all([
      supabase
        .from("departures")
        .select("id, departs_at, capacity, vessels(name), reservations(people_count, status)")
        .neq("status", "cancelada")
        .order("departs_at"),
      // saidas "reservaveis" pro fluxo de balcao fixed_schedule: nunca
      // cancelada/encerrada, sempre no futuro -- nao mostra saida passada.
      supabase
        .from("departures")
        .select("id, tour_id, departs_at, capacity, price_cents, price_type, vessels(name), reservations(people_count, status)")
        .in("status", ["agendada", "em_andamento"])
        .gte("departs_at", new Date().toISOString())
        .order("departs_at"),
      supabase
        .from("tours")
        .select("id, name, base_price_cents, price_type, booking_model, duration_minutes")
        .eq("active", true)
        .order("name"),
      supabase
        .from("tour_flexible_booking_rules")
        .select(
          "tour_id, vessel_id, days_of_week, window_start, window_end, min_duration_minutes, max_duration_minutes, slot_interval_minutes, pricing_mode, hourly_price_cents, vessels(name, commercial_capacity)"
        )
        .eq("active", true),
      supabase.from("clients").select("id, name").order("name"),
      supabase
        .from("reservations")
        .select(
          "id, people_count, total_cents, status, origin_name, source, client_id, departure_id, clients(name), departures(departs_at, ends_at, vessels(name))"
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

  const newFormDepRows = (newFormDeps ?? []) as unknown as NewFormDepRow[];
  const newFormDepOptions = newFormDepRows.map((d) => {
    const booked = d.reservations
      .filter((r) => r.status === "confirmada")
      .reduce((s, r) => s + r.people_count, 0);
    return {
      id: d.id,
      tour_id: d.tour_id,
      departs_at: d.departs_at,
      capacity: d.capacity,
      price_cents: d.price_cents,
      price_type: d.price_type,
      vessel_name: d.vessels?.name ?? null,
      available: d.capacity - booked,
    };
  });

  const tourRows = (tours ?? []) as TourRow[];
  const flexRuleRows = (flexRules ?? []) as unknown as FlexibleRuleRow[];
  const flexibleRules = flexRuleRows.map((r) => ({
    tour_id: r.tour_id,
    vessel_id: r.vessel_id,
    vessel_name: r.vessels?.name ?? null,
    vessel_capacity: r.vessels?.commercial_capacity ?? 0,
    days_of_week: r.days_of_week,
    window_start: r.window_start,
    window_end: r.window_end,
    min_duration_minutes: r.min_duration_minutes,
    max_duration_minutes: r.max_duration_minutes,
    slot_interval_minutes: r.slot_interval_minutes,
    pricing_mode: r.pricing_mode,
    hourly_price_cents: r.hourly_price_cents,
  }));

  const reservations = (res ?? []) as unknown as ResRow[];

  return (
    <>
      <RealtimeRefresh tables={["reservations", "departures"]} />
      <PageHeader title="Reservas" />
      <NewReservationForm
        tours={tourRows.map((t) => ({
          id: t.id,
          name: t.name,
          base_price_cents: t.base_price_cents,
          price_type: t.price_type,
          booking_model: t.booking_model,
          duration_minutes: t.duration_minutes,
        }))}
        departures={newFormDepOptions}
        flexibleRules={flexibleRules}
      />

      {reservations.length === 0 ? (
        <EmptyState
          title="Nenhuma reserva ainda"
          hint="Crie uma saída e um cliente, depois registre a primeira reserva."
        />
      ) : (
        <Card className="p-0">
          <ScrollShadowX>
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
          </ScrollShadowX>
        </Card>
      )}
    </>
  );
}
