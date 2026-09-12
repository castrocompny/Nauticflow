import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { ScrollShadowX } from "@/components/scroll-shadow-x";
import { fmtTime } from "@/lib/format";
import { statusTone } from "../saidas/departure-row";

const WEEKDAY_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MONTH_LABELS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export type CalendarDeparture = {
  id: string;
  departs_at: string;
  capacity: number;
  status: string;
  vessels: { name: string } | null;
  tours: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

export type CalendarDay = {
  // instante UTC real da meia-noite (00:00) em Brasilia deste dia -- ver
  // saoPauloStartOfDay em src/lib/format.ts. Os componentes UTC deste Date
  // (getUTCDate/getUTCMonth/getUTCDay) já refletem o dia civil correto em
  // Brasília, sem precisar de outra conversão de fuso aqui.
  dayStart: Date;
  isToday: boolean;
  departures: CalendarDeparture[];
};

// Passageiros confirmados de uma saida -- so reservas que o sistema ja trata
// como validas (status "confirmada"), mesma regra usada em /saidas e no
// Dashboard antes desta mudanca; nenhuma regra de reserva foi alterada aqui.
function booked(d: CalendarDeparture): number {
  return d.reservations.filter((r) => r.status === "confirmada").reduce((s, r) => s + r.people_count, 0);
}

export function TourCalendar({ days }: { days: CalendarDay[] }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 font-display text-lg font-semibold text-heading">Agenda de passeios</h2>
      <ScrollShadowX>
        <div className="flex gap-3 pb-2">
          {days.map((day) => (
            <DayColumn key={day.dayStart.toISOString()} day={day} />
          ))}
        </div>
      </ScrollShadowX>
    </div>
  );
}

function DayColumn({ day }: { day: CalendarDay }) {
  return (
    // min-w garante que a coluna nunca fica ilegivel numa tela estreita
    // (forcando scroll horizontal ali); flex-1 deixa as colunas se
    // espalharem e preencherem a largura em telas largas o bastante pras 7
    // caberem lado a lado sem precisar rolar -- o MESMO layout serve os dois
    // casos, sem breakpoint condicional entre grid/flex.
    <Card className="min-w-[200px] flex-1 shrink-0">
      <div className="mb-3">
        <p className={`text-xs font-semibold ${day.isToday ? "text-brand" : "text-muted"}`}>
          {day.isToday ? "HOJE" : WEEKDAY_LABELS[day.dayStart.getUTCDay()]}
        </p>
        <p className="font-display text-sm font-semibold text-heading">
          {String(day.dayStart.getUTCDate()).padStart(2, "0")} {MONTH_LABELS[day.dayStart.getUTCMonth()]}
        </p>
      </div>

      {day.departures.length === 0 ? (
        <p className="text-xs text-muted">Nenhum passeio</p>
      ) : (
        <div className="space-y-2">
          {day.departures.map((dep) => (
            <Link
              key={dep.id}
              href={`/saidas/${dep.id}`}
              className="block rounded-lg border border-line px-2.5 py-2 text-xs transition hover:border-brand hover:bg-surfaceHover"
            >
              <p className="font-semibold text-heading">{fmtTime(dep.departs_at)}</p>
              <p className="mt-0.5 truncate text-body">{dep.tours?.name ?? "Passeio"}</p>
              <p className="truncate text-muted">{dep.vessels?.name ?? "-"}</p>
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className="text-muted">
                  {booked(dep)}/{dep.capacity} passageiros
                </span>
                {dep.status !== "agendada" && (
                  <Badge tone={statusTone[dep.status] ?? "slate"}>
                    <span className="capitalize">{dep.status.replace("_", " ")}</span>
                  </Badge>
                )}
              </div>
              {/* Etapa 2 do vento (nao implementada aqui, de proposito):
                  quando houver condicoes de vento por saida, o resumo
                  compacto ("💨 18 km/h NE") entra como mais uma linha aqui
                  dentro, ao lado do status -- este componente ja recebe um
                  objeto `dep` por saida, entao basta acrescentar o campo
                  (ex.: windSummary?: string) ao tipo CalendarDeparture e
                  renderizar condicionalmente, sem mudar a query nem a
                  estrutura de agrupamento por dia. */}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
