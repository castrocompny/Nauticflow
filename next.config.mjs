import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // sem isso, o Next 14 nao reaproveita paginas dinamicas ja visitadas no cache do
    // navegador -- todo clique no menu lateral ia direto pro servidor de novo, mesmo
    // clicando entre paginas visitadas segundos antes. Com isso, uma pagina revisitada
    // dentro de 30s aparece na hora, sem nova ida ao servidor.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // sourcemaps/release do Sentry usam um token de auth separado (SENTRY_AUTH_TOKEN);
  // sem ele, o app funciona normal, so fica sem stack trace "bonito" (minificado).
  widenClientFileUpload: true,
});
