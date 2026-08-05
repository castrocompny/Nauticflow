import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { brl } from "@/lib/format";
import { PayPlanButton } from "../pay-plan-button";

const commonFeatures = [
  "Dashboard com indicadores do dia",
  "Reservas com controle de vagas em tempo real",
  "Agenda e saídas programadas",
  "Cadastro de clientes e parceiros",
  "Financeiro e relatórios",
  "Manifesto de passageiros e voucher automático por e-mail",
];

const planExtras: Record<string, string[]> = {
  start: [],
  profissional: ["Suporte prioritário"],
  premium: ["Suporte prioritário"],
};

type Plan = { code: string; name: string; price_cents: number; max_vessels: number | null; max_users: number | null };

export default async function PlanosPage() {
  const supabase = createClient();

  const [{ data: plansData }, { data: subData }] = await Promise.all([
    supabase.from("plans").select("code, name, price_cents, max_vessels, max_users").order("price_cents"),
    supabase.from("subscriptions").select("plans(code)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const plans = (plansData ?? []) as Plan[];
  const currentPlanCode = (subData as any)?.plans?.code as string | undefined;

  return (
    <>
      <PageHeader title="Planos" subtitle="Escolha o plano ideal pro tamanho da sua operação." />

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.code === currentPlanCode;
          return (
            <Card key={p.code} className={isCurrent ? "border-brand" : ""}>
              {isCurrent && <p className="mb-1 text-xs font-semibold text-brand">SEU PLANO ATUAL</p>}
              <p className="font-display text-lg font-semibold text-navy">{p.name}</p>
              <p className="mt-1 font-display text-3xl font-semibold text-brand">
                {brl(p.price_cents)}
                <span className="text-sm font-normal text-slate-400">/mês</span>
              </p>

              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li className="flex items-center gap-2">
                  <Check size={16} className="shrink-0 text-ok" />
                  {p.max_vessels != null ? `até ${p.max_vessels} embarcação(ões)` : "embarcações ilimitadas"}
                </li>
                <li className="flex items-center gap-2">
                  <Check size={16} className="shrink-0 text-ok" />
                  {p.max_users != null ? `até ${p.max_users} usuário(s)` : "usuários ilimitados"}
                </li>
                {commonFeatures.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check size={16} className="shrink-0 text-ok" />
                    {f}
                  </li>
                ))}
                {(planExtras[p.code] ?? []).map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check size={16} className="shrink-0 text-ok" />
                    {f}
                  </li>
                ))}
              </ul>

              <PayPlanButton planCode={p.code} label={isCurrent ? "Renovar plano" : undefined} />
            </Card>
          );
        })}
      </div>
    </>
  );
}
