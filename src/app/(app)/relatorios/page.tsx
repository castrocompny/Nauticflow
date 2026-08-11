import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { brl } from "@/lib/format";

type Res = { total_cents: number; status: string };
type Dep = { capacity: number; vessels: { name: string } | null; reservations: { people_count: number; status: string }[] };

const periods = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "ano", label: "Ano atual" },
];

function startFor(p: string): Date {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === "hoje") return base;
  if (p === "7d") {
    const d = new Date(base);
    d.setDate(d.getDate() - 6);
    return d;
  }
  if (p === "mes") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (p === "ano") return new Date(now.getFullYear(), 0, 1);
  const d = new Date(base);
  d.setDate(d.getDate() - 29);
  return d;
}

export default async function RelatoriosPage({ searchParams }: { searchParams: { p?: string } }) {
  const p = ["hoje", "7d", "30d", "mes", "ano"].includes(searchParams.p ?? "") ? (searchParams.p as string) : "30d";
  const start = startFor(p).toISOString();

  const supabase = createClient();
  const [resR, depR, clientsR] = await Promise.all([
    supabase.from("reservations").select("total_cents, status, created_at").gte("created_at", start),
    supabase
      .from("departures")
      .select("capacity, vessels(name), reservations(people_count, status)")
      .gte("departs_at", start),
    supabase.from("clients").select("id", { count: "exact", head: true }),
  ]);

  const reservas = (resR.data ?? []) as unknown as Res[];
  const deps = (depR.data ?? []) as unknown as Dep[];
  const confirmadas = reservas.filter((r) => r.status === "confirmada");
  const canceladas = reservas.filter((r) => r.status === "cancelada");
  const receita = confirmadas.reduce((s, r) => s + r.total_cents, 0);

  const ocupMedia = deps.length
    ? Math.round(
        deps.reduce((s, d) => {
          const b = d.reservations.filter((x) => x.status === "confirmada").reduce((a, x) => a + x.people_count, 0);
          return s + (d.capacity ? (b / d.capacity) * 100 : 0);
        }, 0) / deps.length
      )
    : 0;

  const porEmbarcacao: Record<string, number> = {};
  deps.forEach((d) => {
    const n = d.vessels?.name ?? "Sem embarcação";
    porEmbarcacao[n] = (porEmbarcacao[n] ?? 0) + 1;
  });
  const topVessels = Object.entries(porEmbarcacao).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const semDados = reservas.length === 0 && deps.length === 0;

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Indicadores do período selecionado." />

      <div className="mb-4 flex flex-wrap gap-2">
        {periods.map((pp) => (
          <Link
            key={pp.key}
            href={`/relatorios?p=${pp.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              p === pp.key ? "border-brand bg-brand text-white" : "border-line bg-surface text-body hover:bg-surfaceHover"
            }`}
          >
            {pp.label}
          </Link>
        ))}
      </div>

      {semDados ? (
        <EmptyState title="Sem dados no período" hint="Quando houver reservas e saídas neste intervalo, os números aparecem aqui." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Reservas no período" value={String(reservas.length)} />
            <Stat label="Receita no período" value={brl(receita)} />
            <Stat label="Ocupação média" value={`${ocupMedia}%`} />
            <Stat label="Saídas realizadas" value={String(deps.length)} />
            <Stat label="Clientes cadastrados" value={String(clientsR.count ?? 0)} />
            <Stat label="Reservas confirmadas" value={String(confirmadas.length)} />
            <Stat label="Reservas canceladas" value={String(canceladas.length)} />
          </div>

          <Card>
            <h2 className="mb-3 font-display text-base font-semibold text-heading">Embarcações mais usadas</h2>
            {topVessels.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">Sem saídas no período.</p>
            ) : (
              <div className="space-y-2">
                {topVessels.map(([name, count]) => {
                  const max = topVessels[0][1] || 1;
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-40 truncate text-sm text-heading">{name}</span>
                      <div className="h-2 flex-1 rounded-full bg-surfaceHover">
                        <div className="h-2 rounded-full bg-brand" style={{ width: `${(count / max) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs text-muted">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-heading">{value}</p>
    </Card>
  );
}
