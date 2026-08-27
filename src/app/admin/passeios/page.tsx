import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireSuperAdminPage } from "@/lib/admin-auth";
import { Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { ModerationControls } from "./moderation-controls";

// Fila de moderação do marketplace: só passeios que o operador já mandou pra
// revisão aparecem aqui (draft nunca aparece -- é o objetivo de "não construir um
// painel gigantesco": esta tela só existe pra decidir review -> published/rejected).
export default async function AdminToursPage() {
  const { supabase, denied } = await requireSuperAdminPage();
  if (denied) {
    return (
      <div className="grid min-h-screen place-items-center bg-app p-6">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-danger">
            <ShieldAlert size={24} />
          </div>
          <h1 className="font-display text-lg font-semibold text-heading">Acesso restrito</h1>
        </div>
      </div>
    );
  }

  const { data } = await supabase
    .from("tours")
    .select("id, name, destination, category, created_at, companies(name)")
    .eq("marketplace_status", "review")
    .order("created_at", { ascending: true });

  const tours = (data ?? []) as unknown as {
    id: string;
    name: string;
    destination: string | null;
    category: string | null;
    created_at: string;
    companies: { name: string } | null;
  }[];

  return (
    <div className="min-h-screen bg-app p-6">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Moderação de passeios"
          subtitle="Passeios enviados para revisão, aguardando aprovação para o ToursFlow."
          action={
            <Link href="/admin" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-body hover:bg-surfaceHover">
              <ArrowLeft size={16} /> Voltar
            </Link>
          }
        />

        {tours.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-muted">Nenhum passeio aguardando revisão.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {tours.map((t) => (
              <Card key={t.id} className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-heading">{t.name}</p>
                  <p className="text-xs text-muted">
                    {t.companies?.name} · {t.destination || "sem destino"} · enviado em {fmtDate(t.created_at)}
                  </p>
                </div>
                <ModerationControls tourId={t.id} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
