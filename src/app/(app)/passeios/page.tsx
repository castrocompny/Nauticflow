import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Badge } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { NewTourForm } from "./new-tour-form";
import type { Tour, TourMarketplaceStatus } from "@/lib/types";

const statusBadge: Record<TourMarketplaceStatus, { label: string; tone: "green" | "amber" | "red" | "slate" }> = {
  draft: { label: "Rascunho", tone: "slate" },
  review: { label: "Em revisão", tone: "amber" },
  published: { label: "Publicado", tone: "green" },
  paused: { label: "Pausado", tone: "amber" },
  rejected: { label: "Recusado", tone: "red" },
};

export default async function PasseiosPage() {
  const supabase = createClient();
  const { data } = await supabase.from("tours").select("*").order("created_at", { ascending: false });
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
          {tours.map((t) => {
            const badge = statusBadge[t.marketplace_status];
            return (
              <Link key={t.id} href={`/passeios/${t.id}`}>
                <Card className="h-full transition hover:border-brand">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display font-semibold text-heading">{t.name}</p>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t.destination || "Destino não informado"}</p>
                  {!t.active && <p className="mt-2 text-xs text-danger">Desativado</p>}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
