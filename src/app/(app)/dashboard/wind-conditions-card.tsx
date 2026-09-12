import Link from "next/link";
import { Wind, Navigation, MapPin, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui";
import type { WeatherState } from "./weather-state";

// "12h"/"13h"... -- o Open-Meteo já devolve o horário em America/Sao_Paulo
// (timezone pedido na query), então isto é só recorte de string, nunca uma
// conversão de fuso nova (evita repetir o mesmo tipo de bug já corrigido na
// automação de agenda, migrations 0065/0066 -- nunca reinterpretar um
// horário que já está correto).
function hourLabel(isoLocal: string): string {
  return `${isoLocal.slice(11, 13)}h`;
}

function timeLabel(isoLocal: string): string {
  return isoLocal.slice(11, 16);
}

// Quantas horas o card mostra -- nunca a janela completa que o Dashboard
// carrega internamente pra associar vento às saídas da Agenda (Etapa 2).
const CARD_HOURLY_COUNT = 6;

// Card 100% best-effort: qualquer falha (empresa sem localização, provider
// fora do ar, resposta inesperada) termina num retângulo discreto, NUNCA
// numa exceção que derrubaria o Dashboard inteiro. Puramente apresentacional
// -- a busca de dados (profile, empresa, provider de clima) acontece UMA
// vez em dashboard/weather-state.ts e chega aqui pronta via prop, pro
// Dashboard nunca fazer duas leituras de clima na mesma renderização
// (Etapa 2, pedido explícito).
export function WindConditionsCard({ state }: { state: WeatherState }) {
  if (!state) return null;

  if (state.kind === "no-location") {
    return (
      <Card className="mb-5 !py-4">
        <div className="mb-1.5 flex items-center gap-2">
          <Wind size={18} className="text-muted" />
          <h3 className="font-display text-base font-semibold text-heading">Condições do vento</h3>
        </div>
        <p className="mb-2.5 text-sm text-muted">
          Configure a localização de operação para visualizar as condições do vento.
        </p>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <MapPin size={14} /> Configurar localização
        </Link>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card className="mb-5 !py-4">
        <div className="mb-1 flex items-center gap-2">
          <Wind size={18} className="text-muted" />
          <h3 className="font-display text-base font-semibold text-heading">Condições do vento</h3>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <AlertCircle size={14} /> Condições do vento indisponíveis no momento.
        </p>
      </Card>
    );
  }

  const { current } = state.conditions;
  // digest de 6h -- a `conditions.hourly` que chega aqui é a janela
  // completa (até ~7 dias, usada pela Agenda); o card nunca mostra mais do
  // que isto.
  const hourly = state.conditions.hourly.slice(0, CARD_HOURLY_COUNT);

  return (
    <Card className="mb-5 !py-4">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Wind size={18} className="text-brand" />
            <h3 className="font-display text-base font-semibold text-heading">Condições do vento</h3>
          </div>
          {state.locationName && <p className="text-xs text-muted">{state.locationName}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <p className="font-display text-2xl font-semibold text-heading">{current.windSpeedKmh} km/h</p>
          <p className="text-xs text-muted">Vento atual</p>
        </div>
        <div className="space-y-0.5 text-sm text-body">
          {current.windGustKmh != null && (
            <p>
              Rajadas: <span className="font-medium text-heading">{current.windGustKmh} km/h</span>
            </p>
          )}
          <p className="flex items-center gap-1">
            Direção:{" "}
            <span className="inline-flex items-center gap-1 font-medium text-heading">
              <Navigation size={13} style={{ transform: `rotate(${current.windDirectionDegrees}deg)` }} />
              {current.windDirectionLabel}
            </span>
          </p>
          <p className="text-xs text-muted">Atualizado às {timeLabel(current.observedAt)}</p>
        </div>
      </div>

      {hourly.length > 0 && (
        <div className="mt-2.5 border-t border-line pt-2">
          <p className="mb-1 text-xs text-muted">Próximas horas</p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {hourly.map((h) => (
              <div key={h.time} className="rounded-lg border border-line px-1.5 py-0.5 text-center">
                <p className="text-xs text-muted">{hourLabel(h.time)}</p>
                <p className="text-sm font-semibold text-heading">{h.windSpeedKmh} km/h</p>
                <p className="text-[11px] text-muted">{h.windDirectionLabel}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
