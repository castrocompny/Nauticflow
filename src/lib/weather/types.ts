// Contrato interno de "condições do vento" -- o resto do NauticFlow (Dashboard,
// e qualquer tela futura) só conhece ESTE formato, nunca o formato bruto de um
// fornecedor específico (Open-Meteo hoje, outro no futuro). Trocar de provider
// nunca deve exigir tocar em nada fora de src/lib/weather/.

export type WeatherLocation = {
  latitude: number;
  longitude: number;
};

export type WindConditionPoint = {
  windSpeedKmh: number;
  /** null quando o provider não informa rajada pra este ponto. */
  windGustKmh: number | null;
  windDirectionDegrees: number;
  /** N/NE/E/SE/S/SO/O/NO -- ver src/lib/weather/direction.ts. */
  windDirectionLabel: string;
};

export type WindConditions = {
  current: WindConditionPoint & { observedAt: string };
  /** Só as próximas ~6h -- nunca a previsão completa do dia. */
  hourly: (WindConditionPoint & { time: string })[];
};

// Erro de INFRAESTRUTURA do provider (rede, timeout, resposta inesperada) --
// nunca deixado vazar cru pra UI (a mensagem aqui é só pra log server-side).
export class WeatherProviderError extends Error {}
