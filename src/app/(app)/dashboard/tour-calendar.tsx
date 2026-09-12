"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { ScrollShadowX } from "@/components/scroll-shadow-x";
import { fmtTime } from "@/lib/format";
import { statusTone } from "../saidas/departure-row";

export type CalendarDeparture = {
  id: string;
  departs_at: string;
  capacity: number;
  status: string;
  vessels: { name: string } | null;
  tours: { name: string } | null;
  reservations: { people_count: number; status: string }[];
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
// prop, buscados numa unica consulta server-side em page.tsx. Trocar de dia
// nunca dispara uma nova busca nem navega pra outra rota.
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
          <div className="flex gap-2 pb-1">
            {days.map((d, i) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelected(i)}
                className={`flex min-w-[60px] shrink-0 flex-col items-center rounded-lg border px-3 py-2 text-center transition ${
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
          <p className="mb-3 text-sm font-medium text-heading">
            {title} <span className="font-normal text-muted">— {countLabel}</span>
          </p>

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
  return (
    <Link
      href={`/saidas/${dep.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line px-3 py-2.5 text-sm transition hover:border-brand hover:bg-surfaceHover sm:flex-nowrap"
    >
      <span className="w-14 shrink-0 font-display font-semibold text-heading">{fmtTime(dep.departs_at)}</span>
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <p className="font-medium text-heading">{dep.tours?.name ?? "Passeio"}</p>
        <p className="text-xs text-muted">
          {dep.vessels?.name ?? "-"} · {booked(dep)}/{dep.capacity} passageiros
        </p>
      </div>
      {dep.status !== "agendada" && (
        <Badge tone={statusTone[dep.status] ?? "slate"}>
          <span className="capitalize">{dep.status.replace("_", " ")}</span>
        </Badge>
      )}
      {/* Etapa 2 do vento (nao implementada aqui, de proposito): quando
          houver condicoes de vento por saida, o resumo compacto
          ("💨 18 km/h NE" / "Rajadas 27 km/h") entra como mais um `span`
          aqui dentro, ao lado do status -- este componente ja recebe um
          objeto `dep` por saida, entao basta acrescentar o campo (ex.:
          windSummary?: string) ao tipo CalendarDeparture e renderizar
          condicionalmente, sem mudar a query nem a logica de selecao de
          dia. */}
    </Link>
  );
}
