import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { brl, fmtDate } from "@/lib/format";
import { PayPlanButton } from "../pay-plan-button";

const DIAS_PARA_AVISAR_VENCIMENTO = 7;

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
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [{ data: plansData }, { data: subData }, vesselsCount, reservasMes] = await Promise.all([
    supabase.from("plans").select("code, name, price_cents, max_vessels, max_users").order("price_cents"),
    supabase
      .from("subscriptions")
      .select("paid_until, plans(code)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("vessels").select("id", { count: "exact", head: true }),
    supabase.from("reservations").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
  ]);

  const plans = (plansData ?? []) as Plan[];
  const currentPlanCode = (subData as any)?.plans?.code as string | undefined;
  const currentPlan = plans.find((p) => p.code === currentPlanCode);
  const paidUntil = (subData as any)?.paid_until ? new Date((subData as any).paid_until) : null;
  // Server Component: roda de novo a cada requisicao, sem memoizacao do React Compiler
  // envolvida -- Date.now() aqui e seguro, so a regra de pureza nao distingue RSC.
  // eslint-disable-next-line react-hooks/purity
  const daysLeft = paidUntil ? Math.ceil((paidUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const precisaRenovarLogo = daysLeft == null || daysLeft <= DIAS_PARA_AVISAR_VENCIMENTO;

  return (
    <>
      <PageHeader title="Planos" subtitle="Escolha o plano ideal pro tamanho da sua operação." />

      {currentPlan && (
        <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <p>
            Embarcações em uso: <strong className="text-heading">{vesselsCount.count ?? 0}</strong>
            {currentPlan.max_vessels != null && <span className="text-muted"> / {currentPlan.max_vessels}</span>}
          </p>
          <p>
            Reservas este mês: <strong className="text-heading">{reservasMes.count ?? 0}</strong>
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.code === currentPlanCode;
          return (
            <Card key={p.code} className={isCurrent ? "border-brand" : ""}>
              {isCurrent && <p className="mb-1 text-xs font-semibold text-brand">SEU PLANO ATUAL</p>}
              <p className="font-display text-lg font-semibold text-heading">{p.name}</p>
              <p className="mt-1 font-display text-3xl font-semibold text-brand">
                {brl(p.price_cents)}
                <span className="text-sm font-normal text-muted">/mês</span>
              </p>

              <ul className="mt-4 space-y-2 text-sm text-body">
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

              {isCurrent && !precisaRenovarLogo ? (
                <p className="mt-3 text-center text-xs text-muted">
                  Ativo até <span className="font-medium text-heading">{fmtDate(paidUntil!.toISOString())}</span>
                </p>
              ) : (
                <PayPlanButton
                  planCode={p.code}
                  label={isCurrent ? "Renovar plano" : undefined}
                />
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
