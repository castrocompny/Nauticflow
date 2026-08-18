import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Pager } from "@/components/ui";
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

const PAGE_SIZE = 25;

export default async function DeparturesPage(props: { searchParams: Promise<{ page?: string }> }) {
  const searchParams = await props.searchParams;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createClient();

  const [{ data: deps, count }, { data: activeVessels }, { data: tours }] = await Promise.all([
    supabase
      .from("departures")
      .select(
        "id, departs_at, capacity, status, vessel_id, tour_id, vessels(name), tours(name), reservations(people_count, status)",
        { count: "exact" }
      )
      .order("departs_at", { ascending: true })
      .range(from, to),
    supabase.from("vessels").select("*").eq("status", "ativa").order("name"),
    supabase.from("tours").select("*").eq("active", true).order("name"),
  ]);

  const rows = (deps ?? []) as unknown as Row[];
  const vessels = (activeVessels ?? []) as Vessel[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Saídas" subtitle="Cada saída é uma embarcação em uma data e hora, com sua capacidade." />
      <NewDepartureForm vessels={vessels} tours={(tours ?? []) as Tour[]} />

      {rows.length === 0 ? (
        <EmptyState
          title={page > 1 ? "Nenhuma saída nesta página" : "Nenhuma saída cadastrada"}
          hint="Crie uma saída para começar a receber reservas. É preciso ter ao menos uma embarcação ativa."
        />
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((r) => (
              <DepartureRow key={r.id} r={r} vessels={vessels} tours={(tours ?? []) as Tour[]} />
            ))}
          </div>
          <Pager page={page} totalPages={totalPages} basePath="/saidas" />
        </>
      )}
    </>
  );
}
