import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewDepartureForm } from "./new-departure-form";
import { DepartureRow } from "./departure-row";
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

export default async function DeparturesPage() {
  const supabase = createClient();

  const [{ data: deps }, { data: activeVessels }, { data: tours }] = await Promise.all([
    supabase
      .from("departures")
      .select(
        "id, departs_at, capacity, status, vessel_id, tour_id, vessels(name), tours(name), reservations(people_count, status)"
      )
      .order("departs_at", { ascending: true }),
    supabase.from("vessels").select("*").eq("status", "ativa").order("name"),
    supabase.from("tours").select("*").eq("active", true).order("name"),
  ]);

  const rows = (deps ?? []) as unknown as Row[];
  const vessels = (activeVessels ?? []) as Vessel[];

  return (
    <>
      <PageHeader title="Saídas" subtitle="Cada saída é uma embarcação em uma data e hora, com sua capacidade." />
      <NewDepartureForm vessels={vessels} tours={(tours ?? []) as Tour[]} />

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma saída cadastrada"
          hint="Crie uma saída para começar a receber reservas. É preciso ter ao menos uma embarcação ativa."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <DepartureRow key={r.id} r={r} vessels={vessels} tours={(tours ?? []) as Tour[]} />
          ))}
        </div>
      )}
    </>
  );
}
