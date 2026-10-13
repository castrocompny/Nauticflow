---
tags:
  - nauticflow
  - flags
  - env
updated: 2026-09-19
---
← [[00-INDEX]] · relacionado: [[06-seguranca]] · [[08-integracao-toursflow]] · [[12-riscos-e-pendencias]]

# Flags e variáveis de ambiente

Regra absoluta deste vault: **só nome e função de cada variável, nunca o valor**. Fonte: `.env.example` (comentado no próprio repo) + `DOCUMENTACAO.md`.

## Supabase

| Variável | Função |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase. Pública (prefixo `NEXT_PUBLIC_`, chega ao navegador) — protegida pela RLS, não por sigilo. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anônima. Mesma lógica: pública por design, segurança real é RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only.** Ignora toda RLS. Usada em Server Actions/Route Handlers administrativos (convidar/remover usuário, moderação, painel super_admin, webhooks). Ver `src/lib/supabase/admin.ts` — nunca usar esse client fora do servidor. |

## Aplicação

| Variável | Função |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | URL pública/definitiva do site, usada em links de e-mail (reset de senha, convite de equipe). Ver `src/lib/site-url.ts`. Opcional — cai pra `VERCEL_URL` (injetada automaticamente pela Vercel) em preview, `localhost:3000` em dev. Substituiu o uso de `headers().get("origin")` (ver [[06-seguranca]]). |
| `MAILER_SECRET` | Header `x-mailer-secret` ao chamar a Edge Function `send-email` (convite de equipe via Resend). Ver `src/app/(app)/equipe/actions.ts`. |

## Asaas (cobrança do SaaS)

| Variável | Função |
|---|---|
| `ASAAS_API_URL` | Opcional. Default sandbox (`api-sandbox.asaas.com`). Trocar pra produção (`api.asaas.com`) só na virada comercial real — ver [[12-riscos-e-pendencias]]. |
| `ASAAS_API_KEY` | Access token da API Asaas. Sem ela, cobrança falha controladamente. Ver `src/lib/asaas.ts`. Prefixo `$aact_hmlg_` = sandbox, `$aact_prod_` = produção. **Cuidado**: `$` no início é interpretado como referência de variável pelo Next.js/dotenv em `.env.local` — precisa escapar (`\$aact_...`); na Vercel não precisa (valor puro, sem parsing de shell). |
| `ASAAS_WEBHOOK_TOKEN` | Token esperado no header `asaas-access-token` dos webhooks. Ver `src/app/api/webhooks/asaas/route.ts`. Comparação feita com `crypto.timingSafeEqual` (não `!==`). |

## Sentry

| Variável | Função |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Opcional. Sem ela, Sentry fica desabilitado (`enabled: false`), nenhum evento enviado. Ver `sentry.server.config.ts` / `sentry.edge.config.ts` / `src/instrumentation-client.ts` / `src/lib/sentry-dsn.ts`. |

## Marketplace ToursFlow — autenticação e rate limit

| Variável | Função |
|---|---|
| `TOURSFLOW_API_SECRET` | Segredo compartilhado com o servidor do ToursFlow, autentica `POST /api/marketplace/bookings` (Bearer). Nunca exposto ao navegador do turista. `isAuthorizedToursFlowRequest()` (`marketplace-api.ts`) falha fechado se ausente — nenhuma requisição externa alcança a criação de booking sem ela. |
| `TOURSFLOW_RATE_LIMIT_MAX_REQUESTS` / `TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS` | Rate limit GLOBAL do consumidor "toursflow". Opcional, default 30 req/60s. |
| `TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS` / `TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS` | 2ª camada, por visitante do ToursFlow (mesma infra, chave por visitante). Opcional, default 10 req/60s. |

## API pública

| Variável | Função |
|---|---|
| `PUBLIC_API_RATE_LIMIT_MAX_REQUESTS` / `PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS` | Limite GLOBAL (não por IP — ver `src/lib/public-api.ts`) compartilhado pelas 5 rotas `/api/public/*`. Opcional, default 600 req/60s. |

## Moderação de imagem

| Variável | Função |
|---|---|
| `IMAGE_MODERATION_MODE` | Política **explícita**, nunca inferida pela ausência da chave. `"manual"` (padrão do lançamento inicial — upload nasce liberado, super_admin monitora/suspende via `/admin/passeios`) ou `"openai"` (upload nasce `pending`, passa pela OpenAI Moderation API de verdade). Qualquer valor ausente/diferente cai em `"manual"` (modo seguro, nunca bloqueia nem chama rede externa por engano). Ver `src/lib/image-moderation.ts`. |
| `OPENAI_API_KEY` | Só usada quando `IMAGE_MODERATION_MODE=openai`. Sem ela nesse modo, moderação falha fechada (`moderation_unavailable`), nunca aprova por fallback. |

## Anti-abuso do trial de 7 dias

| Variável | Função |
|---|---|
| `TRIAL_IDENTITY_PEPPER` | **Importante**: só usada por funções auxiliares (validação de CPF/CNPJ, testável isoladamente) — **não** é o segredo que decide se o trial é concedido. Essa decisão roda dentro do gatilho `handle_new_user()` no Postgres (migration `0045`), com um pepper **próprio** guardado em tabela travada `public.trial_identity_secret` (configurada manualmente via SQL, nunca por env var) — de propósito, porque o endpoint de signup do Supabase é público e o fingerprint precisa ser recalculado no banco a partir do dado bruto. Ver `src/lib/trial-identity.ts`. |

## Clima/vento (Dashboard)

| Variável | Função |
|---|---|
| `WEATHER_API_BASE_URL` | Opcional; sem ela usa o endpoint gratuito do Open-Meteo. Server-side only. Ver `src/lib/weather/`. |
| `WEATHER_API_KEY` | Opcional; Open-Meteo gratuito não exige chave; se definida, vai como query param `apikey` (plano comercial). Nunca `NEXT_PUBLIC_` — chamada sempre server-side (`src/lib/weather/open-meteo.ts`). |

## ⚠️ Flags de ativação financeira do marketplace — NÃO documentadas em `.env.example`

Confirmadas apenas no código e em `DOCUMENTACAO.md` (seções 90, 93-99). Todas **fail-closed por padrão** (ausência = desligado):

| Variável | Função | Estado |
|---|---|---|
| `MARKETPLACE_PAYMENTS_ENABLED` | Flag mestra: liga/desliga pagamento real do marketplace (Pix do turista). `isMarketplacePaymentsEnabled()`. | `NÃO CONFIRMADO EM PRODUÇÃO` no momento mais recente que este vault conseguiu confirmar — ver [[12-riscos-e-pendencias]] e [[08-integracao-toursflow]] pro estado mais atual, não assuma um valor. |
| `MARKETPLACE_PAYMENTS_MODE` | Modo de operação (mock/sandbox/produção) — precisa estar explicitamente configurada pra qualquer chamada de rede real ao Asaas dentro do fluxo do marketplace. | idem acima |
| `MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED` | Habilita saque real (Pix) do operador. `isMarketplaceWithdrawalPayoutEnabled()`. | idem acima |

Confirmado por leitura direta de código em sessões passadas: com as 3 flags ausentes, o endpoint de pagamento sempre retorna `PAYMENT_PROVIDER_NOT_ENABLED` (`501`) sem tocar rede.

## Regra de leitura deste vault

Nenhuma seção acima afirma um valor atual de produção pras 3 flags do marketplace — isso muda de sessão pra sessão e só pode ser confirmado olhando `vercel env ls production` (só nomes, nunca valores) no momento da leitura. Trate como estado dinâmico, não estático.
