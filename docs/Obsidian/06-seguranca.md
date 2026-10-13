---
tags:
  - nauticflow
  - seguranca
updated: 2026-09-19
---
← [[00-INDEX]] · relacionado: [[05-autenticacao-e-autorizacao]] · [[04-banco-e-supabase]] · [[12-riscos-e-pendencias]]

# Segurança

Consolidação das auditorias registradas em `DOCUMENTACAO.md` (§13, §26, §28, §31, §60, e a rodada de hardening do marketplace §74/§94 — esta nota cobre até a §60; hardening financeiro específico do marketplace está detalhado também em [[08-integracao-toursflow]]). Nenhuma vulnerabilidade estrutural ampla foi encontrada em nenhuma rodada — o padrão do projeto é RLS habilitada em toda tabela sensível + `security definer` com `search_path` fixo + checagem dupla (app e banco). Os achados reais formam uma classe específica e recorrente: **IDOR** (referência a outra empresa aceita sem validar dono da FK) e **grants/RPCs legadas expostas demais**.

## Linha do tempo de auditorias

| Sessão | O que cobriu | Achado principal |
|---|---|---|
| §13 (2026-08-10) | Auditoria completa (análise estática + `npm audit`) | IDOR em `reservations`/`passengers` (ALTA) — corrigido migration `0015` |
| §26 (2026-08-15/16) | Varredura de segurança completa a pedido do dono | 🔴 Escalação de privilégio via cadastro público — `handle_new_user()` confiava em `raw_user_meta_data` sem validar origem — corrigido migration `0018` |
| §28 (2026-08-16) | Varredura passiva (agente de navegador) + headers HTTP | Ausência de CSP/HSTS/X-Frame-Options — corrigido em `next.config.mjs` |
| §31 (2026-08-17) | Auditoria pré-produção completa | IDOR em `departures.vessel_id`/`tour_id` (migration `0015` cobriu `reservations`/`passengers` mas esqueceu `departures`) — corrigido migration `0019` |
| §60 (2026-08-23) | Auditoria completa do sistema inteiro | 🔴 `link_asaas_subscription()` com `grant execute to authenticated` — qualquer usuário logado virava Premium de graça — corrigido migration `0030` |

## IDOR — o padrão recorrente

Três vezes o mesmo tipo de bug apareceu em tabelas diferentes: uma Server Action aceitava um UUID de referência (FK) vindo do formulário e só a política de RLS da **linha nova** era checada (`company_id = current_company_id()`), nunca a empresa **dona da referência estrangeira**. Um usuário autenticado de qualquer empresa (cadastro é auto-serviço, sem aprovação) que soubesse o UUID de um registro de outra empresa — inclusive UUIDs que vazam por natureza, como o da URL do voucher enviado por e-mail — podia grudar uma reserva/passageiro/saída nele.

- `reservations`/`passengers` → migration `0015_valida_dono_das_fks.sql`
- `departures.vessel_id`/`tour_id` → migration `0019_valida_dono_fk_saidas.sql`

Correção sempre em **duas camadas**: validação explícita no app (compara `company_id` do registro referenciado antes do insert/update) **e** um gatilho no banco (fecha a brecha mesmo contra chamada direta à API do Supabase, sem passar pelo app).

## Grants/RPCs legadas — o segundo padrão recorrente

- `link_asaas_subscription()` (migration `0030`) — RPC criada com `grant execute to authenticated`; não validava se `p_subscription_id` correspondia a uma cobrança real no Asaas, só trocava `plan_id` direto. Qualquer usuário logado podia virar Premium sem pagar, chamando a RPC direto pelo `supabase.rpc()` no navegador. Corrigido: função passou a exigir `p_company_id` explícito e só `service_role` pode executá-la.
- Mesma classe de achado se repetiu na rodada de hardening do marketplace (migrations `0043`, `0049`, `0050`, `0051` — RPCs/grants expostas a `authenticated` que deveriam ser só `service_role`). Ver [[04-banco-e-supabase]] pra lista de migrations.

## Dependências / CVEs

- **CVE-2025-29927** (bypass de autorização em Middleware do Next.js, GHSA-f82v-jwr5-mffw) — corrigido atualizando `14.2.13` → `14.2.35` (§13). Impacto prático já era reduzido porque havia checagem independente em `layout.tsx`/`admin/page.tsx`.
- **postcss** desatualizado (XSS/leitura arbitrária via sourceMappingURL) — atualizado (§13). Risco real avaliado como baixo (só processa CSS do próprio projeto em build-time).
- **5 advisories HIGH residuais** (`next`, `postcss`, `glob` dev dependency) identificados em §31 — corrigidos na migração major Next 14→16 (§32, ver [[03-stack-e-infraestrutura]]): `npm audit` foi de 5 HIGH pra **0 vulnerabilidades**. `NÃO CONFIRMADO` se alguma advisory nova surgiu desde então — reconferir `npm audit` antes de assumir zero.

## Comparações sensíveis a timing

Webhook do Asaas (`src/app/api/webhooks/asaas/route.ts`) comparava o token secreto com `!==` — trocado por `crypto.timingSafeEqual` (§13).

