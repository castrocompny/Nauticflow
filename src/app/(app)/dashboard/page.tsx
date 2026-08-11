import Link from "next/link";
import {
  CalendarCheck,
  DollarSign,
  Gauge,
  Users,
  Ship,
  Plus,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Compass,
  Handshake,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { brl, fmtTime, fmtDate, startEndOfToday } from "@/lib/format";
import { getProfile } from "@/lib/profile";
import { Card, Badge } from "@/components/ui";
import { BarsChart } from "./bars-chart";

const PERIODS = [
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "mes", label: "Mês atual" },
];

function periodStartFor(p: string, now: Date): Date {
  if (p === "mes") return new Date(now.getFullYear(), now.getMonth(), 1);
  const days = p === "7d" ? 6 : p === "90d" ? 89 : 29;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

export default async function Dashboard({ searchParams }: { searchParams: { p?: string } }) {
  const p = PERIODS.some((o) => o.key === searchParams.p) ? (searchParams.p as string) : "30d";
  const supabase = createClient();
  const profile = await getProfile();

  const now = new Date();
  const { start: todayStart, end: todayEnd } = startEndOfToday();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const d30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const periodStart = periodStartFor(p, now);
  const next7End = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

  const [todayRes, recentRes, depsRes, clientsRes, lastResRes, prevMonthRes, periodResRes, periodDepsRes, next7Res] =
    await Promise.all([
      supabase
        .from("departures")
        .select("id, departs_at, capacity, status, vessels(name), tours(name), reservations(people_count, status)")
        .gte("departs_at", todayStart)
        .lt("departs_at", todayEnd)
        .order("departs_at"),
      supabase.from("reservations").select("total_cents, status, created_at").gte("created_at", d30.toISOString()),
      supabase
        .from("departures")
        .select("capacity, reservations(people_count, status)")
        .gte("departs_at", d30.toISOString()),
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase
        .from("reservations")
        .select("id, people_count, total_cents, status, created_at, clients(name), departures(departs_at, vessels(name))")
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("reservations")
        .select("total_cents, status, created_at")
        .gte("created_at", prevMonthStart.toISOString())
        .lt("created_at", monthStart.toISOString()),
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
      supabase
        .from("departures")
        .select("id, departs_at, capacity, vessels(name), tours(name), reservations(people_count, status)")
        .gte("departs_at", now.toISOString())
        .lt("departs_at", next7End.toISOString())
        .eq("status", "agendada")
        .order("departs_at"),
    ]);

  const todayDeps = (todayRes.data ?? []) as any[];
  const booked = (r: any) =>
    (r.reservations ?? []).filter((x: any) => x.status === "confirmada").reduce((s: number, x: any) => s + x.people_count, 0);

  const todayHours = new Set<number>();
  for (let h = 8; h <= 19; h++) todayHours.add(h);
  todayDeps.forEach((r) => {
    const h = new Date(r.departs_at).getHours();
    if (h <= 19) todayHours.add(h);
  });
  const todayHourList = Array.from(todayHours).sort((a, b) => a - b);

  const reservasHoje = todayDeps.reduce(
    (s, r) => s + (r.reservations ?? []).filter((x: any) => x.status === "confirmada").length,
    0
  );
  const passageirosHoje = todayDeps.reduce((s, r) => s + booked(r), 0);
  const ocupacaoHoje = todayDeps.length
    ? Math.round(todayDeps.reduce((s, r) => s + (r.capacity ? (booked(r) / r.capacity) * 100 : 0), 0) / todayDeps.length)
    : 0;

  const recent = (recentRes.data ?? []) as any[];
  const receitaMes = recent
    .filter((x) => x.status === "confirmada" && new Date(x.created_at) >= monthStart)
    .reduce((s, x) => s + x.total_cents, 0);
  const clientesAtivos = clientsRes.count ?? 0;
  const ultimasReservas = (lastResRes.data ?? []) as any[];

  const receitaMesAnterior = ((prevMonthRes.data ?? []) as any[])
    .filter((x) => x.status === "confirmada")
    .reduce((s, x) => s + x.total_cents, 0);
  const receitaTrendPct = receitaMesAnterior > 0 ? Math.round(((receitaMes - receitaMesAnterior) / receitaMesAnterior) * 100) : null;

  const deps30 = (depsRes.data ?? []) as any[];
  const occMedia30 = deps30.length
    ? Math.round(deps30.reduce((s, d) => s + (d.capacity ? (booked(d) / d.capacity) * 100 : 0), 0) / deps30.length)
    : 0;
  const ocupacaoTrendPts = occMedia30 > 0 ? ocupacaoHoje - occMedia30 : null;

  const hour = now.getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = (profile?.name ?? "").split(" ")[0] || "operador";

  // saidas dos proximos 7 dias com baixa ocupacao (alerta)
  const lowOccupancy = ((next7Res.data ?? []) as any[])
    .map((d) => {
      const b = booked(d);
      return { ...d, booked: b, pct: d.capacity ? Math.round((b / d.capacity) * 100) : 0 };
    })
    .filter((d) => d.pct < 50)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  // ---- desempenho do periodo selecionado ----
  const periodRes = (periodResRes.data ?? []) as any[];
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
  for (let d = new Date(periodStart); d <= new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() + 1)) {
    dayKeys.push(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    dayDates.push(new Date(d));
  }
  const keyOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const revByDay: Record<string, number> = Object.fromEntries(dayKeys.map((k) => [k, 0]));
  periodConfirmadas.forEach((r) => {
    const k = keyOf(r.created_at);
    if (k in revByDay) revByDay[k] += r.total_cents;
  });
  const revSeries = dayKeys.map((k) => revByDay[k] / 100);

  const periodDeps = (periodDepsRes.data ?? []) as any[];
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

  const dayLabel = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const periodoLabel = PERIODS.find((o) => o.key === p)?.label ?? "período";

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-heading">
            {greet}, {firstName}!
          </h1>
          <p className="mt-0.5 text-sm text-muted">Aqui está o resumo do seu negócio hoje.</p>
        </div>
        <Link
          href="/reservas"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          <Plus size={16} /> Nova Reserva
        </Link>
      </div>

      {/* Cards principais */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Metric icon={<CalendarCheck size={20} />} tone="bg-brand" label="Reservas hoje" value={String(reservasHoje)} />
        <Metric
          icon={<DollarSign size={20} />}
          tone="bg-ok"
          label="Receita do mês"
          value={brl(receitaMes)}
          trend={receitaTrendPct != null ? { pct: receitaTrendPct, suffix: "vs mês passado" } : null}
        />
        <Metric
          icon={<Gauge size={20} />}
          tone="bg-amberflow"
          label="Ocupação hoje"
          value={`${ocupacaoHoje}%`}
          trend={ocupacaoTrendPts != null ? { pct: ocupacaoTrendPts, suffix: "vs média 30d", isPoints: true } : null}
        />
        <Metric icon={<Users size={20} />} tone="bg-purpleflow" label="Clientes" value={String(clientesAtivos)} />
        <Metric icon={<Ship size={20} />} tone="bg-navy" label="Passageiros hoje" value={String(passageirosHoje)} />
      </div>

      {/* Desempenho do periodo */}
      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-heading">Desempenho do período</h2>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((opt) => (
            <Link
              key={opt.key}
              href={`/dashboard?p=${opt.key}`}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                p === opt.key ? "border-brand bg-brand text-white" : "border-line bg-surface text-body hover:bg-surfaceHover"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label={`Receita ${periodoLabel.toLowerCase()}`} value={brl(receitaPeriodo)} sub={`${periodConfirmadas.length} confirmadas`} />
        <MiniStat label="Ticket médio" value={brl(ticketMedio)} />
        <MiniStat
          label="Cancelamento / pendência"
          value={`${taxaCancelamento}%`}
          tone="text-danger"
          sub={`${taxaPendencia}% pendente`}
        />
        <MiniStat label="Clientes novos" value={String(novosClientes)} sub={`${clientesRecorrentes} recorrentes`} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-heading">Receita {periodoLabel.toLowerCase()}</h3>
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
            <h3 className="font-display text-base font-semibold text-heading">Ocupação {periodoLabel.toLowerCase()}</h3>
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

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
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

      {/* Operacao de hoje */}
      <h2 className="mb-3 font-display text-lg font-semibold text-heading">Operação de hoje</h2>

      {lowOccupancy.length > 0 && (
        <Card className="mb-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amberflow" />
            <h3 className="font-display text-base font-semibold text-heading">Próximos 7 dias com baixa ocupação</h3>
          </div>
          <div className="space-y-2">
            {lowOccupancy.map((d) => (
              <Link
                key={d.id}
                href={`/saidas/${d.id}`}
                className="flex items-center gap-4 rounded-lg border border-line px-3 py-2.5 transition hover:bg-surfaceHover"
              >
                <span className="w-16 shrink-0 text-sm font-medium text-heading">{fmtDate(d.departs_at)}</span>
                <span className="w-12 shrink-0 text-sm text-muted">{fmtTime(d.departs_at)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-heading">{d.vessels?.name}</p>
                  <p className="truncate text-xs text-muted">{d.tours?.name}</p>
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-muted">
                  {d.booked}/{d.capacity}
                </span>
                <Badge tone="amber">{d.pct}%</Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Agenda de hoje */}
      <Card className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-heading">Agenda de hoje</h3>
          <Link href="/saidas" className="text-sm text-brand">
            Ver todas
          </Link>
        </div>
        <div className="space-y-1">
          {todayHourList.map((h) => {
            const here = todayDeps.filter((r) => new Date(r.departs_at).getHours() === h);
            return (
              <div
                key={h}
                className="group flex items-center gap-3 rounded-lg border-b border-line px-2 py-2 transition hover:bg-surfaceHover last:border-0"
              >
                <span className="w-12 shrink-0 text-sm font-medium text-heading">{String(h).padStart(2, "0")}:00</span>
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  {here.length === 0 ? (
                    <Link
                      href="/saidas"
                      className="inline-flex items-center gap-1.5 text-xs text-muted transition group-hover:text-brand"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-ok/50 transition group-hover:bg-ok" />
                      livre
                      <Plus size={12} className="opacity-0 transition group-hover:opacity-100" />
                    </Link>
                  ) : (
                    here.map((r) => {
                      const b = booked(r);
                      const full = b >= r.capacity;
                      return (
                        <Link
                          key={r.id}
                          href={`/saidas/${r.id}`}
                          className={`rounded-md px-2 py-1 text-xs font-medium transition hover:opacity-80 ${
                            full ? "bg-red-50 text-danger" : "bg-blue-50 text-brand-dark"
                          }`}
                        >
                          {r.vessels?.name} · {b}/{r.capacity}
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
          {todayDeps.length === 0 && (
            <p className="pt-3 text-center text-sm text-muted">Nenhuma saída agendada para hoje.</p>
          )}
        </div>
      </Card>

      {/* Reservas recentes */}
      <Card className="p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="font-display text-base font-semibold text-heading">Reservas recentes</h2>
          <Link href="/reservas" className="text-sm text-brand">
            Ver todas
          </Link>
        </div>
        {ultimasReservas.length === 0 ? (
          <p className="px-5 pb-6 text-center text-sm text-muted">Nenhuma reserva ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs text-muted">
                <th className="px-5 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Saída</th>
                <th className="px-4 py-2.5 text-center">Passageiros</th>
                <th className="px-4 py-2.5 text-right">Valor</th>
                <th className="px-5 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {ultimasReservas.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium text-heading">{r.clients?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-body">
                    {r.departures?.vessels?.name ?? "-"}
                    {r.departures ? ` · ${fmtTime(r.departures.departs_at)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-center">{r.people_count}</td>
                  <td className="px-4 py-3 text-right">{brl(r.total_cents)}</td>
                  <td className="px-5 py-3 text-right">
                    <Badge tone={r.status === "confirmada" ? "green" : "slate"}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Metric({
  icon,
  tone,
  label,
  value,
  trend,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: string;
  trend?: { pct: number; suffix: string; isPoints?: boolean } | null;
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs leading-tight text-muted">{label}</p>
        <p className="font-display text-xl font-semibold text-heading">{value}</p>
        {trend && <TrendBadge {...trend} />}
      </div>
    </Card>
  );
}

function TrendBadge({ pct, suffix, isPoints }: { pct: number; suffix: string; isPoints?: boolean }) {
  const up = pct > 0;
  const flat = pct === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const color = flat ? "text-muted" : up ? "text-ok" : "text-danger";
  const amount = isPoints ? `${up ? "+" : ""}${pct}pp` : `${up ? "+" : ""}${pct}%`;
  return (
    <p className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium ${color}`}>
      <Icon size={12} /> {amount} <span className="font-normal text-muted">{suffix}</span>
    </p>
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
