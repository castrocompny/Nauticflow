import Link from "next/link";
import { Ship, CalendarCheck, Users, Gauge } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fmtTime, saoPauloHour, startEndOfToday } from "@/lib/format";
import { getProfile } from "@/lib/profile";
import { Card, Badge } from "@/components/ui";
import { statusTone } from "../saidas/departure-row";
import { WindConditionsCard } from "./wind-conditions-card";

// Dashboard = operacao de hoje, ponto. Analitico/financeiro/rankings/historico
// vivem em /relatorios, /financeiro e /reservas -- ver DOCUMENTACAO.md. Por
// isso a UNICA consulta que este componente precisa e a das saidas de hoje:
// alimenta as 4 metricas e a lista de proximas saidas, nada mais.
export default async function Dashboard() {
  const supabase = createClient();
  const profile = await getProfile();

  const now = new Date();
  const { start: todayStart, end: todayEnd } = startEndOfToday();

  const { data } = await supabase
    .from("departures")
    .select("id, departs_at, capacity, status, vessels(name), tours(name), reservations(people_count, status)")
    .gte("departs_at", todayStart)
    .lt("departs_at", todayEnd)
    .order("departs_at");

  const todayDeps = (data ?? []) as any[];
  const booked = (r: any) =>
    (r.reservations ?? []).filter((x: any) => x.status === "confirmada").reduce((s: number, x: any) => s + x.people_count, 0);

  // saidas canceladas nao contam como operacao ativa -- mas continuam
  // fazendo parte de todayDeps (usado pela lista de proximas saidas, que as
  // exclui separadamente) e nao afetam reservas/passageiros/ocupacao abaixo,
  // que ja tinham essa mesma base de calculo antes desta simplificacao.
  const saidasHoje = todayDeps.filter((d) => d.status !== "cancelada").length;
  const reservasHoje = todayDeps.reduce(
    (s, r) => s + (r.reservations ?? []).filter((x: any) => x.status === "confirmada").length,
    0
  );
  const passageirosHoje = todayDeps.reduce((s, r) => s + booked(r), 0);
  const ocupacaoHoje = todayDeps.length
    ? Math.round(todayDeps.reduce((s, r) => s + (r.capacity ? (booked(r) / r.capacity) * 100 : 0), 0) / todayDeps.length)
    : 0;

  // proximas saidas: nunca cancelada, e ou ainda nao passou ou esta em
  // andamento agora -- a query ja veio ordenada por departs_at, entao o
  // filtro preserva a ordem cronologica sem precisar reordenar.
  const proximasSaidas = todayDeps.filter(
    (d) => d.status !== "cancelada" && (new Date(d.departs_at) >= now || d.status === "em_andamento")
  );

  const hour = saoPauloHour(now.toISOString());
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = (profile?.name ?? "").split(" ")[0] || "operador";

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-heading">
          {greet}, {firstName}!
        </h1>
        <p className="mt-0.5 text-sm text-muted">Aqui está sua operação de hoje.</p>
      </div>

      {/* Cards principais -- exatamente 4 metricas operacionais */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric icon={<Ship size={20} />} tone="bg-navy" label="Saídas hoje" value={String(saidasHoje)} />
        <Metric icon={<CalendarCheck size={20} />} tone="bg-brand" label="Reservas hoje" value={String(reservasHoje)} />
        <Metric icon={<Users size={20} />} tone="bg-purpleflow" label="Passageiros hoje" value={String(passageirosHoje)} />
        <Metric icon={<Gauge size={20} />} tone="bg-amberflow" label="Ocupação hoje" value={`${ocupacaoHoje}%`} />
      </div>

      {/* Condições do vento -- Etapa 1, só informativo (ver DOCUMENTACAO.md).
          Componente 100% best-effort: nunca lança, nunca derruba o resto do
          Dashboard se a empresa não tiver localização configurada ou o
          provider de clima estiver fora do ar. */}
      <WindConditionsCard />

      {/* Proximas saidas */}
      <Card className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-heading">Próximas saídas</h2>
          <Link href="/saidas" className="text-sm text-brand">
            Ver todas as saídas
          </Link>
        </div>
        {proximasSaidas.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">Nenhuma saída restante para hoje.</p>
        ) : (
          <div className="space-y-1">
            {proximasSaidas.map((d) => (
              <Link
                key={d.id}
                href={`/saidas/${d.id}`}
                className="flex items-center gap-3 rounded-lg border-b border-line px-2 py-2.5 text-sm transition hover:bg-surfaceHover last:border-0"
              >
                <span className="w-12 shrink-0 font-medium text-heading">{fmtTime(d.departs_at)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">
                    {d.vessels?.name} · {d.tours?.name}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {booked(d)}/{d.capacity}
                </span>
                <Badge tone={statusTone[d.status] ?? "slate"}>
                  <span className="capitalize">{d.status.replace("_", " ")}</span>
                </Badge>
              </Link>
            ))}
          </div>
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
    <Card className="flex items-center gap-2 p-3 sm:gap-3 sm:p-5">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white sm:h-11 sm:w-11 ${tone}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs leading-tight text-muted">{label}</p>
        <p className="truncate font-display text-lg font-semibold text-heading sm:text-xl">{value}</p>
      </div>
    </Card>
  );
}