## Headers HTTP / CSP (§28)

Adicionados em `next.config.mjs`, `headers()`, aplicados a `/:path*`: `Content-Security-Policy` (libera `'self'`, `*.supabase.co`, `*.sentry.io`; depois ganhou `wss://*.supabase.co` pro Realtime — §59), `Strict-Transport-Security` (2 anos, incluindo subdomínios), `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (bloqueia câmera/microfone/geolocalização). Confirmado nota **A** em securityheaders.com.

- **`unsafe-inline` em `script-src`** — necessário pro script anti-flash do tema (roda inline antes da página pintar, sem nonce). Único motivo da nota não ser A+. Endurecer com nonce é melhoria futura, não urgente (pendência viva — ver [[12-riscos-e-pendencias]]).
- **`'unsafe-eval'` em dev apenas** (§36) — Next usa `eval()` internamente em desenvolvimento (HMR); adicionado condicionalmente só quando `NODE_ENV !== "production"`, build real mantém CSP restrita.
- **Cookie de sessão sem `HttpOnly`** — avaliado como comportamento esperado, não falha: `@supabase/ssr` precisa que o cookie seja legível via `document.cookie` pra sincronizar sessão client/server. Mitigação real é CSP contra XSS, não `HttpOnly`.
- **`Access-Control-Allow-Origin: *` em `/login`** — comportamento padrão da Vercel pra páginas estáticas geradas no build, não configurável via `next.config.mjs`/`vercel.json` nesse cenário. Risco aceito: `/login` não tem cookie de sessão nem dado de usuário.

## Rate limiting

- **Login**: Supabase Auth (GoTrue) nativo, 30 tentativas/5min por IP, 360/hora. Falha de configuração real encontrada (§31): como o login passa por Server Action (roda na Vercel primeiro), sem "Enable IP address forwarding" habilitado no painel do Supabase, todas as tentativas eram contadas sob o IP da Vercel, misturando o balde de tentativas de todo mundo. Corrigido habilitando a opção no painel (config, não código). CAPTCHA (hCaptcha/Turnstile) fica como melhoria futura opcional, só se houver sinal de abuso real.
- **API pública e marketplace**: rate limit em camadas (global por consumidor + por visitante) — ver [[10-flags-e-variaveis]] pras variáveis (`PUBLIC_API_RATE_LIMIT_*`, `TOURSFLOW_RATE_LIMIT_*`, `TOURSFLOW_CLIENT_RATE_LIMIT_*`) e `src/lib/rate-limit.ts`.

## Validação de valor/quantidade de reserva (§31)

`createReservation`/`updateReservation` aceitavam `total_cents` negativo e `people_count` fracionário/zero sem checagem. Corrigido bloqueando valor negativo/não-numérico e quantidade que não seja inteiro ≥ 1 — **de propósito não trava contra `tours.base_price_cents`**, desconto/preço combinado é uso legítimo do negócio.

## Anti-abuso do trial (§63, ver também [[05-autenticacao-e-autorizacao]])

CNPJ/CPF virou obrigatório no cadastro; tabela `trial_history` (migration `0031`, sem FK/cascade com `companies` de propósito — sobrevive à exclusão da conta) guarda o documento de quem já ganhou o trial. `handle_new_user()` confere e nega novo trial pro mesmo documento. Evoluído depois (§72) pra anti-abuso por identidade (CPF/CNPJ + e-mail), migration `0045` — pepper próprio em tabela travada, ver [[10-flags-e-variaveis]].

## Multi-tenancy / Realtime

Isolamento entre empresas testado explicitamente contra vazamento via Realtime (§59): inserção/edição em tabela de outra empresa não aparece pra quem não deveria ver. Depende de `REPLICA IDENTITY FULL` (migration `0029`) pra RLS conseguir avaliar `UPDATE`/`DELETE` corretamente, e de `setAuth()` ser chamado explicitamente antes de assinar o canal (bug real encontrado: sem isso, o canal ficava autenticado só como `anon` e a RLS barrava tudo silenciosamente).

## Repositório público (ver [[03-stack-e-infraestrutura]])

Desde 2026-08-16 o repositório é público no GitHub (decisão consciente pra destravar deploy colaborativo grátis na Vercel). Segredos nunca estiveram versionados. Consequência: todo o código-fonte (regras de negócio, schema via migrations) é visível publicamente — não tratar o conteúdo do repo como confidencial.

## Pendências técnicas de segurança conhecidas

Ver [[12-riscos-e-pendencias]] pra lista completa e estado mais atual. Resumo das não-bloqueantes mais citadas: CSP sem nonce (`unsafe-inline`), 2FA sem tela de recuperação própria, impersonar empresa/CSV/indicador de churn no `/admin` (não implementados, baixa prioridade), TTL de `api_rate_limits`, rate limit global da API pública, rate limit de auth vs. botnet distribuída, caminho de falha na deduplicação do webhook Asaas, migrations históricas `0000b`/`0000c`/`0032`/`0033` (⚠️ nota: a numeração `0032`/`0033` mudou depois de uma renomeação — ver [[04-banco-e-supabase]] e [[11-decisoes-tecnicas]]).
