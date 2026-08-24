import { withSentryConfig } from "@sentry/nextjs";

// 'unsafe-eval' só entra em desenvolvimento -- o próprio Next.js (Turbopack/webpack) usa
// eval() em dev pra HMR e stack traces legíveis, mas o build de produção nunca usa eval()
// de verdade, então não faz sentido afrouxar a CSP publicada em produção por causa disso.
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' no script-src é necessário pro script anti-flash do tema (modo escuro) em src/app/layout.tsx,
  // que roda antes da página pintar e não usa nonce. Se algum dia migrar pra CSP com nonce, dá pra remover.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  // wss://*.supabase.co: canal websocket do Supabase Realtime (RealtimeRefresh) --
  // sem isso a CSP bloqueia silenciosamente a conexao e a tela nunca atualiza sozinha
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io",
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
