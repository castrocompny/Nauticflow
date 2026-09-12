import { createClient } from "@/lib/supabase/server";
import { saoPauloDayKey, saoPauloHour, saoPauloStartOfDay } from "@/lib/format";
import { getProfile } from "@/lib/profile";
import { TourCalendar, type CalendarDay, type CalendarDeparture } from "./tour-calendar";
import { WindConditionsCard } from "./wind-conditions-card";

const CALENDAR_DAYS = 7;

// Dashboard = operacao de hoje e dos proximos dias, ponto. Analitico/
// financeiro/rankings/historico vivem em /relatorios, /financeiro e
// /reservas -- ver DOCUMENTACAO.md. Por isso a UNICA consulta que este
// componente precisa e a das saidas da janela de 7 dias (hoje + proximos 6);
// WindConditionsCard busca sua propria condicao de vento, independente.
export default async function Dashboard() {
  const supabase = createClient();
  const profile = await getProfile();

  const now = new Date();
  const rangeStart = saoPauloStartOfDay(now);
  const rangeEnd = new Date(rangeStart.getTime() + CALENDAR_DAYS * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("departures")
    .select("id, departs_at, capacity, status, vessels(name), tours(name), reservations(people_count, status)")
    .gte("departs_at", rangeStart.toISOString())
    .lt("departs_at", rangeEnd.toISOString())
    .order("departs_at");

  const deps = (data ?? []) as unknown as CalendarDeparture[];

  // agrupa por dia civil em Brasilia (nunca cancelada -- nao representa
  // operacao); a query ja veio ordenada por departs_at, entao cada balde
  // preserva a ordem cronologica sem precisar reordenar.
  const byDay = new Map<string, CalendarDeparture[]>();
  deps.forEach((d) => {
    if (d.status === "cancelada") return;
    const key = saoPauloDayKey(d.departs_at);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(d);
  });

  const days: CalendarDay[] = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const dayStart = new Date(rangeStart.getTime() + i * 24 * 60 * 60 * 1000);
    const isToday = i === 0;
    let departures = byDay.get(saoPauloDayKey(dayStart.toISOString())) ?? [];
    if (isToday) {
      // hoje: saida ja encerrada/passada nao ocupa espaco no calendario
      // operacional -- mas uma saida em andamento continua visivel mesmo
      // com o horario nominal ja no passado.
      departures = departures.filter((d) => new Date(d.departs_at) >= now || d.status === "em_andamento");
    }
    return { dayStart, isToday, departures };
  });

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

      <TourCalendar days={days} />

      {/* Condições do vento -- Etapa 1, só informativo (ver DOCUMENTACAO.md).
          Componente 100% best-effort: nunca lança, nunca derruba o resto do
          Dashboard se a empresa não tiver localização configurada ou o
          provider de clima estiver fora do ar. */}
      <WindConditionsCard />
    </>
  );
}
