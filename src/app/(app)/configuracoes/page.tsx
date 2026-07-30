import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
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
      .select("status, plans(name, max_vessels, max_users)")
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
          <p className="mb-4 text-xs text-slate-500">Situação: {sub?.status ?? "indefinida"}</p>
          <div className="space-y-2 text-sm">
            <Row label="Embarcações" value={`${vesselsCount.count ?? 0}${plan.max_vessels != null ? ` / ${plan.max_vessels}` : " / ilimitado"}`} />
            <Row label="Usuários" value={plan.max_users != null ? String(plan.max_users) : "ilimitado"} />
            <Row label="Reservas no mês" value={String(monthRes.count ?? 0)} />
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Gestão de pagamento e troca de plano entram em uma etapa futura.
          </p>
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
