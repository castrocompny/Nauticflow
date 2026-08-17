import { withSentryConfig } from "@sentry/nextjs";

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' no script-src é necessário pro script anti-flash do tema (modo escuro) em src/app/layout.tsx,
  // que roda antes da página pintar e não usa nonce. Se algum dia migrar pra CSP com nonce, dá pra remover.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.sentry.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // sourcemaps/release do Sentry usam um token de auth separado (SENTRY_AUTH_TOKEN);
  // sem ele, o app funciona normal, so fica sem stack trace "bonito" (minificado).
  widenClientFileUpload: true,
});
