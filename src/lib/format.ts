const TZ = "America/Sao_Paulo";
// Brasil nao tem horario de verao desde 2019 -- o offset de Brasilia e sempre
// fixo em -03:00, entao da pra fazer a conta na mao sem precisar de biblioteca
// de timezone (nao ha date-fns-tz/luxon no projeto). O servidor (Vercel) roda em
// UTC, entao qualquer `.getHours()`/`.getFullYear()` etc. direto num Date le o
// horario errado em producao -- as funcoes abaixo sempre calculam em cima do
// horario de Brasilia, nao do fuso do processo que esta rodando o codigo.
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

// hora (0-23) de um timestamp UTC no horario de Brasilia -- usar em vez de
// `new Date(iso).getHours()`, que le a hora no fuso do processo (UTC na Vercel)
export function saoPauloHour(iso: string): number {
  return new Date(new Date(iso).getTime() - SP_OFFSET_MS).getUTCHours();
}

// "HH:MM" no horario de Brasilia -- usada pra validar o horario comercial (08:00-19:00)
export function saoPauloHHMM(iso: string): string {
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// chave "ano-mes-dia" do dia civil em Brasilia de um timestamp UTC -- usar pra
// agrupar/comparar por dia em vez de getFullYear/getMonth/getDate (fuso do processo)
export function saoPauloDayKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

// instante UTC real da meia-noite (00:00) em Brasilia do dia em que `instant` cai
export function saoPauloStartOfDay(instant: Date): Date {
  const wall = new Date(instant.getTime() - SP_OFFSET_MS);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) + SP_OFFSET_MS);
}

// instante UTC real do dia 1 (00:00) do mes em Brasilia em que `instant` cai;
// `monthOffset` desloca por meses (ex: -1 pro mes anterior)
export function saoPauloStartOfMonth(instant: Date, monthOffset = 0): Date {
  const wall = new Date(instant.getTime() - SP_OFFSET_MS);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + monthOffset, 1) + SP_OFFSET_MS);
}

// timestamp UTC (ISO) a partir de uma data "YYYY-MM-DD" e hora "HH:MM" vindas de
// um formulario (<input type="date"/"time">), interpretados como horario de Brasilia
export function saoPauloToUTC(date: string, time: string): string {
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}

export function startEndOfToday(): { start: string; end: string } {
  const start = saoPauloStartOfDay(new Date());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
