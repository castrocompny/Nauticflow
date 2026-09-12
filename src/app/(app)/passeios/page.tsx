import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { NewTourForm } from "./new-tour-form";
import { TourCard } from "./tour-card";
import type { Tour } from "@/lib/types";

export default async function PasseiosPage() {
  const supabase = createClient();
  // Só passeios ativos -- excluir (archiveTour, ver ./actions.ts) marca
  // active=false sem apagar a linha; o card precisa sumir da lista
  // imediatamente depois disso, então o filtro já vai na própria query, não
  // é um "esconder" feito em JS depois de buscar tudo.
  const { data } = await supabase
    .from("tours")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });
  const tours = (data ?? []) as Tour[];

  return (
    <>
      <RealtimeRefresh tables={["tours"]} />
      <PageHeader
        title="Passeios"
        subtitle="Cadastro comercial dos seus passeios — o que futuramente será exibido no ToursFlow."
        action={<NewTourForm />}
      />
      {tours.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-muted">
            Nenhum passeio cadastrado ainda. Crie o primeiro para poder detalhar preço, fotos e local de embarque.
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {tours.map((t) => (
            <TourCard key={t.id} tour={t} />
          ))}
        </div>
      )}
    </>
  );
}
