import "server-only";
import { fetchOpenMeteoWind } from "./open-meteo";
import type { WeatherLocation, WindConditions } from "./types";

// ÚNICO ponto de entrada que o resto do app deve importar. Trocar de
// fornecedor (Open-Meteo -> outro) no futuro significa mudar só a chamada
// abaixo -- nenhum consumidor (Dashboard, etc.) conhece formato bruto de
// provider nenhum.
//
// Cache em memória do processo, ~5 minutos -- pedido explícito: não bater no
// provider a cada renderização, sem guardar histórico nenhum no banco nesta
// etapa. Guarda sempre a JANELA COMPLETA (até ~7 dias, ver FORECAST_DAYS em
// open-meteo.ts) -- tanto o digest de 6h (getWindConditions) quanto a janela
// inteira (getWindForecastWindow, usada pra associar vento a cada saída da
// Agenda) vêm da MESMA entrada de cache, nunca duas consultas ao provider.
// Limitação conhecida e aceita nesta etapa: em ambiente serverless (Vercel),
// cada instância de função tem sua PRÓPRIA memória -- isto não é um cache
// distribuído/global, é "não bater de novo se a MESMA instância já tinha
// buscado há pouco". Reduz consumo/risco de rate limit na prática (o
// Dashboard é visitado repetidamente pelas mesmas pessoas em poucos
// minutos), mas não garante uma única chamada por período pra toda a frota
// de instâncias -- suficiente pro objetivo desta etapa (nunca preciso ser
// "por segundo"), sem a complexidade de um cache compartilhado (Redis etc.)
// que esta etapa não pediu.
const CACHE_TTL_MS = 5 * 60 * 1000;
// Quantas horas o WindConditionsCard mostra -- nunca a janela inteira (pedido
// explícito: o card não vira uma previsão de 7 dias).
const CARD_HOURLY_COUNT = 6;
const cache = new Map<string, { expiresAt: number; data: WindConditions }>();

function cacheKey(location: WeatherLocation): string {
  // arredonda pra evitar entradas de cache diferentes por ruído de ponto
  // flutuante na MESMA coordenada salva no banco.
  return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
}

async function loadWindConditions(location: WeatherLocation): Promise<WindConditions> {
  const key = cacheKey(location);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const data = await fetchOpenMeteoWind(location);
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}

// Digest pro WindConditionsCard -- vento atual + só as próximas 6h, nunca a
// janela inteira. Reaproveita o mesmo cache/consulta de
// getWindForecastWindow (mesma chamada de fundo, `loadWindConditions`).
export async function getWindConditions(location: WeatherLocation): Promise<WindConditions> {
  const full = await loadWindConditions(location);
  return { current: full.current, hourly: full.hourly.slice(0, CARD_HOURLY_COUNT) };
}

// Janela completa (até ~7 dias) -- uso EXCLUSIVAMENTE server-side, pra
// associar previsão de vento a cada saída da Agenda de passeios (nunca
// enviada crua ao browser -- ver dashboard/weather-state.ts e
// dashboard/wind-forecast-match.ts, que extraem só o necessário por saída
// antes de passar pro componente client). Reaproveita o MESMO
// cache/consulta de getWindConditions -- nunca uma segunda chamada ao
// provider na mesma renderização do Dashboard.
export async function getWindForecastWindow(location: WeatherLocation): Promise<WindConditions> {
  return loadWindConditions(location);
}
