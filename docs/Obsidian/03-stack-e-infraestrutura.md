---
tags:
  - nauticflow
  - stack
updated: 2026-09-19
---
← [[00-INDEX]] · relacionado: [[02-arquitetura]] · [[14-arquivos-importantes]]

# Stack e infraestrutura

## Divergência importante: Next.js 14 vs 16

`README.md` e várias seções antigas de `DOCUMENTACAO.md` descrevem "Next.js 14". **Estado real confirmado no `package.json` do repositório**: `"next": "16.3.1"`, `react`/`react-dom` `^19.1.0`. Isso bate com `DOCUMENTACAO.md` seção 32 ("Migração major do Next.js 14 → 16", sessão 2026-08-17), que corrigiu 5 advisories HIGH do `npm audit` (`next@14.2.35` → `16.3.1`, `react`/`react-dom` `18.3.1` → `19.2.8`, `eslint` 8→9). `npm audit` foi de 5 HIGH pra 0 vulnerabilidades nessa migração.

**AGENTS.md do repo reforça isso**: instrui explicitamente que "esta versão do Next.js tem breaking changes" e manda ler `node_modules/next/dist/docs/` antes de codar — sinal de que o projeto está numa versão do Next mais recente que o conhecimento de treinamento padrão. Regra prática: **estado real do código (package.json) > texto antigo da documentação** — onde outro trecho deste vault citar "Next 14", é referência histórica de uma sessão anterior à migração, não o estado atual.

Breaking changes tratados na migração (seção 32): `cookies()`/`headers()` assíncronos, `params`/`searchParams` das páginas viraram `Promise` (corrigido via codemod oficial `next-async-request-api`, 16 páginas), `next lint` removido (script `lint` agora roda `eslint .` direto com `eslint.config.mjs` flat config), duas regras novas do ESLint relacionadas ao React Compiler. `middleware.ts` recebeu aviso de depreciação nessa mesma migração e foi renomeado depois (seção 38) — ver [[14-arquivos-importantes]].

## Stack confirmada (package.json + README)

**Front-end**: Next.js 16.3.1 (App Router, Server Components, Server Actions) · React 19.1 · TypeScript 5.6 · Tailwind CSS 3.4 · lucide-react.

**Back-end/dados**: Supabase (Postgres, Auth/GoTrue, PostgREST) · Row Level Security · triggers e funções PL/pgSQL · Supabase CLI `^2.114.0` como devDependency (instalado via `npm install supabase --save-dev` — CLI recusa instalação global via npm; ver seção 14 do DOCUMENTACAO.md).

**Infraestrutura/observabilidade**: Vercel (deploy) · `@sentry/nextjs ^10.69.0` (monitoramento de erros, DSN opcional — sem ela Sentry fica desabilitado) · `@vercel/analytics ^2.0.1` · Resend (e-mail transacional, incluindo uma Edge Function em Deno separada, `supabase/functions/send-reservation-voucher`, que **não** é deployada por `git push`/Vercel — precisa de `supabase functions deploy` manual) · Asaas (cobrança recorrente + Pix).

**Lint/build**: ESLint 9 + `eslint-config-next` 16.3.1 (flat config), `postcss ^8.5.26`, `autoprefixer`.

**Testes automatizados**: `NÃO CONFIRMADO` — nenhuma menção a Jest/Vitest/Playwright/Testing Library encontrada em `package.json` nem nas seções lidas de `DOCUMENTACAO.md`. Validação de mudanças, pelo padrão descrito em várias sessões, é manual: `tsc --noEmit` + `eslint .` + `next build` + smoke test de rotas (`curl -I`), às vezes scripts descartáveis via `npx tsx` contra mocks. Não há suíte de testes de regressão automatizada confirmada.

## Hospedagem — histórico (importante pra não repetir investigação)

Histórico completo de "quem hospeda `nauticflow.com.br`" está nas seções 19, 20 e 30 de `DOCUMENTACAO.md` — resumo:
1. Primeiro deploy (2026-08-14) foi manual via CLI (`nautic-flow/nauticflow`, projeto próprio do agente que fez o deploy, sem Git conectado por falta de permissão).
2. Descoberto que o domínio real estava atrás de OUTRO projeto Vercel (`Passatempo/fluxo náutico`, criado pelo usuário direto na interface).
3. **Correção posterior (seção 30)**: na verdade o projeto que serve produção é do workspace `joao's projects` → projeto `nauticflow`, de uma pessoa chamada João (conhecido do dono do produto, não é o dono). Workspace no plano Hobby (gratuito), que bloqueia qualquer deploy com mais de uma identidade envolvida (commits assinados por outro e-mail ficam "Blocked").
4. **Resolvido**: o dono do produto tornou o repositório `castrocompny/Nauticflow` **público** no GitHub — decisão consciente pra destravar deploy colaborativo de graça na Vercel, sem pagar plano Pro. Confirmado funcionando (`npx vercel --prod --scope joao-s-projecto1` e deploy automático via push). Nota de segurança: com repo público, todo código-fonte (regras de negócio, schema via migrations) é visível — segredos nunca estiveram versionados (só em env vars da Vercel), mas o conteúdo do repo deixou de ser tratado como confidencial.
5. DNS: domínio registrado via Registro.br/HostGator, mas nameservers reais apontam pro **Cloudflare** (na frente da Vercel) — checar sempre `whois`/`dig` antes de mexer em DNS, não assumir HostGator.

Estado de "quem é o dono/quem publica" pode ter mudado desde a sessão de 2026-08-16 — se for relevante, confirmar no painel Vercel atual antes de assumir. Ver também [[12-riscos-e-pendencias]].

## Ambiente de dev

`npm run dev`, porta 3000. Cuidado documentado (seção 7): VS Code às vezes mantém um segundo `npm run dev` rodando em paralelo (porta 3001+), causando 404 estranho — checar `netstat`/portas ocupadas se acontecer.

## Convenções operacionais (seção 9 do DOCUMENTACAO.md)

- `npx tsc --noEmit` antes de considerar qualquer mudança pronta.
- **Verificação de segurança antes de qualquer deploy** (regra permanente pedida pelo dono do produto): revisar controle de acesso, IDOR, exposição de secrets, superfícies de força bruta/DDoS — não basta passar em `tsc`/lint/build. Ver [[06-seguranca]].
- **Mudanças visuais/novas funcionalidades passam por branch de teste** antes de ir pra `main` (Vercel gera link de preview automático) — exceto correção de segurança urgente, que vai direto pra `main`.
