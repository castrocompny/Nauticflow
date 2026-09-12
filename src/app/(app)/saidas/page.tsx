import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Pager } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { NewDepartureForm } from "./new-departure-form";
import { DepartureRow } from "./departure-row";
import { BulkDeleteDeparturesButton } from "./bulk-delete-departures-button";
import type { Tour, Vessel } from "@/lib/types";

type Row = {
  id: string;
  departs_at: string;
  ends_at: string | null;
  capacity: number;
  status: string;
  vessel_id: string;
  tour_id: string;
  price_cents: number | null;
  vessels: { name: string } | null;
  tours: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

const PAGE_SIZE = 25;

export default async function DeparturesPage(props: { searchParams: Promise<{ page?: string; tour_id?: string }> }) {
  const searchParams = await props.searchParams;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createClient();

  const [{ data: deps, count }, { data: activeVessels }, { data: tours }] = await Promise.all([
    supabase
      .from("departures")
      .select(
        "id, departs_at, ends_at, capacity, status, vessel_id, tour_id, price_cents, vessels(name), tours(name), reservations(people_count, status)",
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
      <RealtimeRefresh tables={["departures", "reservations"]} />
      <PageHeader title="Saídas" subtitle="Cada saída é uma embarcação em uma data e hora, com sua capacidade." />
      <p className="mb-4 text-xs text-muted">
        As saídas normais são geradas automaticamente pela agenda de cada passeio (em Passeios → Agenda e
        disponibilidade). Use &quot;Adicionar saída avulsa&quot; só para uma data fora do padrão.
      </p>

      {/* Duas ações da área de gestão de saídas na mesma linha -- operacional
          (criar) à esquerda, global/destrutiva (limpar tudo) à direita.
          `flex-wrap` deixa quebrar pra duas linhas em telas pequenas sem
          nunca colar um elemento no outro (gap cuida disso nos dois casos). */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <NewDepartureForm vessels={vessels} tours={(tours ?? []) as Tour[]} defaultTourId={searchParams.tour_id} />
        <BulkDeleteDeparturesButton />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={page > 1 ? "Nenhuma saída nesta página" : "Nenhuma saída cadastrada"}
          hint="Configure a agenda de um passeio para gerar saídas automaticamente, ou adicione uma saída avulsa. É preciso ter ao menos uma embarcação ativa."
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
