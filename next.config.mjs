import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withSentryConfig(nextConfig, {
  silent: true,
  // sourcemaps/release do Sentry usam um token de auth separado (SENTRY_AUTH_TOKEN);
  // sem ele, o app funciona normal, so fica sem stack trace "bonito" (minificado).
  widenClientFileUpload: true,
});
