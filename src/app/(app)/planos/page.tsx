import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { PageHeader, Card } from "@/components/ui";
import { PlanCards } from "./plan-cards";
import { CancelSubscriptionButton } from "./cancel-subscription-button";

const DIAS_PARA_AVISAR_VENCIMENTO = 7;

type Plan = {
  code: string;
  name: string;
  price_cents: number;
  price_cents_yearly: number | null;
  max_vessels: number | null;
  max_users: number | null;
};

export default async function PlanosPage(props: {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}) {
  // ?plan=... e ?cycle=... vem do cadastro quando o usuario escolheu plano/ciclo na
  // landing -- destaca o card certo e ja abre o toggle no ciclo escolhido.
  const { plan: planParam, cycle: cycleParam } = await props.searchParams;
  const preselected = ["start", "profissional", "premium"].includes(planParam ?? "")
    ? planParam
    : undefined;
  const initialCycle = cycleParam === "anual" ? "anual" : "mensal";

  const supabase = createClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [{ data: plansData }, { data: subData }, vesselsCount, reservasMes, profile] = await Promise.all([
    supabase
      .from("plans")
      .select("code, name, price_cents, price_cents_yearly, max_vessels, max_users")
      .order("price_cents"),
    supabase
      .from("subscriptions")
      .select("paid_until, status, asaas_subscription_id, plans(code)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("vessels").select("id", { count: "exact", head: true }),
    supabase.from("reservations").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    getProfile(),
  ]);

  const plans = (plansData ?? []) as Plan[];
  const currentPlanCode = (subData as any)?.plans?.code as string | undefined;
  const currentPlan = plans.find((p) => p.code === currentPlanCode);
  const paidUntil = (subData as any)?.paid_until ? new Date((subData as any).paid_until) : null;
  const canCancel =
    (profile?.role === "company_admin" || profile?.role === "super_admin") &&
    !!(subData as any)?.asaas_subscription_id &&
    (subData as any)?.status !== "cancelada";
  const isCancelada = (subData as any)?.status === "cancelada";
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

      <PlanCards
        plans={plans}
        currentPlanCode={currentPlanCode}
        preselected={preselected}
        initialCycle={initialCycle}
        precisaRenovarLogo={precisaRenovarLogo}
        paidUntilISO={paidUntil ? paidUntil.toISOString() : null}
      />

      {isCancelada && (
        <Card className="mt-4 text-sm text-muted">
          Sua assinatura está <strong className="text-heading">cancelada</strong> — você não será cobrado de novo.
          {paidUntil && <> Acesso liberado até <strong className="text-heading">{paidUntil.toLocaleDateString("pt-BR")}</strong>.</>}{" "}
          Pra continuar depois disso, escolha um plano acima quando quiser.
        </Card>
      )}
      {canCancel && <CancelSubscriptionButton />}
    </>
  );
}
