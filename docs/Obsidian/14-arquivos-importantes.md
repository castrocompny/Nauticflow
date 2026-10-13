---
tags:
  - nauticflow
  - arquivos
updated: 2026-09-19
---
← [[00-INDEX]]

# Arquivos e pastas importantes

Lista curada — não é um índice completo do repositório, só o que um Claude Code futuro precisa saber que existe antes de mexer no projeto.

## Documentação (leia primeiro)

- `AGENTS.md` (raiz) — instrução permanente: esta versão do Next.js tem breaking changes vs. o conhecimento de treinamento padrão; ler `node_modules/next/dist/docs/` antes de escrever código Next.js. `CLAUDE.md` só importa esse arquivo (`@AGENTS.md`).
- `DOCUMENTACAO.md` (raiz) — log de sessões de trabalho, fonte histórica primária (147 seções até 2026-09-15). Complementado por este vault Obsidian, que é a camada consolidada/atual — mas `DOCUMENTACAO.md` continua sendo a fonte narrativa detalhada de cada decisão.
- `README.md` (raiz) — pitch + decisões de arquitetura resumidas + como rodar localmente.
- `.env.example` (raiz) — todas as env vars comentadas uma a uma. Ver [[10-flags-e-variaveis]].
- `docs/PUBLIC-API-CONTRACT.md` — contrato da API pública consumida pelo ToursFlow. Ver [[08-integracao-toursflow]].
- `docs/adr/000X-*.md` — Architecture Decision Records do marketplace (hold, ledger/payout/refund, destino de payout, cancelamento/no-show/refund, saque/Pix, comissão global, Pix payment settlement, automação de agenda, modelos de reserva fixed/flexible). Ver [[11-decisoes-tecnicas]].
- `docs/Obsidian/` — este vault.

## Aplicação (`src/`)

- `src/proxy.ts` — proteção de rotas (auth gate). **Renomeado de `src/middleware.ts`** na sessão de 2026-08-19 (codemod oficial `middleware-to-proxy`, seguindo a depreciação encontrada na migração pra Next 16 — ver [[03-stack-e-infraestrutura]]). README ainda cita `src/middleware.ts` em alguns trechos — desatualizado.
- `src/lib/supabase/` — clients Supabase por contexto: `client.ts` (browser), `server.ts` (Server Components/Actions, por requisição), `middleware.ts` (valida sessão via `auth.getUser()`), `admin.ts` (service_role, **nunca fora do servidor**).
- `src/lib/site-url.ts` — resolve a URL pública do site pra links de e-mail (substituiu `headers().get("origin")`).
- `src/lib/subscription.ts` — `requireActiveSubscription()`/`getSubscriptionStatus()`: bloqueio de criação por assinatura vencida/suspensa, limites do plano (`max_vessels`, `max_users`).
- `src/lib/profile.ts` — `getProfile()`, memoizado com `cache()` do React (evita repetir `auth.getUser()`/query em `profiles` na mesma requisição).
- `src/lib/asaas.ts` — integração com a API do Asaas (cobrança SaaS).
- `src/lib/marketplace-api.ts` — autenticação/autorização das rotas server-to-server do ToursFlow (`isAuthorizedToursFlowRequest()`).
- `src/lib/marketplace-ledger.ts`, `payout-accounts.ts`, `marketplace-payment-cleanup.ts`, `marketplace-refund-reconciliation.ts` — motor financeiro do marketplace (ledger, saque, limpeza de pagamento pendente, reconciliação de reembolso).
- `src/lib/price-calc.ts` — cálculo de preço (reserva de balcão, marketplace).
- `src/lib/public-api.ts` — rate limit e helpers das 5 rotas `/api/public/*`.
- `src/lib/rate-limit.ts` — infraestrutura de rate limiting reutilizada por API pública e marketplace.
- `src/lib/security-log.ts` — log de eventos de segurança (ex: troca de chave Pix).
- `src/lib/trial-identity.ts` — validação de CPF/CNPJ pro anti-abuso do trial (pepper real fica no banco, não aqui — ver [[10-flags-e-variaveis]]).
- `src/lib/tour-publishing.ts` — validação/fluxo de publicação autônoma de passeio.
- `src/lib/tour-schedule.ts` — automação de agenda recorrente (`tour_schedule_rules`).
- `src/lib/image-moderation.ts` — moderação de foto de passeio (manual/OpenAI).
- `src/lib/weather/` — provider de clima/vento (Open-Meteo).
- `src/lib/password.ts` — `validatePassword()` (política de senha forte).
- `src/lib/team-invite-email.ts` — envio de convite de equipe via Resend (substituiu o e-mail nativo do Supabase).
- `src/lib/admin-auth.ts` — checagem de acesso ao painel `/admin` (+ 2FA/TOTP).
- `src/lib/types.ts` — tipos de domínio compartilhados.
- `src/app/(app)/` — área autenticada: `dashboard/ reservas/ agenda/ saidas/ clientes/ embarcacoes/ parceiros/ passeios/ financeiro/ relatorios/ equipe/ configuracoes/ planos/`.
- `src/app/admin/` — painel super_admin (`[id]` detalhe de empresa, `mfa-setup`/`mfa-challenge` 2FA, `passeios` moderação de publicação).
- `src/app/api/marketplace/` — rotas server-to-server pro ToursFlow (bookings, payment).
- `src/app/api/public/` — 5 rotas públicas de catálogo.
- `src/app/api/webhooks/` — webhook do Asaas (cobrança SaaS + Pix marketplace).
- `src/app/api/cron/` — rotas de cron (ex: `extend-schedules`, extensão automática de agenda recorrente).
- `src/app/login/`, `src/app/auth/callback/`, `src/app/redefinir-senha/` — fluxo de auth.
- `src/app/voucher/[id]/`, `src/app/manifesto/[id]/` — páginas públicas geradas por reserva/saída.
- `src/components/marketing/plans.ts` — fonte real dos planos/preços da landing (`MKT_PLANS`). Ver [[09-planos-e-precos]].

## Banco (`supabase/`)

- `supabase/migrations/` — schema versionado, aplicado manualmente no SQL Editor do Supabase ou via `npx supabase db push` (CLI instalado como devDependency). Ver [[04-banco-e-supabase]] pro resumo por migration.
- `supabase/config.toml` — config do Supabase CLI.
- `supabase/functions/` — Edge Functions Deno (ex: `send-reservation-voucher`) — **não** deployadas por `git push`/Vercel, precisam de `supabase functions deploy` manual.

## Config de projeto

- `next.config.mjs` — headers de segurança (CSP/HSTS/X-Frame-Options), `experimental.staleTimes`.
- `package.json` — dependências reais, ver [[03-stack-e-infraestrutura]].
- `.env.example` — ver [[10-flags-e-variaveis]].
- `vercel.json`, `.vercel/` — config de deploy Vercel.
- `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation-client.ts`, `src/instrumentation.ts` — config Sentry.
