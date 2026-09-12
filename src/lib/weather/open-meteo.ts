import "server-only";
import { degreesToCompassLabel } from "./direction";
import { WeatherProviderError, type WeatherLocation, type WindConditions } from "./types";

// Open-Meteo é o provider INICIAL (dev/staging, sem custo) -- deliberadamente
// isolado neste arquivo, nunca importado fora de src/lib/weather/, pra poder
// trocar de fornecedor no futuro sem tocar no Dashboard nem em nenhum outro
// consumidor. `WEATHER_API_BASE_URL` permite apontar pra um endpoint
// diferente (inclusive um provider comercial compatível) sem mudar código --
// "não amarrar permanentemente ao endpoint gratuito" (pedido explícito).
const DEFAULT_BASE_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 8000;
// Cobre a janela de 7 dias da Agenda de passeios do Dashboard (hoje + 6 dias
// -- CALENDAR_DAYS em dashboard/page.tsx). Coincidência de valor deliberada,
// não uma referência cruzada: esta camada não pode depender de uma
// constante do Dashboard (isolamento do provider), então o número fica
// duplicado aqui, documentado. Quem só precisa de poucas horas (o
// WindConditionsCard) recorta essa janela depois, em provider.ts -- nunca
// pedimos duas janelas diferentes ao Open-Meteo.
const FORECAST_DAYS = 7;

interface OpenMeteoResponse {
  current?: {
    time: string;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
  };
  hourly?: {
    time: string[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
  };
}

export async function fetchOpenMeteoWind(location: WeatherLocation): Promise<WindConditions> {
  const baseUrl = process.env.WEATHER_API_BASE_URL || DEFAULT_BASE_URL;
  // Chave opcional -- o endpoint gratuito do Open-Meteo não exige nenhuma; um
  // plano comercial (ou outro provider compatível) usa `apikey` como query
  // param, convenção real do Open-Meteo pra clientes pagos. NUNCA um header
  // Authorization inventado -- só o que o provider realmente documenta.
  const apiKey = process.env.WEATHER_API_KEY;

  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "America/Sao_Paulo");
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  if (apiKey) url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    throw new WeatherProviderError("Falha de rede ao consultar o provedor de clima.", { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WeatherProviderError(`Provedor de clima respondeu ${response.status}.`);
  }

  let json: OpenMeteoResponse;
  try {
    json = (await response.json()) as OpenMeteoResponse;
  } catch (error) {
    throw new WeatherProviderError("Resposta inválida (JSON) do provedor de clima.", { cause: error });
  }

  const current = json.current;
  const hourly = json.hourly;
  if (
    !current ||
    !hourly ||
    !Array.isArray(hourly.time) ||
    !Array.isArray(hourly.wind_speed_10m) ||
    !Array.isArray(hourly.wind_direction_10m)
  ) {
    throw new WeatherProviderError("Resposta do provedor de clima sem os campos esperados.");
  }

  // a partir de AGORA ate o fim da janela pedida (FORECAST_DAYS) -- o hourly
  // do Open-Meteo cobre os dias inteiros; acha o primeiro horário
  // estritamente depois do `current.time` e devolve TODOS os seguintes
  // (nunca recorta aqui pra um número fixo de horas -- quem só quer um
  // digest curto, tipo o WindConditionsCard, recorta depois, em
  // provider.ts).
  const startIndex = hourly.time.findIndex((t) => t > current.time);
  const sliceStart = startIndex >= 0 ? startIndex : 0;

  return {
    current: {
      windSpeedKmh: Math.round(current.wind_speed_10m),
      windGustKmh: current.wind_gusts_10m != null ? Math.round(current.wind_gusts_10m) : null,
      windDirectionDegrees: current.wind_direction_10m,
      windDirectionLabel: degreesToCompassLabel(current.wind_direction_10m),
      observedAt: current.time,
    },
    hourly: hourly.time.slice(sliceStart).map((time, i) => {
      const idx = sliceStart + i;
      return {
        time,
        windSpeedKmh: Math.round(hourly.wind_speed_10m[idx]),
        windGustKmh: hourly.wind_gusts_10m?.[idx] != null ? Math.round(hourly.wind_gusts_10m[idx]) : null,
        windDirectionDegrees: hourly.wind_direction_10m[idx],
        windDirectionLabel: degreesToCompassLabel(hourly.wind_direction_10m[idx]),
      };
    }),
  };
}
