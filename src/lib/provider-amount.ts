// Valor em reais recebido do Asaas (API ou corpo do webhook) -> centavos
// inteiros, ou null quando o valor não é um número válido. Validado ANTES do
// arredondamento: não finito, negativo, fração abaixo do centavo e valor acima
// do `int` do Postgres (tipo das colunas/parâmetros *_amount_cents) são
// recusados, nunca "consertados" por Math.round. A tolerância só absorve o erro
// binário de ponto flutuante (199.9 * 100 = 19989.999999999996).
export const PG_INT_MAX = 2147483647;

export function providerReaisToCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const raw = value * 100;
  const cents = Math.round(raw);
  if (Math.abs(raw - cents) > 1e-6 || cents > PG_INT_MAX) return null;
  return cents;
}
