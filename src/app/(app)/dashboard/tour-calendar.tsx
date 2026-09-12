"use client";

import { useState } from "react";
import Link from "next/link";
import { Wind } from "lucide-react";
import { Card, Badge, OccupancyBar } from "@/components/ui";
import { ScrollShadowX } from "@/components/scroll-shadow-x";
import { fmtTime } from "@/lib/format";
import { statusTone } from "../saidas/departure-row";
import type { DepartureWindSummary } from "./wind-forecast-match";

export type CalendarDeparture = {
  id: string;
  departs_at: string;
  capacity: number;
  status: string;
  vessels: { name: string } | null;
  tours: { name: string } | null;
  reservations: { people_count: number; status: string }[];
  // Previsão de vento pro horário desta saída -- já associada server-side
  // (ver wind-forecast-match.ts), nunca o ponto de previsão bruto. `null`/
  // ausente sempre que não houver previsão disponível (sem localização,
  // provider fora do ar, sem ponto próximo o bastante) -- nunca mostrar
  // "undefined km/h" nem inventar um valor.
  wind?: DepartureWindSummary | null;
};

// Dado do dia ja pronto pra exibir -- so primitivos serializaveis (string/
// number/boolean), nada de Date cruzando a fronteira Server -> Client.
// Todo o calculo de fuso horario (dia civil em Brasilia, nome do dia da
// semana, mes) acontece server-side em page.tsx, nunca aqui.
export type CalendarDayData = {
  key: string;
  isToday: boolean;
  dayNumber: number;
  weekdayLabel: string; // faixa compacta: "HOJE" ou "DOM"/"SEG"/...
  weekdayFull: string; // titulo da lista: "Hoje" ou "Domingo"/"Segunda"/...
  monthFull: string; // titulo da lista (dias que nao sao hoje): "setembro"
  departures: CalendarDeparture[];
};

// Passageiros confirmados de uma saida -- so reservas que o sistema ja trata
// como validas (status "confirmada"), mesma regra usada em /saidas e no
// Dashboard antes desta mudanca; nenhuma regra de reserva foi alterada aqui.
function booked(d: CalendarDeparture): number {
  return d.reservations.filter((r) => r.status === "confirmada").reduce((s, r) => s + r.people_count, 0);
}

// Unico pedaco interativo do Dashboard: so a selecao do dia mexe em estado
// no navegador (useState local) -- os dados dos 7 dias ja chegam prontos por
// prop, buscados numa unica consulta server-side em page.tsx (departures) +
// uma unica leitura de clima (weather-state.ts). Trocar de dia nunca dispara
// uma nova busca nem navega pra outra rota.
export function TourCalendar({ days }: { days: CalendarDayData[] }) {
  const [selected, setSelected] = useState(0);
  const day = days[selected] ?? days[0];

  const title = day.isToday ? "Hoje" : `${day.weekdayFull}, ${day.dayNumber} de ${day.monthFull}`;
  const count = day.departures.length;
  const countLabel = `${count} ${count === 1 ? "saída" : "saídas"}`;

  return (
    <div className="mb-8">
      <h2 className="mb-3 font-display text-lg font-semibold text-heading">Agenda de passeios</h2>
      <Card>
        <ScrollShadowX>
          {/* mobile: linha que rola horizontalmente, botoes com largura
              minima confortavel (nunca espremidos). Desktop (sm+): grid de
              7 colunas ocupando a largura toda do card, nada de espaco
              vazio sobrando. */}
          <div className="flex gap-2 pb-1 sm:grid sm:grid-cols-7">
            {days.map((d, i) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelected(i)}
                className={`flex min-w-[64px] shrink-0 flex-col items-center rounded-lg border px-2 py-2 text-center transition sm:min-w-0 sm:shrink ${
                  i === selected
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface text-body hover:bg-surfaceHover"
                }`}
              >
                <span className={`text-[11px] font-semibold ${i === selected ? "text-white" : "text-muted"}`}>
                  {d.weekdayLabel}
                </span>
                <span className="font-display text-base font-semibold">{d.dayNumber}</span>
              </button>
            ))}
          </div>
        </ScrollShadowX>

        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-heading">
              {title} <span className="font-normal text-muted">— {countLabel}</span>
            </p>
            <Link href="/saidas" className="shrink-0 text-sm font-medium text-brand hover:underline">
              Ver todas as saídas
            </Link>
          </div>

          {count === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nenhum passeio agendado para este dia.</p>
          ) : (
            <div className="space-y-2">
              {day.departures.map((dep) => (
                <DepartureRow key={dep.id} dep={dep} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function DepartureRow({ dep }: { dep: CalendarDeparture }) {
  const confirmed = booked(dep);

  return (
    <Link
      href={`/saidas/${dep.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line px-3 py-2.5 text-sm transition hover:border-brand hover:bg-surfaceHover sm:flex-nowrap"
    >
      <span className="w-14 shrink-0 font-display font-semibold text-heading">{fmtTime(dep.departs_at)}</span>

      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
        <p className="font-medium text-heading">{dep.tours?.name ?? "Passeio"}</p>
        <p className="text-xs text-muted">{dep.vessels?.name ?? "-"}</p>
      </div>

      <div className="basis-full sm:basis-auto sm:w-32 sm:shrink-0">
        <p className="text-xs text-muted">
          {confirmed}/{dep.capacity} passageiros
        </p>
        <div className="mt-1">
          <OccupancyBar booked={confirmed} capacity={dep.capacity} />
        </div>
      </div>

      {/* Etapa 2 do vento: resumo por saida, ja associado server-side (nunca
          uma chamada por departure -- ver wind-forecast-match.ts). Ausente
          sempre que nao houver previsao disponivel, nunca um valor
          inventado ("undefined km/h"/NaN). */}
      {dep.wind && (
        <div className="flex basis-full items-center gap-1 text-xs text-muted sm:basis-auto sm:w-auto sm:shrink-0">
          <Wind size={12} />
          <span>
            {dep.wind.speedKmh} km/h {dep.wind.directionLabel}
            {dep.wind.gustKmh != null ? ` · Raj. ${dep.wind.gustKmh} km/h` : ""}
          </span>
        </div>
      )}

      {dep.status !== "agendada" && (
        <Badge tone={statusTone[dep.status] ?? "slate"}>
          <span className="capitalize">{dep.status.replace("_", " ")}</span>
        </Badge>
      )}
    </Link>
  );
}
