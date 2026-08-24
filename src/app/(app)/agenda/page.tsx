import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Badge, EmptyState } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { fmtTime, saoPauloHour, saoPauloStartOfDay } from "@/lib/format";

type Dep = {
  id: string;
  departs_at: string;
  capacity: number;
  vessels: { name: string } | null;
  tours: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

const filters = [
  { key: "hoje", label: "Hoje" },
  { key: "amanha", label: "Amanhã" },
  { key: "semana", label: "Semana" },
];

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

function rangeFor(f: string) {
  const base = saoPauloStartOfDay(new Date());
  if (f === "amanha") {
    const s = addDays(base, 1);
    const e = addDays(s, 1);
    return { start: s, end: e, days: 1 };
  }
  if (f === "semana") {
    const e = addDays(base, 7);
    return { start: base, end: e, days: 7 };
  }
  const e = addDays(base, 1);
  return { start: base, end: e, days: 1 };
}

export default async function AgendaPage(props: { searchParams: Promise<{ f?: string }> }) {
  const searchParams = await props.searchParams;
  const f = searchParams.f === "amanha" || searchParams.f === "semana" ? searchParams.f : "hoje";
  const { start, end, days } = rangeFor(f);

  const supabase = createClient();
  const { data } = await supabase
    .from("departures")
    .select("id, departs_at, capacity, status, vessels(name), tours(name), reservations(people_count, status)")
    .gte("departs_at", start.toISOString())
    .lt("departs_at", end.toISOString())
    .order("departs_at");

  const deps = (data ?? []) as unknown as Dep[];
  const booked = (r: Dep) =>
    r.reservations.filter((x) => x.status === "confirmada").reduce((s, x) => s + x.people_count, 0);

  const dayList: Date[] = [];
  for (let i = 0; i < days; i++) {
    dayList.push(addDays(start, i));
  }
  const sameDay = (iso: string, d: Date) => saoPauloStartOfDay(new Date(iso)).getTime() === d.getTime();

  return (
    <>
      <RealtimeRefresh tables={["departures", "reservations"]} />
      <PageHeader
        title="Agenda"
        subtitle="Saídas programadas por horário."
        action={
          <Link
            href="/saidas"
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            + Nova saída
          </Link>
        }
      />

      <div className="mb-4 flex gap-2">
        {filters.map((ff) => (
          <Link
            key={ff.key}
            href={`/agenda?f=${ff.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              f === ff.key ? "border-brand bg-brand text-white" : "border-line bg-surface text-body hover:bg-surfaceHover"
            }`}
          >
            {ff.label}
          </Link>
        ))}
      </div>

      {deps.length === 0 ? (
        <EmptyState
          title="Nenhuma saída neste período"
          hint="Crie uma saída para ela aparecer aqui na agenda."
          action={
            <Link href="/saidas" className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white">
              + Nova saída
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {dayList.map((day) => {
            const ofDay = deps.filter((d) => sameDay(d.departs_at, day));
            const hours = new Set<number>();
            for (let h = 8; h <= 19; h++) hours.add(h);
            ofDay.forEach((d) => {
              const h = saoPauloHour(d.departs_at);
              if (h <= 19) hours.add(h);
            });
            const hourList = Array.from(hours).sort((a, b) => a - b);
            return (
              <Card key={day.toISOString()}>
                <h2 className="mb-3 font-display text-sm font-semibold capitalize text-heading">
                  {day.toLocaleDateString("pt-BR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                    timeZone: "America/Sao_Paulo",
                  })}
                </h2>
                <div className="space-y-1">
                  {hourList.map((h) => {
                    const here = ofDay.filter((r) => saoPauloHour(r.departs_at) === h);
                    return (
                      <div key={h} className="flex items-start gap-3 border-b border-line py-1.5 last:border-0">
                        <span className="w-12 shrink-0 text-xs text-muted">{String(h).padStart(2, "0")}:00</span>
                        <div className="flex flex-1 flex-wrap gap-2">
                          {here.length === 0 ? (
                            <span className="text-xs text-muted">livre</span>
                          ) : (
                            here.map((r) => {
                              const b = booked(r);
                              const full = b >= r.capacity;
                              return (
                                <Link
                                  key={r.id}
                                  href={`/saidas/${r.id}`}
                                  className={`rounded-md px-2.5 py-1 text-xs ${
                                    full ? "bg-red-50 text-danger" : "bg-blue-50 text-brand-dark"
                                  }`}
                                >
                                  {fmtTime(r.departs_at)} · {r.vessels?.name} · {b}/{r.capacity}
                                </Link>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {ofDay.length === 0 && <p className="pt-2 text-center text-xs text-muted">Sem saídas neste dia.</p>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
