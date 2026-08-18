import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert, Search, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Badge } from "@/components/ui";
import { brl, fmtDate } from "@/lib/format";
import { RenewButton } from "./renew-button";
import { NewCompaniesChart, FunnelChart, PlanDistributionChart } from "./charts";

const PAGE_SIZE = 20;
const VENCE_EM_BREVE_DIAS = 3;
const ONBOARDING_TRAVADO_DIAS = 7;
const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type SubRow = {
  status: string;
  paid_until: string | null;
  created_at: string;
  asaas_subscription_id: string | null;
  plans: { code: string; name: string; price_cents: number } | null;
};
type Company = {
  id: string;
  name: string;
  cnpj: string | null;
  city: string | null;
  created_at: string;
  suspended_at: string | null;
  subscriptions: SubRow[];
};

function latestSub(c: Company): SubRow | undefined {
  return [...(c.subscriptions ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

// rank menor = mais urgente, aparece primeiro na lista
function situacao(c: Company, now: Date) {
  const sub = latestSub(c);
  const paidUntil = sub?.paid_until ? new Date(sub.paid_until) : null;
  const isTrial = !sub?.asaas_subscription_id;

  if (c.suspended_at) return { rank: 0, tone: "red" as const, label: "Suspensa", paidUntil, isTrial, sub };
  if (!paidUntil) return { rank: 3, tone: "slate" as const, label: "Sem assinatura", paidUntil, isTrial, sub };
  if (paidUntil < now) return { rank: 1, tone: "red" as const, label: `Vencida desde ${fmtDate(paidUntil.toISOString())}`, paidUntil, isTrial, sub };

  const diasRestantes = Math.ceil((paidUntil.getTime() - now.getTime()) / 86400000);
  if (diasRestantes <= VENCE_EM_BREVE_DIAS)
    return { rank: 2, tone: "amber" as const, label: `Vence em ${diasRestantes}d (${fmtDate(paidUntil.toISOString())})`, paidUntil, isTrial, sub };

  return {
    rank: 3,
    tone: "green" as const,
    label: `${isTrial ? "Trial até" : "Paga até"} ${fmtDate(paidUntil.toISOString())}`,
    paidUntil,
    isTrial,
    sub,
  };
}

export default async function AdminPage(
  props: { searchParams: Promise<{ q?: string; page?: string; plano?: string }> }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") {
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

  // painel de uso baixo (1 pessoa, poucas dezenas de empresas nesta fase) -- busca tudo
  // e faz filtro/ordenação/paginação em memória em vez de montar query dinâmica no banco
  const [{ data }, { data: plansData }, { data: vesselsData }] = await Promise.all([
    supabase
      .from("companies")
      .select(
        "id, name, cnpj, city, created_at, suspended_at, subscriptions(status, paid_until, created_at, asaas_subscription_id, plans(code, name, price_cents))"
      )
      .order("created_at", { ascending: false }),
    supabase.from("plans").select("code, name, price_cents").order("price_cents"),
    // conta embarcacoes por empresa pra detectar "onboarding travado" (ver abaixo) --
    // so funciona porque a migration 0016 deu ao super admin SELECT em vessels de
    // qualquer empresa
    supabase.from("vessels").select("company_id"),
  ]);

  const allCompanies = (data ?? []) as unknown as Company[];
  const plans = (plansData ?? []) as { code: string; name: string; price_cents: number }[];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const vesselCountByCompany = new Map<string, number>();
  for (const v of (vesselsData ?? []) as { company_id: string }[]) {
    vesselCountByCompany.set(v.company_id, (vesselCountByCompany.get(v.company_id) ?? 0) + 1);
  }
  const isOnboardingTravado = (c: Company) => {
    const diasDesdeCadastro = (now.getTime() - new Date(c.created_at).getTime()) / 86400000;
    return diasDesdeCadastro > ONBOARDING_TRAVADO_DIAS && (vesselCountByCompany.get(c.id) ?? 0) === 0;
  };

  // metricas sempre sobre o conjunto inteiro, independente da busca/pagina atual
  let mrrCents = 0;
  let suspensas = 0;
  let vencidas = 0;
  let trial = 0;
  let pagando = 0;
  let novasEsteMes = 0;
  let onboardingTravado = 0;
  let jamaisPagou = 0;
  for (const c of allCompanies) {
    const s = situacao(c, now);
    if (c.suspended_at) suspensas++;
    else if (s.rank === 1) vencidas++;
    else if (s.isTrial) trial++;
    else {
      pagando++;
      mrrCents += s.sub?.plans?.price_cents ?? 0;
    }
    if (!s.sub?.asaas_subscription_id) jamaisPagou++;
    if (new Date(c.created_at) >= monthStart) novasEsteMes++;
    if (isOnboardingTravado(c)) onboardingTravado++;
  }

  // "empresas novas por mes", ultimos 12 meses (incluindo o atual)
  const monthlySignups = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const count = allCompanies.filter((c) => {
      const created = new Date(c.created_at);
      return created >= d && created < next;
    }).length;
    return { label: MONTH_LABELS[d.getMonth()], count };
  });

  // funil: cadastro -> ja converteu (pagou via Asaas alguma vez) -> pagando agora
  const funnelStages = [
    { label: "Total de cadastros", count: allCompanies.length },
    { label: "Já converteu (pagou via Asaas)", count: allCompanies.length - jamaisPagou },
    { label: "Pagando agora", count: pagando },
  ];

  // distribuicao por plano atual (so quem esta pagando/em trial ativo -- vencida/suspensa
  // ainda conta pro plano que tinha)
  const planCounts = new Map<string, number>();
  for (const p of plans) planCounts.set(p.name, 0);
  let semPlano = 0;
  for (const c of allCompanies) {
    const name = latestSub(c)?.plans?.name;
    if (!name) semPlano++;
    else planCounts.set(name, (planCounts.get(name) ?? 0) + 1);
  }
  const planDistribution = [
    ...plans.map((p) => ({ name: p.name, count: planCounts.get(p.name) ?? 0 })),
    ...(semPlano > 0 ? [{ name: "Sem plano", count: semPlano }] : []),
  ];

  const q = (searchParams.q ?? "").trim().toLowerCase();
  const planoFiltro = searchParams.plano ?? "";
  let filtered = q
    ? allCompanies.filter((c) => c.name.toLowerCase().includes(q) || (c.cnpj ?? "").toLowerCase().includes(q))
    : allCompanies;
  if (planoFiltro) filtered = filtered.filter((c) => latestSub(c)?.plans?.code === planoFiltro);

  const sorted = [...filtered].sort((a, b) => {
    const sa = situacao(a, now);
    const sb = situacao(b, now);
    if (sa.rank !== sb.rank) return sa.rank - sb.rank;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const page = Math.max(1, Number(searchParams.page) || 1);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageCompanies = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const pageHref = (p: number) =>
    `/admin?${q ? `q=${encodeURIComponent(q)}&` : ""}${planoFiltro ? `plano=${planoFiltro}&` : ""}page=${p}`;

  return (
    <div className="min-h-screen bg-app p-6">
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Administração NauticFlow" subtitle="Empresas cadastradas e status de pagamento." />

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          <Metric label="Empresas" value={String(allCompanies.length)} />
          <Metric label="MRR" value={brl(mrrCents)} tone="text-ok" />
          <Metric label="Pagando" value={String(pagando)} />
          <Metric label="Em trial" value={String(trial)} />
          <Metric label="Vencidas" value={String(vencidas)} tone={vencidas > 0 ? "text-danger" : undefined} />
          <Metric label="Suspensas" value={String(suspensas)} tone={suspensas > 0 ? "text-danger" : undefined} />
          <Metric label="Onboarding travado" value={String(onboardingTravado)} tone={onboardingTravado > 0 ? "text-amberflow" : undefined} />
        </div>
        <p className="mb-5 text-xs text-muted">{novasEsteMes} empresa(s) nova(s) este mês.</p>

        <div className="mb-5 grid gap-4 lg:grid-cols-3">
          <Card>
            <h2 className="mb-3 font-display text-sm font-semibold text-heading">Empresas novas por mês</h2>
            <NewCompaniesChart months={monthlySignups} />
          </Card>
          <Card>
            <h2 className="mb-3 font-display text-sm font-semibold text-heading">Funil trial → pagante</h2>
            <FunnelChart stages={funnelStages} />
          </Card>
          <Card>
            <h2 className="mb-3 font-display text-sm font-semibold text-heading">Distribuição por plano</h2>
            <PlanDistributionChart plans={planDistribution} />
          </Card>
        </div>

        <form className="mb-4 flex flex-wrap items-center gap-2" action="/admin">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nome ou CNPJ..."
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select name="plano" defaultValue={planoFiltro} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <option value="">Todos os planos</option>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-body hover:bg-surfaceHover">
            Filtrar
          </button>
          {(q || planoFiltro) && (
            <Link href="/admin" className="text-xs text-muted hover:text-body">
              Limpar
            </Link>
          )}
        </form>

        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3">Plano</th>
                <th className="px-4 py-3">Cadastro</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pageCompanies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                    Nenhuma empresa encontrada.
                  </td>
                </tr>
              ) : (
                pageCompanies.map((c) => {
                  const s = situacao(c, now);
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-medium text-heading">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/admin/${c.id}`} className="hover:text-brand">
                            {c.name}
                          </Link>
                          {isOnboardingTravado(c) && (
                            <span title="Cadastrada há mais de 7 dias, sem nenhuma embarcação cadastrada">
                              <AlertTriangle size={13} className="text-amberflow" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-normal text-muted">{c.cnpj || "CNPJ não informado"}</div>
                      </td>
                      <td className="px-4 py-3 text-body">{c.city ?? "-"}</td>
                      <td className="px-4 py-3 text-body">
                        {s.sub?.plans?.name ?? "-"} {s.isTrial && s.sub && <span className="text-xs text-muted">(trial)</span>}
                      </td>
                      <td className="px-4 py-3 text-muted">{fmtDate(c.created_at)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RenewButton companyId={c.id} plans={plans} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <Link
              href={pageHref(page - 1)}
              aria-disabled={page <= 1}
              className={`rounded-lg border border-line px-3 py-1.5 ${
                page <= 1 ? "pointer-events-none text-muted" : "text-body hover:bg-surfaceHover"
              }`}
            >
              Anterior
            </Link>
            <span className="text-xs text-muted">
              Página {page} de {totalPages} · {sorted.length} empresa(s)
            </span>
            <Link
              href={pageHref(page + 1)}
              aria-disabled={page >= totalPages}
              className={`rounded-lg border border-line px-3 py-1.5 ${
                page >= totalPages ? "pointer-events-none text-muted" : "text-body hover:bg-surfaceHover"
              }`}
            >
              Próxima
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${tone ?? "text-heading"}`}>{value}</p>
    </Card>
  );
}
