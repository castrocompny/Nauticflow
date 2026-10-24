import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireSuperAdminPage } from "@/lib/admin-auth";
import { logSecurityEvent } from "@/lib/security-log";
import { Card, PageHeader, Badge } from "@/components/ui";
import { brl, fmtDate, fmtTime } from "@/lib/format";

// RECONSTRUÇÃO (2026-10-23): fila SOMENTE LEITURA de PAYMENT_RECEIVED verificado
// no Asaas para um payment local em 'failed' (migration 0081, ADR 0007). Não há
// ação de "resolver": qualquer botão aqui teria de decidir o destino do dinheiro
// (estorno, confirmação de reserva, ledger), o que está fora desta fase. A RLS da
// tabela já exige super_admin + aal2; a checagem da página é a primeira barreira.
const PAGE_LIMIT = 100; // shortcut: sem paginação por cursor, subir quando a fila passar disso.

type ExceptionRow = {
  id: string;
  payment_id: string;
  reservation_id: string;
  provider_payment_id: string;
  confirmed_amount_cents: number;
  expected_amount_cents: number;
  detected_at: string;
  companies: { name: string } | null;
};

export default async function PaymentExceptionsPage() {
  const { supabase, user, denied } = await requireSuperAdminPage();
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

  logSecurityEvent("admin_payment_exceptions_viewed", { userId: user.id });

  const { data, error } = await supabase
    .from("marketplace_payment_exceptions")
    .select("id, payment_id, reservation_id, provider_payment_id, confirmed_amount_cents, expected_amount_cents, detected_at, companies(name)")
    .order("detected_at", { ascending: false })
    .limit(PAGE_LIMIT);
  const rows = (data ?? []) as unknown as ExceptionRow[];

  return (
    <div className="min-h-screen bg-app p-6">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Exceções de pagamento"
          subtitle="Pix recebido e confirmado no Asaas para um pagamento que o NauticFlow já tinha dado como falho. O sistema não alterou pagamento, reserva, saldo nem estorno -- a conciliação do dinheiro é manual, fora desta tela."
          action={
            <Link href="/admin" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-body hover:bg-surfaceHover">
              <ArrowLeft size={16} /> Voltar
            </Link>
          }
        />

        {error ? (
          <Card>
            <p className="py-8 text-center text-sm text-danger">Não foi possível carregar a fila. Tente novamente.</p>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-muted">Nenhuma exceção registrada.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-heading">{r.companies?.name ?? "Empresa"}</p>
                  <Badge tone="red">Pagamento recebido após falha</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Detectado em {fmtDate(r.detected_at)} {fmtTime(r.detected_at)} · recebido {brl(r.confirmed_amount_cents)} · esperado {brl(r.expected_amount_cents)}
                </p>
                <p className="mt-1 break-all text-xs text-muted">
                  Pagamento {r.payment_id} · reserva {r.reservation_id} · cobrança Asaas {r.provider_payment_id}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
