import { createClient } from "@/lib/supabase/server";
import { saoPauloDayKey, saoPauloHour, saoPauloStartOfDay } from "@/lib/format";
import { getProfile } from "@/lib/profile";
import { TourCalendar, type CalendarDayData, type CalendarDeparture } from "./tour-calendar";
import { WindConditionsCard } from "./wind-conditions-card";
import { loadWeatherState } from "./weather-state";
import { windSummaryForDeparture } from "./wind-forecast-match";

const CALENDAR_DAYS = 7;
const WEEKDAY_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const WEEKDAY_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTH_FULL = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// Dashboard = operacao de hoje e dos proximos dias, ponto. Analitico/
// financeiro/rankings/historico vivem em /relatorios, /financeiro e
// /reservas -- ver DOCUMENTACAO.md. Por isso este componente faz só DUAS
// leituras de dados, cada uma UMA vez por renderização: a janela de 7 dias
// de departures, e o estado de clima compartilhado (weather-state.ts) --
// usado tanto pelo WindConditionsCard quanto pra associar vento a cada
// saída da Agenda (Etapa 2), nunca duas chamadas ao provider de clima.
export default async function Dashboard() {
  const supabase = createClient();
  const profile = await getProfile();

  const now = new Date();
  const rangeStart = saoPauloStartOfDay(now);
  const rangeEnd = new Date(rangeStart.getTime() + CALENDAR_DAYS * 24 * 60 * 60 * 1000);

  const [depsRes, weatherState] = await Promise.all([
    supabase
      .from("departures")
      .select("id, departs_at, capacity, status, vessels(name), tours(name), reservations(people_count, status)")
      .gte("departs_at", rangeStart.toISOString())
      .lt("departs_at", rangeEnd.toISOString())
      .order("departs_at"),
    loadWeatherState(),
  ]);

  const deps = (depsRes.data ?? []) as unknown as CalendarDeparture[];
  // janela completa de previsão (até ~7 dias) pronta pra associar por
  // horário -- null quando não há previsão disponível nesta renderização
  // (sem localização, provider fora do ar etc.); windSummaryForDeparture
  // trata isso e nunca lança, nunca inventa valor.
  const windHourly = weatherState?.kind === "ok" ? weatherState.conditions.hourly : null;

  // agrupa por dia civil em Brasilia (nunca cancelada -- nao representa
  // operacao); a query ja veio ordenada por departs_at, entao cada balde
  // preserva a ordem cronologica sem precisar reordenar.
  const byDay = new Map<string, CalendarDeparture[]>();
  deps.forEach((d) => {
    if (d.status === "cancelada") return;
    const key = saoPauloDayKey(d.departs_at);
    const withWind: CalendarDeparture = { ...d, wind: windSummaryForDeparture(windHourly, d.departs_at) };
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(withWind);
  });

  // monta os dados dos 7 dias ja prontos pra exibir -- so primitivos
  // (string/number/boolean), nenhum Date cruzando pro componente client.
  // dayStart.getUTC*() e seguro aqui: saoPauloStartOfDay sempre resulta num
  // instante as 03:00 UTC (meia-noite em Brasilia + offset fixo de -03:00,
  // sem horario de verao desde 2019), que nunca cruza a virada de dia UTC --
  // entao os componentes UTC ja refletem o dia civil correto em Brasilia.
  const days: CalendarDayData[] = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const dayStart = new Date(rangeStart.getTime() + i * 24 * 60 * 60 * 1000);
    const isToday = i === 0;
    let departures = byDay.get(saoPauloDayKey(dayStart.toISOString())) ?? [];
    if (isToday) {
      // hoje: saida ja encerrada/passada nao ocupa espaco na agenda -- mas
      // uma saida em andamento continua visivel mesmo com o horario nominal
      // ja no passado.
      departures = departures.filter((d) => new Date(d.departs_at) >= now || d.status === "em_andamento");
    }
    const weekday = dayStart.getUTCDay();
    return {
      key: saoPauloDayKey(dayStart.toISOString()),
      isToday,
      dayNumber: dayStart.getUTCDate(),
      weekdayLabel: isToday ? "HOJE" : WEEKDAY_LABELS[weekday],
      weekdayFull: isToday ? "Hoje" : WEEKDAY_FULL[weekday],
      monthFull: MONTH_FULL[dayStart.getUTCMonth()],
      departures,
    };
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

      {/* Condições do vento -- Etapa 1, só informativo (ver DOCUMENTACAO.md).
          Componente 100% best-effort: nunca lança, nunca derruba o resto do
          Dashboard se a empresa não tiver localização configurada ou o
          provider de clima estiver fora do ar. Sempre ACIMA da agenda. */}
      <WindConditionsCard state={weatherState} />

      <TourCalendar days={days} />
    </>
  );
}
