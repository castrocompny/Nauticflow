import { ScrollShadowX } from "@/components/scroll-shadow-x";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireSuperAdminPage } from "@/lib/admin-auth";
import { Card, PageHeader, Badge, OccupancyBar } from "@/components/ui";
import { brl, fmtDate } from "@/lib/format";
import { RenewButton } from "../renew-button";
import { ChangePlanButton } from "./change-plan-button";
import { SuspendControls } from "./suspend-controls";
import { DeleteCompanyControls } from "./delete-company-controls";
import { BillingForm } from "./billing-form";
import { InvoiceForm } from "./invoice-form";
import { DeleteButton } from "@/components/delete-button";
import { deleteInvoice } from "../actions";

type Sub = {
  id: string;
  status: string;
  paid_until: string | null;
  created_at: string;
  asaas_subscription_id: string | null;
  plans: { name: string; price_cents: number; max_vessels: number | null; max_users: number | null } | null;
};
type LogRow = { id: string; admin_name: string | null; action: string; details: Record<string, unknown> | null; created_at: string };
type Invoice = { id: string; number: string | null; amount_cents: number; pdf_url: string | null; issued_at: string; notes: string | null };

const ACTION_LABEL: Record<string, string> = {
  renovar_assinatura: "Renovou assinatura",
  trocar_plano: "Trocou plano",
  suspender_empresa: "Suspendeu empresa",
  reativar_empresa: "Reativou empresa",
  editar_dados_empresa: "Editou dados da empresa",
  registrar_nota_fiscal: "Registrou nota fiscal",
  excluir_nota_fiscal: "Excluiu registro de nota fiscal",
};

