import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { Card, PageHeader, Badge } from "@/components/ui";
import { brl, fmtDate } from "@/lib/format";
import { SettingsForm } from "./settings-form";
import { DeleteAccountForm } from "./delete-account-form";

type Invoice = { id: string; number: string | null; amount_cents: number; pdf_url: string | null; issued_at: string };

export default async function ConfiguracoesPage() {
  const supabase = createClient();
  const user = await getProfile();

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, email, company_id, companies(name, cnpj, city, phone, email)")
    .eq("id", user!.id)
    .single();

  const p = profile as any;
  const company = p?.companies ?? {};

  const [subRes, vesselsCount, monthRes, invoicesRes] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("status, paid_until, plans(name, max_vessels, max_users)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("vessels").select("id", { count: "exact", head: true }),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase.from("invoices").select("id, number, amount_cents, pdf_url, issued_at").order("issued_at", { ascending: false }),
  ]);

  const sub = subRes.data as any;
  const plan = sub?.plans ?? {};
  const paidUntil = sub?.paid_until ? new Date(sub.paid_until as string) : null;
  const overdue = paidUntil ? paidUntil < new Date() : false;
  const invoices = (invoicesRes.data ?? []) as Invoice[];

  return (
    <>
      <PageHeader title="Configurações" subtitle="Dados da empresa, do administrador e do plano." />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SettingsForm
            companyName={company.name ?? ""}
            cnpj={company.cnpj ?? ""}
            city={company.city ?? ""}
            phone={company.phone ?? ""}
            companyEmail={company.email ?? ""}
            adminName={p?.name ?? ""}
            adminEmail={p?.email ?? user?.email ?? ""}
          />
        </div>

        <Card className="h-fit">
          <h2 className="mb-3 font-display font-semibold text-heading">Plano contratado</h2>
          <p className="font-display text-2xl font-semibold text-brand">{plan.name ?? "Sem plano"}</p>
          <div className="mb-4 mt-1">
            {!paidUntil ? (
              <Badge tone="slate">sem assinatura</Badge>
            ) : overdue ? (
              <Badge tone="red">vencida desde {fmtDate(paidUntil.toISOString())}</Badge>
            ) : (
              <Badge tone="green">ativa até {fmtDate(paidUntil.toISOString())}</Badge>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Embarcações" value={`${vesselsCount.count ?? 0}${plan.max_vessels != null ? ` / ${plan.max_vessels}` : " / ilimitado"}`} />
            <Row label="Usuários" value={plan.max_users != null ? String(plan.max_users) : "ilimitado"} />
            <Row label="Reservas no mês" value={String(monthRes.count ?? 0)} />
          </div>
          {overdue && (
            <p className="mt-3 text-xs text-muted">
              As opções de pagamento aparecem na faixa amarela no topo das telas enquanto a assinatura estiver
              vencida.
            </p>
          )}
          <Link
            href="/planos"
            className="mt-4 flex items-center justify-between rounded-lg bg-brand px-3 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            Gerenciar plano
            <ChevronRight size={16} />
          </Link>
        </Card>

        <Card className="h-fit lg:col-span-3">
          <h2 className="mb-1 font-display font-semibold text-heading">Notas fiscais</h2>
          <p className="mb-3 text-xs text-muted">Notas emitidas referentes à sua assinatura do NauticFlow.</p>
          {invoices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">Nenhuma nota fiscal registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-heading">{inv.number || "sem número"}</p>
                    <p className="text-xs text-muted">
                      {fmtDate(inv.issued_at)} · {brl(inv.amount_cents)}
                    </p>
                  </div>
                  {inv.pdf_url && (
                    <a href={inv.pdf_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">
                      Ver PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="lg:col-span-3">
          <DeleteAccountForm isCompanyAdmin={user?.role === "company_admin"} companyName={company.name ?? ""} />
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line py-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-heading">{value}</span>
    </div>
  );
}
