import Link from "next/link";
import {
  CalendarCheck,
  DollarSign,
  Gauge,
  Users,
  Ship,
  Plus,
  TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { brl, fmtTime, startEndOfToday } from "@/lib/format";
import { getProfile } from "@/lib/profile";
import { Card, Badge } from "@/components/ui";

export default async function Dashboard() {
  const supabase = createClient();
  const profile = await getProfile();

  const now = new Date();
  const { start: todayStart, end: todayEnd } = startEndOfToday();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const d30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);

  const [todayRes, recentRes, depsRes, clientsRes, lastResRes] = await Promise.all([
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

  // series de 30 dias
  const dayKeys: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dayKeys.push(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
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

  const hour = now.getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = (profile?.name ?? "").split(" ")[0] || "operador";

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">
            {greet}, {firstName}!
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">Aqui está o resumo do seu negócio hoje.</p>
        </div>
        <Link
          href="/reservas"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          <Plus size={16} /> Nova Reserva
        </Link>
      </div>

      {/* Cards principais */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric icon={<CalendarCheck size={20} />} tone="bg-brand" label="Reservas de hoje" value={String(reservasHoje)} />
        <Metric icon={<DollarSign size={20} />} tone="bg-ok" label="Receita do mês" value={brl(receitaMes)} />
        <Metric icon={<Gauge size={20} />} tone="bg-amberflow" label="Taxa de ocupação" value={`${ocupacaoHoje}%`} />
        <Metric icon={<Users size={20} />} tone="bg-purpleflow" label="Clientes ativos" value={String(clientesAtivos)} />
        <Metric icon={<Ship size={20} />} tone="bg-navy" label="Passageiros de hoje" value={String(passageirosHoje)} />
      </div>

      {/* Proximas saidas */}
      <Card className="mb-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-navy">Próximas saídas</h2>
          <Link href="/saidas" className="text-sm text-brand">
            Ver todas
          </Link>
        </div>
        {todayDeps.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Nenhuma saída para hoje.</div>
        ) : (
          <div className="space-y-2">
            {todayDeps.slice(0, 6).map((r) => {
              const b = booked(r);
              const full = b >= r.capacity;
              const tone = full ? "red" : b > 0 ? "slate" : "green";
              const label = full ? "Lotado" : b > 0 ? "Confirmado" : "Disponível";
              return (
                <div key={r.id} className="flex items-center gap-4 rounded-lg border border-slate-100 px-3 py-2.5">
                  <span className="w-12 text-sm font-medium">{fmtTime(r.departs_at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-navy">{r.vessels?.name}</p>
                    <p className="truncate text-xs text-slate-500">{r.tours?.name}</p>
                  </div>
                  <span className="w-16 text-right text-xs text-slate-500">
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
        <h2 className="mb-4 font-display text-base font-semibold text-navy">Agenda de hoje</h2>
        <div className="space-y-1">
          {Array.from({ length: 10 }, (_, i) => 8 + i).map((h) => {
            const here = todayDeps.filter((r) => new Date(r.departs_at).getHours() === h);
            return (
              <div key={h} className="flex items-start gap-3 border-b border-slate-50 py-1.5 last:border-0">
                <span className="w-12 shrink-0 text-xs text-slate-400">{String(h).padStart(2, "0")}:00</span>
                <div className="flex flex-1 flex-wrap gap-2">
                  {here.length === 0 ? (
                    <span className="text-xs text-slate-300">livre</span>
                  ) : (
                    here.map((r) => (
                      <span key={r.id} className="rounded-md bg-blue-50 px-2 py-1 text-xs text-brand-dark">
                        {r.vessels?.name} · {booked(r)}/{r.capacity}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
          {todayDeps.length === 0 && (
            <p className="pt-3 text-center text-sm text-slate-400">Nenhuma saída agendada para hoje.</p>
          )}
        </div>
      </Card>

      {/* Graficos */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-navy">Receita dos últimos 30 dias</h2>
            <TrendingUp size={18} className="text-ok" />
          </div>
          <p className="mb-3 text-sm text-slate-500">Total: {brl(revSeries.reduce((s, v) => s + v, 0) * 100)}</p>
          <Bars series={revSeries} color="#2563EB" />
        </Card>
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-navy">Taxa de ocupação dos últimos 30 dias</h2>
            <Gauge size={18} className="text-amberflow" />
          </div>
          <p className="mb-3 text-sm text-slate-500">
            Média: {occSeries.length ? Math.round(occSeries.reduce((s, v) => s + v, 0) / occSeries.length) : 0}%
          </p>
          <Bars series={occSeries} color="#F59E0B" />
        </Card>
      </div>

      {/* Reservas recentes */}
      <Card className="p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="font-display text-base font-semibold text-navy">Reservas recentes</h2>
          <Link href="/reservas" className="text-sm text-brand">
            Ver todas
          </Link>
        </div>
        {ultimasReservas.length === 0 ? (
          <p className="px-5 pb-6 text-center text-sm text-slate-400">Nenhuma reserva ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 text-left text-xs text-slate-500">
                <th className="px-5 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Saída</th>
                <th className="px-4 py-2.5 text-center">Passageiros</th>
                <th className="px-4 py-2.5 text-right">Valor</th>
                <th className="px-5 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {ultimasReservas.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 font-medium text-navy">{r.clients?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600">
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
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: string;
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-xs text-slate-500">{label}</p>
        <p className="font-display text-xl font-semibold text-navy">{value}</p>
      </div>
    </Card>
  );
}

function Bars({ series, color }: { series: number[]; color: string }) {
  const max = Math.max(...series, 1);
  const hasData = series.some((v) => v > 0);
  if (!hasData) {
    return <div className="py-8 text-center text-sm text-slate-400">Sem dados ainda.</div>;
  }
  return (
    <svg viewBox={`0 0 ${series.length * 4} 40`} preserveAspectRatio="none" className="h-24 w-full">
      {series.map((v, i) => {
        const h = max ? (v / max) * 36 : 0;
        return <rect key={i} x={i * 4 + 0.6} y={40 - h} width={2.8} height={h} rx={1} fill={color} />;
      })}
    </svg>
  );
}
