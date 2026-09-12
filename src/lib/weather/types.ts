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

// Um ponto de previsão horária (vento previsto pra um horário específico,
// não "agora"). Usado tanto no digest de 6h do WindConditionsCard quanto na
// janela completa (até ~7 dias) usada internamente pra associar vento a
// cada saída da Agenda de passeios -- ver getWindForecastWindow em
// provider.ts e src/app/(app)/dashboard/wind-forecast-match.ts.
export type WindForecastPoint = WindConditionPoint & { time: string };

export type WindConditions = {
  current: WindConditionPoint & { observedAt: string };
  /**
   * O tamanho desta lista depende de QUEM pediu: getWindConditions()
   * devolve só as próximas ~6h (o que o WindConditionsCard mostra);
   * getWindForecastWindow() devolve a janela completa (até ~7 dias, uso
   * exclusivamente server-side). Nunca confundir os dois -- o card nunca
   * deve iterar sobre a janela completa.
   */
  hourly: WindForecastPoint[];
};

// Erro de INFRAESTRUTURA do provider (rede, timeout, resposta inesperada) --
// nunca deixado vazar cru pra UI (a mensagem aqui é só pra log server-side).
export class WeatherProviderError extends Error {}
