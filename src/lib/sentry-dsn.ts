// Compartilhado por instrumentation-client.ts / sentry.server.config.ts /
// sentry.edge.config.ts. Achado real: `NEXT_PUBLIC_SENTRY_DSN` chegou a ficar
// configurada em Production com o placeholder literal do `.env.example`
// ("sua-dsn-do-sentry") -- uma string não-vazia, então o antigo `!!dsn` como
// gate de "enabled" deixava o SDK tentar inicializar mesmo assim, gerando
// "Invalid Sentry Dsn" no console em toda carga de página. Isto valida o
// FORMATO (URL com chave pública + host + id numérico de projeto), não só a
// presença da variável -- qualquer valor que não seja um DSN de verdade
// (vazio, placeholder, "undefined" como string) desativa o Sentry em
// silêncio, em vez de tentar inicializar com lixo.
const DSN_PATTERN = /^https:\/\/[a-f0-9]+@[^/]+\/\d+$/i;

export function getValidSentryDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return dsn && DSN_PATTERN.test(dsn) ? dsn : undefined;
}