export default async function AdminCompanyPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { supabase, denied } = await requireSuperAdminPage();
  if (denied) {
    return (
      <div className="grid min-h-screen place-items-center bg-app p-6">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-danger">
            <ShieldAlert size={24} />
          </div>
          <h1 className="font-display text-lg font-semibold text-heading">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted">Esta área é só para administração do NauticFlow.</p>
        </div>
      </div>
    );
  }

  const [{ data: company }, { data: subs }, { data: plansData }, vesselsRes, usersRes, { data: logs }, { data: invoicesData }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id, name, cnpj, city, phone, email, created_at, suspended_at, suspended_reason, asaas_customer_id")
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("subscriptions")
        .select("id, status, paid_until, created_at, asaas_subscription_id, plans(name, price_cents, max_vessels, max_users)")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false }),
      supabase.from("plans").select("code, name, price_cents").order("price_cents"),
      supabase.from("vessels").select("id", { count: "exact", head: true }).eq("company_id", params.id),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", params.id),
      supabase
        .from("admin_audit_log")
        .select("id, admin_name, action, details, created_at")
        .eq("target_company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("invoices")
        .select("id, number, amount_cents, pdf_url, issued_at, notes")
        .eq("company_id", params.id)
        .order("issued_at", { ascending: false }),
    ]);

  if (!company) notFound();

  const subscriptions = (subs ?? []) as unknown as Sub[];
  const plans = (plansData ?? []) as { code: string; name: string; price_cents: number }[];
  const invoices = (invoicesData ?? []) as Invoice[];
  const current = subscriptions[0];
  const paidUntil = current?.paid_until ? new Date(current.paid_until) : null;
  const now = new Date();
  const overdue = paidUntil ? paidUntil < now : false;
  const isTrial = current ? !current.asaas_subscription_id : false;

  const vesselsUsed = vesselsRes.count ?? 0;
  const usersUsed = usersRes.count ?? 0;
  const maxVessels = current?.plans?.max_vessels ?? null;
  const maxUsers = current?.plans?.max_users ?? null;

  return (
    <div className="min-h-screen bg-app p-6">
      <div className="mx-auto max-w-4xl">
        <Link href="/admin" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-body">
          <ArrowLeft size={16} /> Voltar
        </Link>

        <PageHeader
          title={company.name}
          subtitle={company.cnpj || "CNPJ não informado"}
          action={
            company.suspended_at ? (
              <Badge tone="red">Suspensa</Badge>
            ) : overdue ? (
              <Badge tone="red">Vencida</Badge>
            ) : (
              <Badge tone="green">Ativa</Badge>
            )
          }
        />

        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-display text-sm font-semibold text-heading">Dados da empresa</h2>
            <BillingForm companyId={company.id} cnpj={company.cnpj ?? ""} city={company.city ?? ""} />
            <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
              <p>Telefone: {company.phone ?? "-"}</p>
              <p>E-mail: {company.email ?? "-"}</p>
              <p>Cadastro: {fmtDate(company.created_at)}</p>
              <p>Cliente Asaas: {company.asaas_customer_id ?? "ainda não vinculado"}</p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-display text-sm font-semibold text-heading">Assinatura</h2>
            <div className="space-y-2 text-sm">
              <p>
                Plano atual: <strong className="text-heading">{current?.plans?.name ?? "sem plano"}</strong>
                {isTrial && <span className="ml-1 text-xs text-muted">(trial, nunca pagou via Asaas)</span>}
              </p>
              <p className="text-muted">
                {paidUntil ? `${overdue ? "Venceu" : "Vence"} em ${fmtDate(paidUntil.toISOString())}` : "Sem data de vencimento"}
              </p>
            </div>
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <RenewButton companyId={company.id} plans={plans} />
              <ChangePlanButton companyId={company.id} plans={plans} currentPlanName={current?.plans?.name ?? "-"} />
            </div>
          </Card>
        </div>

        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-display text-sm font-semibold text-heading">Uso do plano</h2>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs text-muted">Embarcações: {vesselsUsed}{maxVessels != null ? ` / ${maxVessels}` : " (sem limite)"}</p>
                {maxVessels != null && <OccupancyBar booked={vesselsUsed} capacity={maxVessels} />}
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">Usuários: {usersUsed}{maxUsers != null ? ` / ${maxUsers}` : " (sem limite)"}</p>
                {maxUsers != null && <OccupancyBar booked={usersUsed} capacity={maxUsers} />}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-display text-sm font-semibold text-heading">Suspensão manual</h2>
            <p className="mb-3 text-xs text-muted">
              Independente do vencimento da assinatura — bloqueia cadastro de coisa nova imediatamente.
            </p>
            <SuspendControls companyId={company.id} suspended={!!company.suspended_at} reason={company.suspended_reason} />
          </Card>
        </div>

        <Card className="mb-5">
          <h2 className="mb-1 font-display text-sm font-semibold text-heading">Zona de risco</h2>
          <p className="mb-3 text-xs text-muted">Cancelamento definitivo — diferente de suspender, aqui não tem volta.</p>
          <DeleteCompanyControls companyId={company.id} companyName={company.name} />
        </Card>

        <Card className="mb-5 p-0">
          <h2 className="px-5 py-4 font-display text-sm font-semibold text-heading">Histórico de assinaturas</h2>
          {subscriptions.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">Nenhuma assinatura registrada.</p>
          ) : (
            <ScrollShadowX>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs text-muted">
                  <th className="px-5 py-2.5">Criada em</th>
                  <th className="px-4 py-2.5">Plano</th>
                  <th className="px-4 py-2.5">Vence em</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Origem</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 text-muted">{fmtDate(s.created_at)}</td>
                    <td className="px-4 py-3 text-heading">
                      {s.plans?.name ?? "-"} {s.plans && <span className="text-xs text-muted">({brl(s.plans.price_cents)})</span>}
                    </td>
                    <td className="px-4 py-3 text-body">{s.paid_until ? fmtDate(s.paid_until) : "-"}</td>
                    <td className="px-4 py-3 text-body">{s.status}</td>
                    <td className="px-5 py-3 text-xs text-muted">{s.asaas_subscription_id ? "Asaas" : "trial / manual"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </ScrollShadowX>
          )}
        </Card>

        <Card className="mb-5">
          <h2 className="mb-1 font-display text-sm font-semibold text-heading">Notas fiscais</h2>
          <p className="mb-3 text-xs text-muted">
            Registro de controle — a emissão de verdade é feita por fora (prefeitura/contador). Aqui só fica anotado o
            que já foi faturado.
          </p>
          <InvoiceForm companyId={company.id} suggestedAmount={current?.plans ? (current.plans.price_cents / 100).toFixed(2).replace(".", ",") : ""} />

          {invoices.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-line pt-4">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-heading">
                      {inv.number || "sem número"} · {brl(inv.amount_cents)}
                    </p>
                    <p className="text-xs text-muted">
                      {fmtDate(inv.issued_at)}
                      {inv.notes ? ` · ${inv.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {inv.pdf_url && (
                      <a href={inv.pdf_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">
                        PDF
                      </a>
                    )}
                    <DeleteButton
                      action={deleteInvoice}
                      id={inv.id}
                      extraFields={{ company_id: company.id }}
                      confirmText="Excluir este registro de nota fiscal?"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-0">
          <h2 className="px-5 py-4 font-display text-sm font-semibold text-heading">Log de auditoria</h2>
          {!logs || logs.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">Nenhuma ação administrativa registrada pra esta empresa ainda.</p>
          ) : (
            <div className="space-y-1 px-5 pb-5">
              {(logs as LogRow[]).map((l) => (
                <div key={l.id} className="border-b border-line py-2.5 text-sm last:border-0">
                  <p className="text-heading">
                    <strong>{ACTION_LABEL[l.action] ?? l.action}</strong>{" "}
                    <span className="text-xs text-muted">por {l.admin_name ?? "admin"} em {fmtDate(l.created_at)}</span>
                  </p>
                  {l.details && Object.keys(l.details).length > 0 && (
                    <p className="text-xs text-muted">{JSON.stringify(l.details)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
