import { saoPauloToUTC } from "@/lib/format";
import type { WindForecastPoint } from "@/lib/weather/types";

// Regra determinística de associação (pedido explícito, seção 11 da Etapa
// 2): usa o ponto de previsão horária MAIS PRÓXIMO do horário da saída, em
// America/Sao_Paulo -- nunca interpola entre dois pontos. Em empate exato
// (ex.: saída às 14:30, pontos às 14:00 e 15:00, ambos a 30min de
// distância), prefere o horário ANTERIOR, pra nunca "olhar artificialmente
// mais longe no futuro".
//
// Folga máxima aceitável entre a saída e o ponto de previsão mais próximo.
// Numa série horária completa e contínua a distância real nunca passa de
// 30min (a metade do intervalo entre dois pontos) -- a folga extra (90min)
// só protege contra buracos na série ou uma saída caindo fora da janela
// buscada (ex.: se o forecast falhar parcialmente), sem nunca "inventar" um
// vento de um horário distante.
const MAX_GAP_MS = 90 * 60 * 1000;

export function nearestWindForecast(hourly: WindForecastPoint[], departsAtIso: string): WindForecastPoint | null {
  if (hourly.length === 0) return null;

  const target = new Date(departsAtIso).getTime();
  let best: WindForecastPoint | null = null;
  let bestDiff = Infinity;

  for (const point of hourly) {
    // point.time vem do Open-Meteo como horário LOCAL (America/Sao_Paulo)
    // sem offset, ex. "2026-09-12T14:00" -- NUNCA interpretar isso como UTC
    // (seria o mesmo bug de fuso já corrigido duas vezes nesta sessão,
    // migrations 0065/0066). saoPauloToUTC() converte pro instante real
    // (UTC) antes de comparar com departs_at, que já É um instante real.
    const [date, time] = point.time.split("T");
    if (!date || !time) continue;
    const pointInstant = new Date(saoPauloToUTC(date, time.slice(0, 5))).getTime();
    const diff = Math.abs(pointInstant - target);
    // hourly vem em ordem cronológica crescente -- `< bestDiff` (estrito)
    // faz o PRIMEIRO ponto de um empate vencer, que é sempre o mais antigo
    // dos dois, satisfazendo "prefira o horário anterior" sem lógica extra.
    if (diff < bestDiff) {
      bestDiff = diff;
      best = point;
    }
  }

  if (!best || bestDiff > MAX_GAP_MS) return null;
  return best;
}

// Formato mínimo que o TourCalendar (client) precisa por saída -- nunca o
// ponto de previsão bruto (que carrega `time`, campo que a UI da Agenda não
// usa e não precisa conhecer). Mantém o componente client desacoplado do
// formato do provider de clima, mesmo princípio já usado em
// src/lib/weather/ (Etapa 1).
export type DepartureWindSummary = {
  speedKmh: number;
  gustKmh: number | null;
  directionLabel: string;
};

// `hourly` null significa "sem previsão disponível pra essa empresa nesta
// renderização" (sem localização configurada, provider fora do ar, etc.) --
// nunca lança, sempre devolve null nesses casos, nunca um valor inventado.
export function windSummaryForDeparture(
  hourly: WindForecastPoint[] | null,
  departsAtIso: string
): DepartureWindSummary | null {
  if (!hourly) return null;
  const point = nearestWindForecast(hourly, departsAtIso);
  if (!point) return null;
  return { speedKmh: point.windSpeedKmh, gustKmh: point.windGustKmh, directionLabel: point.windDirectionLabel };
}
