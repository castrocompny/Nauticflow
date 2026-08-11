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
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { brl, fmtTime, startEndOfToday } from "@/lib/format";
import { getProfile } from "@/lib/profile";
import { Card, Badge } from "@/components/ui";
import { BarsChart } from "./bars-chart";

export default async function Dashboard() {
  const supabase = createClient();
  const profile = await getProfile();

  const now = new Date();
  const { start: todayStart, end: todayEnd } = startEndOfToday();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const d30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);

  const [todayRes, recentRes, depsRes, clientsRes, lastResRes, prevMonthRes] = await Promise.all([
    supabase
      .from("departures")
      .select("id, departs_at, capacity, status, vessels(name), tours(name), reservations(people_count, status)")
      .gte("departs_at", todayStart)
      .lt("departs_at", todayEnd)
      .order("departs_at"),
    supabase.from("reservations").select("total_cents, status, created_at").gte("created_at", d30.toISOString()),
    supabase
      .from("departures")
      .select("departs_at, capacity, reservations(people_count, status)")
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
  ]);

  const todayDeps = (todayRes.data ?? []) as any[];
  const booked = (r: any) =>
    (r.reservations ?? []).filter((x: any) => x.status === "confirmada").reduce((s: number, x: any) => s + x.people_count, 0);

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

  // series de 30 dias
  const dayKeys: string[] = [];
  const dayDates: Date[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dayKeys.push(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    dayDates.push(d);
  }
  const keyOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const revByDay: Record<string, number> = Object.fromEntries(dayKeys.map((k) => [k, 0]));
  recent.forEach((x) => {
    if (x.status === "confirmada") {
      const k = keyOf(x.created_at);
      if (k in revByDay) revByDay[k] += x.total_cents;
    }
  });
  const revSeries = dayKeys.map((k) => revByDay[k] / 100);

  const occAgg: Record<string, { sum: number; n: number }> = Object.fromEntries(
    dayKeys.map((k) => [k, { sum: 0, n: 0 }])
  );
  ((depsRes.data ?? []) as any[]).forEach((d) => {
    const k = keyOf(d.departs_at);
    if (k in occAgg) {
      const bk = (d.reservations ?? [])
        .filter((x: any) => x.status === "confirmada")
        .reduce((s: number, x: any) => s + x.people_count, 0);
      occAgg[k].sum += d.capacity ? (bk / d.capacity) * 100 : 0;
      occAgg[k].n += 1;
    }
  });
  const occSeries = dayKeys.map((k) => (occAgg[k].n ? Math.round(occAgg[k].sum / occAgg[k].n) : 0));
  const occMedia30 = occSeries.length ? Math.round(occSeries.reduce((s, v) => s + v, 0) / occSeries.length) : 0;
  const ocupacaoTrendPts = occMedia30 > 0 ? ocupacaoHoje - occMedia30 : null;

  const dayLabel = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  const hour = now.getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = (profile?.name ?? "").split(" ")[0] || "operador";

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

      {/* Proximas saidas */}
      <Card className="mb-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-heading">Próximas saídas</h2>
          <Link href="/saidas" className="text-sm text-brand">
            Ver todas
          </Link>
        </div>
        {todayDeps.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">Nenhuma saída para hoje.</div>
        ) : (
          <div className="space-y-2">
            {todayDeps.slice(0, 6).map((r) => {
              const b = booked(r);
              const full = b >= r.capacity;
              const tone = full ? "red" : b > 0 ? "slate" : "green";
              const label = full ? "Lotado" : b > 0 ? "Confirmado" : "Disponível";
              return (
                <div key={r.id} className="flex items-center gap-4 rounded-lg border border-line px-3 py-2.5">
                  <span className="w-12 text-sm font-medium">{fmtTime(r.departs_at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-heading">{r.vessels?.name}</p>
                    <p className="truncate text-xs text-muted">{r.tours?.name}</p>
                  </div>
                  <span className="w-16 text-right text-xs text-muted">
                    {b}/{r.capacity}
                  </span>
                  <Badge tone={tone as any}>{label}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Agenda de hoje */}
      <Card className="mb-5">
        <h2 className="mb-4 font-display text-base font-semibold text-heading">Agenda de hoje</h2>
        <div className="space-y-1">
          {Array.from({ length: 10 }, (_, i) => 8 + i).map((h) => {
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

      {/* Graficos */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-heading">Receita dos últimos 30 dias</h2>
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
            <h2 className="font-display text-base font-semibold text-heading">Taxa de ocupação dos últimos 30 dias</h2>
            <Gauge size={18} className="text-amberflow" />
          </div>
          <p className="mb-3 text-sm text-muted">Média: {occMedia30}%</p>
          <BarsChart
            points={occSeries.map((v, i) => ({ label: dayLabel(dayDates[i]), value: v }))}
            color="#F59E0B"
            formatType="percent"
          />
        </Card>
      </div>

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

