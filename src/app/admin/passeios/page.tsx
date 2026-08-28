import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireSuperAdminPage } from "@/lib/admin-auth";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { SuspendControls } from "./suspend-controls";

// Moderação de passeios do marketplace: publicação é autônoma (o operador
// publica direto, sem aprovação -- ver DOCUMENTACAO.md), então esta tela não
// é mais fila obrigatória de aprovação. Papel dela agora: o super admin
// enxerga os passeios publicados (e os suspensos) de TODAS as empresas e pode
// suspender/reativar -- a única ação de moderação que ainda existe.
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
    .select(
      "id, name, destination, category, created_at, marketplace_status, marketplace_suspended_at, marketplace_suspension_reason, companies(name)"
    )
    .in("marketplace_status", ["published"])
    .order("marketplace_suspended_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const tours = (data ?? []) as unknown as {
    id: string;
    name: string;
    destination: string | null;
    category: string | null;
    created_at: string;
    marketplace_status: string;
    marketplace_suspended_at: string | null;
    marketplace_suspension_reason: string | null;
    companies: { name: string } | null;
  }[];

  return (
    <div className="min-h-screen bg-app p-6">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Moderação de passeios"
          subtitle="Passeios publicados no ToursFlow. Publicação é autônoma do operador -- aqui você só suspende/reativa em caso de problema."
          action={
            <Link href="/admin" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-body hover:bg-surfaceHover">
              <ArrowLeft size={16} /> Voltar
            </Link>
          }
        />

        {tours.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-muted">Nenhum passeio publicado ainda.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {tours.map((t) => (
              <Card key={t.id} className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-heading">{t.name}</p>
                    {t.marketplace_suspended_at && <Badge tone="red">Suspenso</Badge>}
                  </div>
                  <p className="text-xs text-muted">
                    {t.companies?.name} · {t.destination || "sem destino"} · publicado em {fmtDate(t.created_at)}
                  </p>
                  {t.marketplace_suspended_at && t.marketplace_suspension_reason && (
                    <p className="mt-1 text-xs text-danger">Motivo: {t.marketplace_suspension_reason}</p>
                  )}
                </div>
                <SuspendControls tourId={t.id} suspended={!!t.marketplace_suspended_at} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
