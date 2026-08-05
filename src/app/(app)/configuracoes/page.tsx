import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { SettingsForm } from "./settings-form";

export default async function ConfiguracoesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, email, company_id, companies(name, cnpj, city, phone, email)")
    .eq("id", user!.id)
    .single();

  const p = profile as any;
  const company = p?.companies ?? {};

  const [subRes, vesselsCount, monthRes] = await Promise.all([
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
  ]);

  const sub = subRes.data as any;
  const plan = sub?.plans ?? {};
  const paidUntil = sub?.paid_until ? new Date(sub.paid_until as string) : null;
  const overdue = paidUntil ? paidUntil < new Date() : false;

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
          <h2 className="mb-3 font-display font-semibold text-navy">Plano contratado</h2>
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
            <p className="mt-4 text-xs text-slate-400">
              As opções de pagamento aparecem na faixa amarela no topo das telas enquanto a assinatura estiver
              vencida.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-navy">{value}</span>
    </div>
  );
}
