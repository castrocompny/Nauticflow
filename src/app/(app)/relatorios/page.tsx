import Link from "next/link";
import { redirect } from "next/navigation";
import { TrendingUp, Gauge, Ship, Compass, Handshake } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { BarsChart } from "@/components/bars-chart";
import { brl, saoPauloDayKey, saoPauloStartOfDay, saoPauloStartOfMonth, saoPauloStartOfYear } from "@/lib/format";

// Relatorios = analise/desempenho (contraste com Dashboard = operacao de
// hoje, ver DOCUMENTACAO.md). Consolida aqui tudo que era "Desempenho do
// periodo" + rankings do Dashboard antigo -- mesma logica de calculo, so
// realocada, sem reescrever do zero.
const PERIODS = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "ano", label: "Ano atual" },
];

function periodStartFor(p: string, now: Date): Date {
  if (p === "mes") return saoPauloStartOfMonth(now);
  if (p === "ano") return saoPauloStartOfYear(now);
  if (p === "hoje") return saoPauloStartOfDay(now);
  const days = p === "7d" ? 6 : p === "90d" ? 89 : 29;
  return new Date(saoPauloStartOfDay(now).getTime() - days * 24 * 60 * 60 * 1000);
}

export default async function RelatoriosPage(props: { searchParams: Promise<{ p?: string }> }) {
  // relatorios de faturamento/desempenho nao sao coisa de operador (staff) ver
  const profile = await getProfile();
  if (profile?.role === "staff") redirect("/dashboard");

  const searchParams = await props.searchParams;
  const p = PERIODS.some((o) => o.key === searchParams.p) ? (searchParams.p as string) : "30d";
  const now = new Date();
  const periodStart = periodStartFor(p, now);

  const supabase = createClient();
  const [periodResRes, periodDepsRes] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        "id, total_cents, status, created_at, partner_id, client_id, departures(vessels(name), tours(name)), partners(name), clients(created_at)"
      )
      .gte("created_at", periodStart.toISOString()),
    supabase
      .from("departures")
      .select("departs_at, capacity, vessels(name), reservations(people_count, status)")
      .gte("departs_at", periodStart.toISOString()),
  ]);

  const periodRes = (periodResRes.data ?? []) as any[];
  const periodDeps = (periodDepsRes.data ?? []) as any[];
  const semDados = periodRes.length === 0 && periodDeps.length === 0;

  const booked = (d: any) =>
    (d.reservations ?? []).filter((x: any) => x.status === "confirmada").reduce((s: number, x: any) => s + x.people_count, 0);

  const periodConfirmadas = periodRes.filter((r) => r.status === "confirmada");
  const periodCanceladas = periodRes.filter((r) => r.status === "cancelada");
  const periodPendentes = periodRes.filter((r) => r.status === "pendente");
  const receitaPeriodo = periodConfirmadas.reduce((s, r) => s + r.total_cents, 0);
  const ticketMedio = periodConfirmadas.length ? Math.round(receitaPeriodo / periodConfirmadas.length) : 0;
  const taxaCancelamento = periodRes.length ? Math.round((periodCanceladas.length / periodRes.length) * 100) : 0;
  const taxaPendencia = periodRes.length ? Math.round((periodPendentes.length / periodRes.length) * 100) : 0;

  // clientes novos vs recorrentes no periodo
  const clientFirstSeen = new Map<string, string | null>();
  periodRes.forEach((r) => {
    if (r.client_id && !clientFirstSeen.has(r.client_id)) clientFirstSeen.set(r.client_id, r.clients?.created_at ?? null);
  });
  let novosClientes = 0;
  let clientesRecorrentes = 0;
  clientFirstSeen.forEach((createdAt) => {
    if (createdAt && new Date(createdAt) >= periodStart) novosClientes++;
    else clientesRecorrentes++;
  });

  // series diarias do periodo (receita por data da reserva, ocupacao por data da saida)
  const dayKeys: string[] = [];
  const dayDates: Date[] = [];
  const todayStartSP = saoPauloStartOfDay(now);
  for (let d = saoPauloStartOfDay(periodStart); d.getTime() <= todayStartSP.getTime(); d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    dayKeys.push(saoPauloDayKey(d.toISOString()));
    dayDates.push(new Date(d));
  }
  const keyOf = (iso: string) => saoPauloDayKey(iso);

  const revByDay: Record<string, number> = Object.fromEntries(dayKeys.map((k) => [k, 0]));
  periodConfirmadas.forEach((r) => {
    const k = keyOf(r.created_at);
    if (k in revByDay) revByDay[k] += r.total_cents;
  });
  const revSeries = dayKeys.map((k) => revByDay[k] / 100);

  const occAgg: Record<string, { sum: number; n: number }> = Object.fromEntries(dayKeys.map((k) => [k, { sum: 0, n: 0 }]));
  const vesselOcc: Record<string, { sum: number; n: number }> = {};
  periodDeps.forEach((d) => {
    const pct = d.capacity ? (booked(d) / d.capacity) * 100 : 0;
    const k = keyOf(d.departs_at);
    if (k in occAgg) {
      occAgg[k].sum += pct;
      occAgg[k].n += 1;
    }
    const vn = d.vessels?.name ?? "Sem embarcação";
    vesselOcc[vn] = vesselOcc[vn] ?? { sum: 0, n: 0 };
    vesselOcc[vn].sum += pct;
    vesselOcc[vn].n += 1;
  });
  const occSeries = dayKeys.map((k) => (occAgg[k].n ? Math.round(occAgg[k].sum / occAgg[k].n) : 0));
  const occMediaPeriodo = occSeries.length ? Math.round(occSeries.reduce((s, v) => s + v, 0) / occSeries.length) : 0;

  // ranking por embarcacao, passeio e parceiro (receita, confirmadas)
  type Agg = { count: number; revenue: number };
  const bump = (agg: Agg | undefined, cents: number): Agg => ({ count: (agg?.count ?? 0) + 1, revenue: (agg?.revenue ?? 0) + cents });
  const byVessel: Record<string, Agg> = {};
  const byTour: Record<string, Agg> = {};
  const byPartner: Record<string, Agg> = {};
  periodConfirmadas.forEach((r) => {
    const vn = r.departures?.vessels?.name ?? "Sem embarcação";
    const tn = r.departures?.tours?.name ?? "Sem passeio";
    const pn = r.partners?.name ?? "Direto (sem parceiro)";
    byVessel[vn] = bump(byVessel[vn], r.total_cents);
    byTour[tn] = bump(byTour[tn], r.total_cents);
    byPartner[pn] = bump(byPartner[pn], r.total_cents);
  });

  const vesselRanking = Object.entries(byVessel)
    .map(([name, agg]) => ({
      name,
      ...agg,
      occupancy: vesselOcc[name]?.n ? Math.round(vesselOcc[name].sum / vesselOcc[name].n) : null,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
  const tourRanking = Object.entries(byTour)
    .map(([name, agg]) => ({ name, ...agg }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
  const partnerRanking = Object.entries(byPartner)
    .map(([name, agg]) => ({ name, ...agg }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  const dayLabel = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const periodoLabel = (PERIODS.find((o) => o.key === p)?.label ?? "período").toLowerCase();

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Indicadores do período selecionado." />

      <div className="mb-5 flex flex-wrap gap-2">
        {PERIODS.map((opt) => (
          <Link
            key={opt.key}
            href={`/relatorios?p=${opt.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              p === opt.key ? "border-brand bg-brand text-white" : "border-line bg-surface text-body hover:bg-surfaceHover"
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {semDados ? (
        <EmptyState title="Sem dados no período" hint="Quando houver reservas e saídas neste intervalo, os números aparecem aqui." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniStat label={`Receita ${periodoLabel}`} value={brl(receitaPeriodo)} sub={`${periodConfirmadas.length} confirmadas`} />
            <MiniStat label="Ticket médio" value={brl(ticketMedio)} />
            <MiniStat label="Ocupação média" value={`${occMediaPeriodo}%`} />
            <MiniStat label="Reservas confirmadas" value={String(periodConfirmadas.length)} />
            <MiniStat label="Cancelamento" value={`${taxaCancelamento}%`} tone="text-danger" sub={`${periodCanceladas.length} canceladas`} />
            <MiniStat label="Pendências" value={`${taxaPendencia}%`} sub={`${periodPendentes.length} pendentes`} />
            <MiniStat label="Clientes novos" value={String(novosClientes)} />
            <MiniStat label="Clientes recorrentes" value={String(clientesRecorrentes)} />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-heading">Receita {periodoLabel}</h3>
                <TrendingUp size={18} className="text-ok" />
              </div>
              <p className="mb-3 text-sm text-muted">Total: {brl(revSeries.reduce((s, v) => s + v, 0) * 100)}</p>
              <BarsChart
                points={revSeries.map((v, i) => ({ label: dayLabel(dayDates[i]), value: v }))}
                color="#2563EB"
                formatType="brl"
              />
            </Card>
            <Card>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-heading">Ocupação {periodoLabel}</h3>
                <Gauge size={18} className="text-amberflow" />
              </div>
              <p className="mb-3 text-sm text-muted">Média: {occMediaPeriodo}%</p>
              <BarsChart
                points={occSeries.map((v, i) => ({ label: dayLabel(dayDates[i]), value: v }))}
                color="#F59E0B"
                formatType="percent"
              />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <RankingList
              icon={<Ship size={18} className="text-brand" />}
              title="Embarcações"
              emptyLabel="Sem reservas confirmadas no período."
              rows={vesselRanking.map((v) => ({
                name: v.name,
                primary: brl(v.revenue),
                secondary: v.occupancy != null ? `${v.occupancy}% ocup.` : undefined,
                barPct: vesselRanking[0] ? (v.revenue / vesselRanking[0].revenue) * 100 : 0,
              }))}
            />
            <RankingList
              icon={<Compass size={18} className="text-brand" />}
              title="Passeios mais vendidos"
              emptyLabel="Sem reservas confirmadas no período."
              rows={tourRanking.map((t) => ({
                name: t.name,
                primary: `${t.count} reservas`,
                secondary: brl(t.revenue),
                barPct: tourRanking[0] ? (t.revenue / tourRanking[0].revenue) * 100 : 0,
              }))}
            />
            <RankingList
              icon={<Handshake size={18} className="text-brand" />}
              title="Origem das reservas"
              emptyLabel="Sem reservas confirmadas no período."
              rows={partnerRanking.map((pt) => ({
                name: pt.name,
                primary: brl(pt.revenue),
                secondary: `${pt.count} reservas`,
                barPct: partnerRanking[0] ? (pt.revenue / partnerRanking[0].revenue) * 100 : 0,
              }))}
            />
          </div>
        </>
      )}
    </>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${tone ?? "text-heading"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

function RankingList({
  icon,
  title,
  rows,
  emptyLabel,
}: {
  icon: React.ReactNode;
  title: string;
  rows: { name: string; primary: string; secondary?: string; barPct: number }[];
  emptyLabel: string;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="font-display text-base font-semibold text-heading">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.name}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-heading">{r.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {r.primary}
                  {r.secondary ? ` · ${r.secondary}` : ""}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surfaceHover">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.min(r.barPct, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
