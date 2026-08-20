# NauticFlow — Documentação do Sistema

Documento de referência sobre o que o sistema é, como está construído e o que falta. Complementa o [README.md](README.md).

Este arquivo é versionado (`git ls-files` confirma) — pode editar e commitar normalmente.

---

## 1. Visão geral

NauticFlow é um SaaS de gestão para empresas de turismo náutico (escunas, lanchas, passeios de barco), vendido por assinatura mensal em 3 planos (Start R$147, Profissional R$297, Premium R$597). Cada empresa cadastrada é um tenant isolado via RLS no Supabase.

Fluxo central: **Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto/Voucher**.

## 2. Stack técnica

- Next.js 14 (App Router, Server Components, Server Actions) + React 18 + TypeScript
- Supabase: Postgres, Auth, PostgREST
- Tailwind CSS
- Sentry (monitoramento de erros)
- Resend (e-mail transacional: confirmação de cadastro via SMTP, voucher via Edge Function)
- Asaas (cobrança recorrente dos planos, ambiente de sandbox)

## 3. Autenticação e cadastro

- Cadastro pede: nome, empresa, cidade, CNPJ/CPF (opcional), e-mail, senha, aceite de Termos/Privacidade.
- Empresa + perfil + assinatura são criados por um gatilho no banco (`handle_new_user`, disparado por `on_auth_user_created` em `auth.users`) — não depende de nenhuma chamada autenticada subsequente.
- **Atenção**: esse gatilho já sumiu sozinho uma vez em produção (causa desconhecida, possivelmente alguma manutenção interna do Supabase no schema de auth). Se cadastros novos voltarem a ficar sem empresa, o primeiro passo é conferir `select tgname from pg_trigger where tgname = 'on_auth_user_created'` — se não existir, recriar (script em `supabase/migrations/0010_recria_gatilho_cadastro.sql`).
- Recuperação de senha: fluxo completo (`/login` → "Esqueci minha senha" → e-mail → `/auth/callback` → `/redefinir-senha`). Exige que as Redirect URLs no Supabase (Authentication → URL Configuration) incluam a URL do app (`http://localhost:3000/**` em dev).
- `super_admin`: papel especial (hoje só `castrocompny@gmail.com`) com acesso ao painel `/admin` e visibilidade de todas as empresas.

## 4. Cobrança (Asaas)

- Todo cadastro novo ganha **7 dias de teste grátis no plano Profissional** (`subscriptions.paid_until`).
- Quando vence, o app **não bloqueia tudo** — só as ações de **criar** (embarcação, cliente, saída, reserva, parceiro). Ver, editar, excluir, imprimir voucher/manifesto continuam funcionando. Isso é reforçado em cada Server Action de criação via `src/lib/subscription.ts` (`requireActiveSubscription`).
- Uma faixa amarela aparece no topo do app quando vencida, com um botão "Renovar plano" que leva pra `/planos`.
- `/planos`: página com os 3 planos, preço, features, e botão de pagar/renovar — cria cliente + assinatura recorrente no Asaas e redireciona pro checkout (Pix/boleto/cartão, quem escolhe é o pagador).
- Webhook (`/api/webhooks/asaas`) recebe a confirmação de pagamento e renova `paid_until` automaticamente — **só funciona com o site publicado num domínio real** (Asaas não alcança `localhost`). Testado localmente só até o ponto da criação da cobrança; a parte do webhook foi validada com uma chamada simulada (curl), mas nunca com um pagamento real do Asaas batendo nela.
- Painel `/admin` (só super_admin): lista todas as empresas, situação da assinatura, e um botão de renovar manualmente (com escolha de plano) — serve de reserva pra ajustes fora do fluxo automático (ex: PIX recebido fora do sistema).
- Variáveis de ambiente envolvidas: `ASAAS_API_KEY`, `ASAAS_API_URL`, `ASAAS_WEBHOOK_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` (usada só no webhook, nunca em código client-side).
- **Cuidado com `$` no `.env.local`**: o Next.js expande `$` como referência de variável. A chave do Asaas começa com `$` e precisou ser escapada como `\$aact_...` pra funcionar.

## 5. Modelo de dados (resumo)

Tabelas principais: `companies`, `profiles`, `subscriptions`, `plans`, `vessels`, `tours`, `clients`, `partners`, `departures`, `reservations`, `passengers`, `manifests`. Todas isoladas por `company_id` via RLS (exceto `plans`, pública).

Gatilhos de negócio no Postgres (não só na UI):
- `commercial_capacity` da embarcação = capacidade oficial − tripulação.
- Capacidade da saída não pode exceder a capacidade comercial, nem cair abaixo do já confirmado numa edição.
- Reserva confirmada trava a linha da saída (`FOR UPDATE`) antes de checar vagas — evita overselling em reservas simultâneas.
- Passageiro não pode passar do `people_count` da reserva.
- **Saída não pode ser criada no passado nem fora de 08:00–19:00 (horário de Brasília)** — `trg_departure_schedule` / `check_departure_schedule()`, migration `0014_horario_saida_no_banco.sql` (aplicada no Supabase). Só na criação (`before insert`); edições de saídas antigas continuam livres, de propósito. Ver seção 10 para o porquê dessa trava existir também no banco (e não só no app).

Segurança: `profiles` só permite UPDATE nas colunas `name`/`email` (via GRANT em nível de coluna) — evita que um usuário troque o próprio `company_id`/`role` via API direta e acesse dados de outra empresa.

## 6. Pendências conhecidas (lista do que fazer depois)

- 🔴 **ÚLTIMO PASSO ANTES DE VENDER DE VERDADE — trocar o Asaas de Sandbox pra produção** (sessão de 2026-08-18/19, checklist fechado em 2026-08-19): o sistema em produção (`nauticflow.com.br`) usa o **Sandbox do Asaas de propósito** — decisão consciente, pra testar todo o fluxo de pagamento sem cobrar ninguém de verdade antes de abrir pra clientes reais. Não é bug nem pendência de segurança, é a etapa de testes — e ela **já foi concluída com sucesso** (checkout, webhook e atualização de `paid_until` testados de ponta a ponta, ver seção 39). **Gatilho**: assim que o dono do produto avisar "vou lançar/vender de verdade agora", fazer os 2 passos abaixo — sem eles o sistema continua rodando em modo de teste, sem cobrar ninguém de verdade, mesmo com clientes reais se cadastrando:
  1. Trocar `ASAAS_API_URL`/`ASAAS_API_KEY` na Vercel pras credenciais de **produção** do Asaas (hoje marcadas "Sensitive", só o João consegue ver/editar) — a chave de sandbox tem prefixo `$aact_hmlg_`, a de produção `$aact_prod_` (ver seção 21).
  2. **Cadastrar o webhook de novo, mas na conta de produção do Asaas** — Sandbox e Produção são painéis/contas separados no Asaas (confirmado nesta sessão: a etiqueta "SANDBOX" no canto da tela é a pista visual de qual ambiente está aberto), então o webhook cadastrado hoje (seção 39) só vale pro Sandbox. Repetir os mesmos passos: gerar um token novo, sincronizar na Vercel (`ASAAS_WEBHOOK_TOKEN`) e cadastrar no painel de Produção com a URL `https://nauticflow.com.br/api/webhooks/asaas`.

  O `asaas_subscription_id` (`sub_klqdrpcxesksrn3c`) salvo na empresa do dono é de uma assinatura de teste, sem cobrança real associada.
- ~~Testar pagamento de ponta a ponta no Sandbox~~ / ~~Testar o webhook do Asaas com domínio real~~ — **resolvido** (ver seção 39). Webhook cadastrado no painel do Asaas, token novo gerado e sincronizado com a Vercel, pagamento de teste confirmado via "Ações de Sandbox" → "Confirmar pagamento", e o `paid_until` da empresa de teste atualizou sozinho.
- ~~Aplicar a migration `0019_valida_dono_fk_saidas.sql`~~ — **resolvido**, aplicada no Supabase pelo dono do produto.
- ~~Rate limiting no login~~ — **resolvido** (ver seção 31). CAPTCHA (hCaptcha/Turnstile) fica como melhoria futura opcional, só se houver sinal de abuso real (dá pra acompanhar em Authentication → Audit Logs no Supabase).
- ~~Validar valor/quantidade da reserva~~ — **resolvido** (ver seção 31). Bloqueia valor negativo/inválido e quantidade de passageiros inválida; não trava contra o preço base do passeio de propósito (desconto/preço combinado continua livre, é uso legítimo do negócio).
- ~~Migração major do Next.js~~ — **resolvido** (ver seção 32). `npm audit` zerado.
- ~~Renomear `middleware.ts` pra convenção `proxy`~~ — **resolvido** (ver seção 38). Rodado o codemod oficial, virou `src/proxy.ts`.
- ~~Deploy em produção depende do João aprovar cada um manualmente~~ — **resolvido**, repositório tornado público (ver seção 30). Deploy automático via GitHub volta a funcionar sozinho.
- ~~`headers().get("origin")` usado pra montar link de e-mail~~ — **resolvido** (ver seção 38). Trocado por `NEXT_PUBLIC_SITE_URL` fixa (`src/lib/site-url.ts`), já configurada na Vercel.
- ~~Projeto Vercel órfão~~ — **não existe** (conferido em 2026-08-19 pelo dono do produto, direto no painel da Vercel: só tem o projeto `nauticflow` no workspace `joao's projects`). A referência ao `nautic-flow/nauticflow` nas seções 19/20 ficou desatualizada — provavelmente aquele projeto (criado via CLI numa sessão anterior) já tinha sido apagado ou nunca existiu de fato como um projeto separado visível pro João.
- **2 advisories HIGH residuais no `npm audit`** (SSRF em rewrites com host controlado por env var interna, DoS em Server Components) só têm correção disponível na branch major do Next (15/16) — não fazem sentido pra esse app hoje (sem custom server, sem i18n, sem `images.remotePatterns`, sem WebSocket), mas vale reavaliar numa futura migração de major version do Next.js.
- ~~Linhas de tabela client-side demais~~ — **resolvido** (ver seção 29).
- ~~2FA pro super_admin~~ — **resolvido** (ver seção 33). TOTP nativo do Supabase Auth, obrigatório pra entrar em `/admin`.
- **Emissão de nota fiscal ainda é manual** (seção 16) — não há certificado digital nem provedor de NFS-e configurado. O registro em `/admin/[id]` é só controle, não gera nota nenhuma de verdade.
- **Chat de suporte online** — pedido do dono do produto (2026-08-14). Chegou a ser integrado com Tawk.to (widget no layout raiz) e depois **removido a pedido do dono do produto** (2026-08-15) — ver seção 22 pro motivo. Hoje o único contato de suporte é o link de WhatsApp no `OverdueBanner` (`src/app/(app)/overdue-banner.tsx`) de novo. Se for reconsiderar no futuro, dar preferência a um provedor com bot de IA gratuito de verdade (o AI Assist do Tawk.to é pago acima de 100 mensagens/mês), já que o dono do produto não quer ficar respondendo manualmente.
- **CSP sem nonce**: o `Content-Security-Policy` (ver seção 28) libera `'unsafe-inline'` em `script-src` por causa do script anti-flash do tema. Endurecer isso com nonce é melhoria futura, não urgente.
- ~~Deixar o sistema responsivo pra celular~~ — **resolvido** (ver seção 37). Menu retrátil, tabelas com scroll horizontal, e uma série de ajustes finos feitos a partir de prints reais do celular do dono do produto.
- **Melhorias futuras no `/admin`** (ver seção 33): impersonar empresa pra dar suporte, exportar lista de empresas em CSV, indicador de risco de churn. Não urgente com a base de clientes ainda pequena.
- ~~Landing: contato real~~ — **resolvido** (2026-08-20): `MKT_CONTACT` em `src/components/marketing/plans.ts` preenchido com WhatsApp `(65) 99240-7699` (`https://wa.me/5565992407699`) e e-mail `castrocompny@gmail.com`.
- **Landing: depoimentos** — seção de depoimentos **removida de propósito** (decisão de 2026-08-20): nada de depoimento falso num site comercial no ar. A landing mostra só garantias verificáveis (cartões de "Confiança e segurança"). Quando houver avaliações reais de clientes, reativar a seção com elas (ver seção 40).
- 🔴 **Aplicar a migration `0020_planos_anuais.sql` no Supabase** (planos anuais, ver seção 42) — sem ela, `subscriptions.billing_cycle` e `plans.price_cents_yearly` não existem e o fluxo anual não funciona (o toggle da landing aparece, mas o checkout/renovação anual quebra). Depois de aplicar, **testar o fluxo anual no Sandbox do Asaas**: assinar anual → checkout YEARLY → confirmar pagamento → conferir que o `paid_until` somou ~365 dias.
- Itens já resolvidos: índices de performance, sanitização de HTML no e-mail de voucher, monitoramento de erros via Sentry, **convidar colaborador / equipe** (tela `/equipe`, construída — ver seção 8), **dashboard e agenda reformulados** (ver seção 10), **migration `0014_horario_saida_no_banco.sql` aplicada no Supabase** (trava de horário de saída também no banco), **modo escuro** (ver seção 11), **gráficos no financeiro e botão de renovar condicional em `/planos`** (ver seção 11), **deduplicação de `auth.getUser()` e queries repetidas** (ver seção 12), **auditoria de segurança — IDOR entre empresas e dependências vulneráveis** (ver seção 13), **migration `0015` aplicada** (trava de IDOR também no banco), **Supabase CLI instalado no projeto** (ver seção 14), **painel /admin melhorado** (ver seção 15, migration `0016` aplicada), **controle manual de notas fiscais** (ver seção 16, migration `0017` aplicada), **gráficos/funil/onboarding travado/filtro por plano no /admin** (ver seção 17), **deploy em produção com domínio próprio no ar** (`nauticflow.com.br`, ver seções 19 e 20), **2 commits de segurança/admin/performance que estavam sem push finalmente publicados** (ver seção 20), **senha forte no cadastro/reset e botão de excluir conta** (ver seção 22), **domínio verificado no Resend** (ver seção 23), **bug de timezone (UTC vs Brasília) corrigido** (ver seção 24), **fluxo de "esqueci minha senha" corrigido de ponta a ponta** (ver seção 25), **falha crítica de escalação de privilégio no cadastro corrigida** (migration `0018`, ver seção 26), **favicon adicionado/ajustado** (ver seção 27), **varredura de segurança passiva e cabeçalhos HTTP de segurança (CSP/HSTS/X-Frame-Options/etc.)** (ver seção 28), **hidratação pesada das linhas de tabela corrigida** (ver seção 29).

## 7. Ambiente de desenvolvimento — cuidado com múltiplos servidores

Já aconteceu mais de uma vez nesta sessão: o VS Code reabre/mantém um terminal com `npm run dev` rodando por conta própria, competindo com o servidor iniciado via Claude Code. Quando isso acontece, o Next.js sobe uma segunda instância na porta **3001** (ou seguinte), e o navegador pode acabar apontando pra porta errada, gerando 404 estranho.

Se isso acontecer de novo: `netstat -ano | grep -E ":300[0-9] " | grep LISTENING` pra ver quais portas estão ocupadas, matar o processo extra, e garantir que só sobra uma instância (a que o Claude Code está gerenciando) na porta 3000.

## 8. Equipe (convidar colaboradores)

Construído nesta sessão. Fluxo:
- Tela `/equipe` lista quem tem acesso à empresa e (se for `company_admin`/`super_admin`) mostra um formulário de convite por e-mail.
- Convite usa `supabase.auth.admin.inviteUserByEmail` (precisa de `SUPABASE_SERVICE_ROLE_KEY`, client em `src/lib/supabase/admin.ts` — nunca usar esse client fora do servidor).
- O gatilho `handle_new_user` foi ajustado pra reconhecer `invited_to_company_id` nos metadados do convite e vincular o novo usuário à empresa que convidou, em vez de criar uma empresa nova (esse é o mesmo gatilho do cadastro normal — ver seção 3).
- Convidado aceita o convite e cai na tela `/redefinir-senha` (reaproveitada) pra definir a senha.
- Limite de usuários do plano é aplicado de verdade (mesmo padrão do limite de embarcações).
- Regras: só `company_admin`/`super_admin` convida; ninguém remove a si mesmo; não dá pra remover outro administrador (só "Operador"). Remover de fato deleta a conta (`auth.admin.deleteUser`, cascade apaga o profile).

## 9. Convenções

- Migrations em `supabase/migrations/` **não rodam sozinhas** — cada uma precisa ser colada manualmente no SQL Editor do Supabase, na ordem numérica. Isso muda assim que o CLI estiver logado/linkado (ver seção 14) — depois disso dá pra usar `npx supabase db push`.
- `npx tsc --noEmit` antes de considerar qualquer mudança de código pronta.
- Servidor de dev: `npm run dev`, porta 3000.
- **Verificação de segurança antes de qualquer deploy** (regra permanente, pedida pelo dono do produto em 2026-08-18 — vale pra qualquer pessoa/IA trabalhando neste repositório, incluindo sessões de outros colaboradores): antes de enviar (`git push`) qualquer mudança que vá gerar deploy em produção, não basta rodar `tsc`/`lint`/`build` funcionalmente — revisar também com foco em segurança: controle de acesso (checagem de auth/role não foi removida/reordenada), IDOR (toda referência a outra tabela valida `company_id`), exposição de secrets/dados, e qualquer coisa que abra brecha pra força bruta, DDoS ou outro tipo de ataque. Ferramentas automáticas (codemods, `npm audit fix`, etc.) também precisam ser revisadas manualmente depois — passar no build não significa estar seguro. Ver auditoria completa de referência na seção 31, e a migração do Next.js na seção 32 como exemplo de mudança grande que foi conferida com esse cuidado (revisão manual das páginas que o codemod alterou, focando nas checagens de permissão).
- **Mudanças visuais/novas funcionalidades passam por uma branch de teste antes de ir pro site real** (regra permanente, pedida pelo dono do produto em 2026-08-18): em vez de enviar direto pra `main` (que dispara deploy em `nauticflow.com.br`), a mudança vai primeiro pra uma branch separada (ex: `git checkout -b testes`, `git push origin testes`). A Vercel gera sozinha um link de preview (`nauticflow-git-testes-....vercel.app`) — um site de verdade, no ar, mas separado do domínio principal. O dono do produto testa nesse link e só depois de aprovar é que a branch é mesclada (`merge`) na `main`, indo pro site real. **Exceção**: correção de segurança urgente continua indo direto pra `main`, sem passar por preview — esperar aprovação nesses casos é mais arriscado que testar depois.

## 10. Dashboard, Agenda e regras de horário (sessão de 2026-08-10)

Reformulação do dashboard e correções de sincronização entre Saídas → Reservas → Agenda.

### Dashboard (`src/app/(app)/dashboard/`)

- **Novas seções**, usando dados que já existiam no banco mas não apareciam em lugar nenhum (`vessels`, `tours`, `partners`):
  - Ranking por embarcação (receita + ocupação média do período).
  - Ranking de passeios mais vendidos.
  - Origem das reservas (parceiro vs. venda direta).
  - Ticket médio, taxa de cancelamento/pendência, novos vs. clientes recorrentes.
  - Alerta de saídas dos próximos 7 dias com ocupação abaixo de 50%.
  - Filtro de período (7d/30d/90d/mês atual) controlando gráficos e rankings, no padrão já usado em `/relatorios` e `/financeiro` (`?p=`).
  - Linha de média no `BarsChart` (`bars-chart.tsx`).
- **Reorganização de layout**: seção "Desempenho do período" subiu pra logo depois dos KPIs do dia; "Próximas saídas" e "Agenda de hoje" (que mostravam a mesma informação de formas diferentes) viraram só "Agenda de hoje", já que ela cobre tudo que a outra mostrava.
- KPIs fixos do topo (Reservas hoje, Receita do mês, Ocupação hoje, Clientes, Passageiros hoje) **não foram tocados** — continuam com a mesma lógica de antes.

### Bug: Agenda escondendo saídas fora de 08:00–18:00

`/agenda` e o card "Agenda de hoje" desenhavam só as horas de 08:00 às 18:00 (faixa fixa no código). Uma saída fora dessa janela existia no banco e tinha reservas, mas nunca aparecia — dava a impressão de "reserva sumiu". Corrigido calculando a faixa de horas dinamicamente a partir dos dados reais, depois travada em 08:00–19:00 (ver regra de negócio abaixo).

### Regra de negócio: saída só entre 08:00–19:00, nunca no passado

Pedido explícito do dono do produto. Aplicada em duas camadas:

1. **App** (`saidas/actions.ts`, `reservas/actions.ts`): `createDeparture`/`updateDeparture` recusam horário fora de 08:00–19:00 e (só na criação) recusam `departs_at` no passado. `reservas/page.tsx` filtra o dropdown de "Saída" ao criar reserva pra só listar saídas dentro da janela; `createReservation` confere de novo no servidor. Edição de reservas/saídas já existentes continua sem essa trava, pra não travar correção de dados antigos.
2. **Banco** (`supabase/migrations/0014_horario_saida_no_banco.sql`, **aplicada no Supabase**): mesma regra via gatilho Postgres (`trg_departure_schedule`), só em `insert`. Existe porque a checagem do app usa o relógio da máquina que roda o Next.js — em dev local isso é o computador de quem testa (dá pra burlar mudando a hora do sistema operacional); em produção seria a máquina da hospedagem, fora do alcance do usuário, mas o gatilho no banco fecha a brecha por completo, inclusive contra chamadas diretas à API do Supabase.

### Consistência de cache

`createReservation`, `updateReservation`, `deleteReservation`, `updateReservationStatus`, `createDeparture`, `updateDeparture` e as mudanças de status de saída não invalidavam `/agenda` (só `/reservas`, `/saidas`, `/dashboard`). Adicionado `revalidatePath("/agenda")` em todas.

## 11. Modo escuro, Financeiro e Planos (sessão de 2026-08-10)

### Modo escuro

App inteiro ganhou tema claro/escuro via classe `.dark` no `<html>` (Tailwind `darkMode: "class"`).

- **Tokens de cor** (`tailwind.config.ts` + `src/app/globals.css`): em vez de cores fixas (`bg-white`, `text-slate-900` etc.), os componentes usam tokens semânticos — `bg-app`, `bg-surface`, `bg-surfaceHover`, `text-heading`, `text-body`, `text-muted`, `border-line`. Cada token é uma CSS custom property com um valor em `:root` (claro) e outro em `.dark` (escuro). `bg-surfaceHover` precisou de um formato especial (`rgb(var(--bg-surface-hover-rgb) / <alpha-value>)`, com a variável guardando um triplet RGB tipo `30 33 40`) porque o Tailwind não consegue aplicar modificador de opacidade (`/60` etc.) direto em cima de um `var()` comum.
- **Sem "flash" de tela clara antes de escurecer**: um script inline em `src/app/layout.tsx` (via `next/script`, `strategy="beforeInteractive"`) lê `localStorage.theme` (ou a preferência do sistema operacional, se nunca escolheu) e aplica a classe `.dark` **antes** da página pintar.
- **Alternador**: `src/components/theme-toggle.tsx`, um botão (ícone sol/lua) na topbar que troca a classe e salva a escolha em `localStorage`.
- **Elementos com cor sempre fixa (não seguem o tema)**: o fundo branco atrás do ícone do barco na logo (`src/components/logo.tsx`) e o mesmo ícone repetido no cabeçalho do voucher (`src/app/voucher/[id]/page.tsx`) continuam `bg-white` fixo em qualquer tema — o barco tem casco escuro e fica invisível num fundo escuro.
- Vários links que pareciam texto solto (Voucher/Passageiros em `reservas/reservation-row.tsx`, Manifesto em `saidas/departure-row.tsx` e `saidas/[id]/page.tsx`) ganharam aparência de botão (borda + fundo no hover) pra ficar claro que são clicáveis, em ambos os temas.

### Financeiro (`src/app/(app)/financeiro/page.tsx`)

Adicionados dois gráficos, reaproveitando o componente `BarsChart` já criado pro dashboard:
- **Receita ao longo do tempo**: por dia (visão "mês") ou por mês (visão "ano"), conforme o filtro `?p=` já existente na página.
- **Receita por embarcação**: ranking horizontal (barras de progresso) das embarcações que mais faturaram no período, mesmo padrão visual usado em `/relatorios`.

### Planos (`src/app/(app)/planos/page.tsx`)

O card do plano atual só mostra o botão "Renovar plano" quando faltam **7 dias ou menos** pra vencer (`DIAS_PARA_AVISAR_VENCIMENTO`) ou quando já venceu; fora essa janela, mostra só "Ativo até [data]" — antes disso, o botão de renovar aparecia sempre, mesmo logo depois de um pagamento confirmado, confundindo o cliente.

## 12. Otimização de performance — atraso ao clicar em botões (sessão de 2026-08-10)

Causa raiz principal: `supabase.auth.getUser()` **não é um check local** — é uma chamada de rede real pra API de Auth do Supabase, pra validar o token direto no servidor deles (é o jeito certo/seguro de fazer, `getSession()` sozinho não valida). O problema era a quantidade de vezes que isso rodava **na mesma requisição**:

1. `src/lib/supabase/middleware.ts` chama uma vez, em toda navegação e toda Server Action (não dá pra tirar essa, é a validação de sessão de verdade).
2. `src/app/(app)/layout.tsx` chamava de novo, com sua própria query em `profiles`.
3. Cada `page.tsx` que usa `getProfile()` (`src/lib/profile.ts`) chamava uma terceira vez.

Resultado: até 3 idas e voltas até o Supabase Auth, mais 2 queries repetidas em `profiles`, só pra saber quem tá logado — em toda navegação e em vários cliques.

**Corrigido:**
- `src/lib/profile.ts`: `getProfile()` agora usa `cache()` do React (memoização por requisição, o padrão recomendado do Next.js App Router pra isso). Chamadas repetidas de `getProfile()` na mesma requisição (layout + page, por exemplo) reaproveitam o mesmo resultado em vez de bater no banco de novo. De quebra, o select passou a trazer `companies(name, city)` junto.
- `src/app/(app)/layout.tsx`: trocou sua checagem de auth + query de profile própria por `getProfile()` — elimina 1 chamada de auth e 1 query por navegação.
- `src/app/(app)/configuracoes/page.tsx`: mesma troca (usava `auth.getUser()` direto).
- `src/lib/subscription.ts`: nova função `getSubscriptionStatus()` busca `paid_until` **e** os limites do plano (`max_vessels`, `max_users`) numa única query — `requireActiveSubscription()` continua existindo (agora só chama essa por baixo) pra não quebrar quem só precisa do bloqueio simples.
- `src/app/(app)/embarcacoes/actions.ts` (`createVessel`) e `src/app/(app)/equipe/actions.ts` (`inviteTeamMember`): paravam de fazer duas queries seguidas em `subscriptions` (uma pra checar vencimento, outra pra pegar o limite do plano) — agora é uma só, via `getSubscriptionStatus()`.
- `src/app/(app)/billing-actions.ts` (`startAsaasCheckout`): a busca da empresa e a busca do plano eram sequenciais mas independentes — viraram `Promise.all`.

### Causa principal do atraso especificamente no menu lateral

`src/app/(app)/layout.tsx` tinha `export const dynamic = "force-dynamic"` e `export const revalidate = 0`. Isso não só forçava renderização por requisição (isso já acontecia de qualquer forma, por causa do `cookies()` usado no `createClient()`/`getProfile()`) — **também desligava o cache de navegação do lado do cliente** que o Next.js usa por padrão (~30s) pra rotas dinâmicas já visitadas. Resultado: **todo clique no menu lateral**, mesmo entre páginas abertas segundos antes, refazia a checagem de auth inteira + as 5 queries do layout (assinatura, contagem de embarcações, reservas do mês, saídas de hoje, notificações) do zero no servidor. Esse era o principal motivo do "menu lateral lento" — mais direto que a duplicação de `auth.getUser()` da seção acima.

Removidas as duas linhas. Pra não reintroduzir o bug que elas existiam pra evitar (sidebar mostrando plano/vencimento desatualizado logo após uma renovação), a invalidação virou cirúrgica: `revalidatePath("/dashboard", "layout")` foi adicionado nos dois únicos lugares que alteram `subscriptions.paid_until` — `src/app/api/webhooks/asaas/route.ts` (confirmação de pagamento) e `src/app/admin/actions.ts` (`renewSubscription`, renovação manual pelo super_admin). Fora desses dois pontos, a navegação agora reaproveita o cache padrão do Next.js.

**Reforço, na sequência (usuário relatou que o menu ainda estava "atrasado" depois da correção acima):**
- `next.config.mjs`: adicionado `experimental.staleTimes.dynamic = 30` — o Next 14 não reaproveita automaticamente páginas dinâmicas já visitadas no cache do navegador a não ser que isso seja configurado explicitamente; sem essa opção, remover o `force-dynamic` do layout sozinho não gerava cache nenhum de navegação. Agora, clicar de novo numa página vista há menos de 30s é instantâneo (sem ida ao servidor).
- `src/app/(app)/loading.tsx` (novo): esqueleto genérico que o Next.js mostra **na hora** assim que o link é clicado, enquanto a página de destino ainda busca dados no servidor. Sidebar/Topbar continuam visíveis (fazem parte do layout, não trocam). Isso ataca a sensação de "clique sem resposta" mesmo quando a navegação em si ainda leva uma fração de segundo — sem `loading.tsx`, a tela ficava parada até tudo pronto, o que parece trava mesmo sendo rápido.

**Se ainda estiver lento depois disso**, o próximo suspeito é o ambiente de teste: tudo acima melhora produção (`npm run build && npm run start`) de verdade, mas em **`npm run dev`** o Next.js compila cada rota sob demanda na primeira visita da sessão (alguns segundos, normal, não é bug) — só fica rápido de fato depois de "aquecida". Vale testar com build de produção pra ver o ganho real.

**Não mexido nesta passada** (ver seção 6, pendências): a hidratação pesada dos Client Components de linha de tabela (`departure-row.tsx` e afins). Essa é sobre tempo até a página ficar clicável depois de carregar, não sobre a latência de rede por clique — impacto real, mas escopo maior, fica pra próxima.

## 13. Auditoria de segurança (sessão de 2026-08-10)

Auditoria completa a pedido do dono do produto: reconhecimento, análise estática de todo o código + migrations SQL, `npm audit`, e verificação de cada achado por rastreamento manual de fluxo de dados (sem testes de intrusão ao vivo contra a instância de produção — sem credenciais de teste pra isso).

**Avaliação geral**: a base tem RLS habilitado em toda tabela sensível, `security definer` usado corretamente em `current_company_id()`/`is_super_admin()` (com `set search_path` fixo, evitando hijacking), `profiles` com GRANT restrito por coluna (impede troca de `company_id` via API direta), painel `/admin` com checagem dupla (app + RLS). O achado real foi uma classe de IDOR bem específica, não uma falha estrutural ampla.

### Corrigidas

- **IDOR entre empresas em `reservations` e `passengers` (ALTA)** — `createReservation`, `updateReservation` (`reservas/actions.ts`) e `addPassenger` (`reservas/[id]/passenger-actions.ts`) inseriam/atualizavam `departure_id`, `client_id` e `reservation_id` vindos direto do formulário, sem checar se esses IDs pertenciam à própria empresa do usuário logado. A política de RLS só validava a linha nova (`company_id = current_company_id()`), nunca a empresa dona da referência estrangeira. Um usuário autenticado de qualquer empresa (cadastro é auto-serviço, sem aprovação) que soubesse o UUID de uma saída/reserva de outra empresa — por exemplo, o próprio UUID que aparece na URL do voucher enviado por e-mail ao cliente — podia grudar uma reserva ou um passageiro fantasma nela, corrompendo a contagem de vagas/passageiros da vítima sem aparecer no painel dela (RLS esconde, já que a linha nova tem o `company_id` do atacante). Corrigido em duas camadas: validação explícita no app (compara o `company_id` do registro referenciado antes do insert/update) e um gatilho novo no banco, `supabase/migrations/0015_valida_dono_das_fks.sql` (**aplicada no Supabase**).
- **Next.js desatualizado, incluindo CVE crítica de bypass de autorização em Middleware (CVE-2025-29927 / GHSA-f82v-jwr5-mffw)** — estava em `14.2.13`, atualizado pra `14.2.35` (última da série 14.2, sem breaking change). O middleware de auth (`src/middleware.ts`) já tinha uma segunda camada independente de verificação em `layout.tsx`/`admin/page.tsx`, então o impacto prático dessa CVE específica já era reduzido — mas não é motivo pra deixar sem corrigir uma CVE crítica com correção de graça disponível. `eslint-config-next` atualizado junto pra manter consistência de versão.
- **`postcss` desatualizado (XSS/leitura arbitrária de arquivo via sourceMappingURL)** — atualizado de `8.5.19` pra `^8.5.26`. Risco real era baixo (só processa CSS do próprio projeto em build-time, nenhum input de usuário chega nele), mas a correção é de graça.
- **Comparação não timing-safe do token do webhook Asaas** — `src/app/api/webhooks/asaas/route.ts` usava `!==` pra comparar o token secreto contra o header recebido. Trocado por `crypto.timingSafeEqual`. Risco prático era baixo (exige posição de rede muito precisa pra explorar), mas é uma correção de uma função.
- **Migration `0015_valida_dono_das_fks.sql` aplicada no Supabase** — o gatilho de banco que reforça a checagem de IDOR (achado acima) já está ativo, não só no app.

### Não corrigidas (documentadas como pendência, ver seção 6)

- ~~`headers().get("origin")` usado pra montar link de e-mail de reset de senha/convite~~ — verifiquei e não é explorável hoje (Server Actions do Next.js validam Origin contra Host antes do código rodar), mas é uma dependência frágil de comportamento de framework pra algo sensível. Não troquei por uma URL fixa porque isso precisa de uma `NEXT_PUBLIC_SITE_URL` configurada em produção, e não quis arriscar quebrar o fluxo de e-mail sem confirmar o domínio final com o dono do produto. **Resolvido em 2026-08-19, ver seção 38.**
- **2 advisories HIGH residuais no `npm audit`** — só têm correção na branch major 15/16 do Next.js. Confirmei que os cenários que elas descrevem (custom server, i18n, `images.remotePatterns`, WebSocket) não se aplicam a este app hoje.

### O que NÃO foi encontrado (verificado e descartado)

Pra não dar a impressão de que a análise foi rasa: também foram checados e descartados como não-vulneráveis — SQL injection (o projeto usa só o query builder do Supabase-js, nenhuma concatenação de SQL cru), XSS via `dangerouslySetInnerHTML` (nenhum uso no código), secrets vazando pro bundle do cliente (nenhuma env var sensível com prefixo `NEXT_PUBLIC_`), uploads de arquivo (funcionalidade não existe no app), a RPC `link_asaas_subscription` (deriva a empresa via `current_company_id()`, não aceita `company_id` do chamador), e o `client_id` sendo usado como vetor de leitura cross-tenant (RLS na tabela `clients` bloqueia a leitura mesmo que o vínculo exista).

## 14. Supabase CLI instalado (sessão de 2026-08-12)

Instalado a pedido do dono do produto, pra poder aplicar migrations sem depender de colar manualmente no SQL Editor.

- **Como foi instalado**: como devDependency do projeto (`npm install supabase --save-dev`), não como binário solto no sistema — é o jeito oficialmente suportado pra projetos npm (o CLI recusa instalação global via `npm install -g`). Uso: `npx supabase <comando>`.
- Tentei primeiro baixar o binário standalone direto (`.tar.gz` da release do GitHub) pra deixar disponível globalmente também, mas o download travou/ficou muito lento nesse ambiente — abortado. A via npm funcionou de primeira.
- `npx supabase init` já foi rodado — criou `supabase/config.toml` e `supabase/.gitignore` (ignora `supabase/.temp` e `.branches`, gerados localmente pelo CLI).
- **Falta login + link, e isso só quem tem a conta consegue fazer** (não é algo que eu possa fazer por vocês — exige autenticação no navegador com a conta Supabase):
  1. `npx supabase login` (abre o navegador pra autorizar)
  2. `npx supabase link --project-ref gggpihphjjxndpfntnvm` (ref extraído de `NEXT_PUBLIC_SUPABASE_URL` no `.env.local`)
- Depois disso, migrations pendentes (`0015_valida_dono_das_fks.sql` inclusive) podem ser aplicadas com `npx supabase db push`, em vez de colar manualmente no SQL Editor.

## 15. Painel /admin melhorado (sessão de 2026-08-12)

Reformulação completa a pedido do dono do produto — o painel do super admin era só uma tabela com botão de renovar. Migration nova: `supabase/migrations/0016_admin_panel_melhorias.sql` (**aplicada no Supabase**).

### `/admin` (listagem)
- **Métricas no topo**: total de empresas, MRR (soma do preço do plano das empresas pagando de verdade — trial não conta), quantas pagando, quantas em trial, vencidas, suspensas, e novas no mês.
- **Busca** por nome/CNPJ (`?q=`) e **paginação** (`?page=`, 20 por página) — antes buscava e listava todas as empresas sem limite.
- **Ordenação por urgência**: suspensas primeiro, depois vencidas, depois "vence em até 3 dias", só depois o resto por data de cadastro.
- **Alerta de "vence em breve"**: antes só existia "vencida" ou "paga até X"; agora mostra `Vence em Nd (data)` quando faltam ≤3 dias, badge amarelo.
- Nota de implementação: a página busca **todas** as empresas e faz filtro/ordenação/paginação em memória (JS), não no banco — decisão deliberada dado que hoje é 1 usuário (você) olhando poucas dezenas de empresas. Se a base crescer bastante, isso precisa virar uma query paginada de verdade no Supabase.

### `/admin/[id]` (novo — detalhe da empresa)
- Dados da empresa (nome, CNPJ, cidade, telefone, e-mail, cliente Asaas) com formulário de edição de CNPJ/cidade.
- Uso do plano: embarcações e usuários usados vs. limite do plano (reaproveita o componente `OccupancyBar` que já existia pro app principal).
- Histórico completo de assinaturas da empresa (toda vez que mudou de plano/renovou), com origem (Asaas vs. trial/manual).
- Botão de trocar plano **sem** mexer na data de vencimento (`changePlan`), separado do "renovar +30 dias" (`renewSubscription`) que já existia.
- **Suspensão manual** (`suspendCompany`/`unsuspendCompany`): bloqueia cadastro de coisa nova imediatamente, independente da assinatura estar em dia. Novo campo `companies.suspended_at`/`suspended_reason`. Reaproveita o mesmo mecanismo de bloqueio que já existia pra "assinatura vencida" (`src/lib/subscription.ts`, `getSubscriptionStatus`) e o mesmo banner (`overdue-banner.tsx`, agora com uma variante vermelha "Conta suspensa" em vez de amarela "Assinatura vencida").
- Log de auditoria da empresa (últimas 30 ações).

### Log de auditoria (`admin_audit_log`, novo)
Toda ação administrativa sensível (renovar, trocar plano, suspender/reativar, editar dados) grava quem fez, quando, em qual empresa e com quais detalhes — antes disso não existia nenhum rastro de ações do super admin. RLS restringe leitura e escrita a `is_super_admin()`, e a escrita só aceita `admin_id = auth.uid()` (não dá pra forjar um log em nome de outro admin).

### RLS nova pro super admin
Antes, o super admin só tinha SELECT em `companies`/`subscriptions` (RLS da migration 0007) — não dava pra atualizar empresa (suspender, editar CNPJ) nem ver embarcações/usuários de outra empresa (necessário pra mostrar uso vs. limite). Adicionado: UPDATE em `companies`, SELECT em `vessels` e `profiles`, todos gated por `is_super_admin()`.

### Não implementado nesta passada
- **2FA pro super_admin** — sugerido na auditoria de segurança (seção 13) e reconfirmado aqui. Não implementei porque é uma feature de segurança grande o suficiente (fluxo de enrollment com QR code, tela de desafio no login, obrigatoriedade pra essa role especificamente) que merece uma passada própria, testada de verdade — não quis fazer isso "de brinde" dentro de uma tarefa maior sem poder validar visualmente.

## 16. Controle de notas fiscais (sessão de 2026-08-12)

**Importante: isto NÃO emite nota fiscal de verdade.** Perguntei antes de implementar (nota fiscal é assunto regulado, não dá pra chutar) e a resposta foi: nota fiscal da **assinatura do SaaS** (não das reservas de cada empresa), e ainda não existe certificado digital nem provedor de NFS-e configurado. Então isto é um **registro de controle manual** — o super admin emite a nota por fora (prefeitura/contador) e anota aqui número, valor, link do PDF e data, só pra não perder o controle de quais meses já foram faturados.

Migration nova: `supabase/migrations/0017_notas_fiscais.sql` (**aplicada no Supabase**). Cria a tabela `invoices` (company_id, number, amount_cents, pdf_url, issued_at, notes, created_by).

- **`/admin/[id]`**: card "Notas fiscais" com formulário de registro (`registerInvoice`) e lista das notas já registradas, com exclusão (`deleteInvoice`) pra corrigir erro de digitação. Toda ação vai pro log de auditoria (seção 15).
- **`/configuracoes`**: a própria empresa vê (só leitura) o histórico das próprias notas — quem registra é sempre o super admin, a empresa não cria/edita.
- RLS: `is_super_admin()` pra tudo (criar/editar/excluir), e `company_id = current_company_id()` só-leitura pra empresa ver as próprias.
- `DeleteButton` (`src/components/delete-button.tsx`) ganhou um prop opcional `extraFields` — precisava mandar `company_id` junto do `id` pra revalidar o cache certo, e o componente só suportava `id` sozinho antes.

**Quando integrar emissão de verdade**: se um dia configurarem um provedor (Asaas tem API de NFS-e vinculada a pagamento, ou serviços dedicados tipo NFe.io/Focus NFe/eNotas), a tabela `invoices` já dá a base — trocaria só o formulário manual por uma chamada de API que preenche os mesmos campos automaticamente.

## 17. Gráficos, funil, distribuição por plano e onboarding travado no /admin (sessão de 2026-08-12)

Sem migration nova — tudo construído em cima do que já existia (a RLS de `vessels` pro super admin já tinha sido criada na migration 0016).

- **`src/app/admin/charts.tsx`** (novo): 3 componentes de gráfico, todos Server Components (zero JS extra no bundle — `/admin` cresceu só 1.5kB com tudo isso). Usam uma única cor (`bg-brand`) em vez de paleta categórica — a identidade de cada barra vem do rótulo de texto ao lado, não da cor, então não precisou validar contraste/CVD pra isso (consultei a skill de dataviz do projeto antes de implementar).
  - `NewCompaniesChart`: empresas novas por mês, últimos 12 meses, barras verticais com valor direto acima (sem tooltip — poucos pontos, não precisa).
  - `FunnelChart`: Total de cadastros → já converteu (pagou via Asaas alguma vez, aproximado por `asaas_subscription_id is not null`) → pagando agora. Mesma cor em todas as barras de propósito — são o mesmo grupo de empresas afunilando, não categorias diferentes.
  - `PlanDistributionChart`: quantas empresas em cada plano (Start/Profissional/Premium/sem plano), barras horizontais.
- **Onboarding travado**: empresa cadastrada há mais de 7 dias (`ONBOARDING_TRAVADO_DIAS`) e com zero embarcações cadastradas. Aparece como métrica no topo e como ícone de alerta ao lado do nome da empresa na lista. É um proxy simples (só embarcações, não checa reservas) — decisão deliberada pra não precisar de mais uma RLS nova (`vessels` já era visível ao super admin; `reservations` não).
- **Filtro por plano**: dropdown novo ao lado da busca (`?plano=<code>`), filtra a lista pelo plano atual da empresa.

## 18. Validação final antes do commit (sessão de 2026-08-12)

Antes de commitar o lote inteiro de mudanças desta sessão (seções 10-17), rodei uma checagem completa pra garantir que não tinha nada quebrado. Sem login/credenciais de teste no ambiente, então isto **não substitui teste manual na interface** — cobre tudo que dá pra verificar sem uma conta autenticada.

- **Estático**: `tsc --noEmit`, `next lint` e `next build` completos, todos limpos (só os 2 warnings pré-existentes de `<img>` sem `next/image`, sem relação com o que mudou).
- **Runtime**: subiu o servidor em modo produção (`next start`) e bateu em todas as rotas — públicas retornam 200, protegidas redirecionam 307 pro login (nenhum 500/crash em lugar nenhum). Testado também o webhook do Asaas direto (sem token e com token errado): responde 401 nos dois casos sem lançar exceção, confirmando que a troca pra `crypto.timingSafeEqual` (seção 13) não quebrou a checagem.
- **Revisão de lógica** (além de compilar) nos pontos de maior risco: `admin/actions.ts` (as 7 actions, discriminated union de auth), `reservas/actions.ts` + `passenger-actions.ts` (validação de IDOR), `layout.tsx` + `subscription.ts` (suspensão sempre tem prioridade sobre vencida, sem sobreposição), `admin/page.tsx` + `charts.tsx` (funil sempre monotônico — Total ≥ Converteu ≥ Pagando —, gráficos protegidos contra divisão por zero).
- `npm audit`: sem novidade, só os 2 advisories residuais já documentados na seção 6 (postcss interno do Next.js, sem caminho de input não confiável nesse app).

**Não coberto por essa validação**: cliques reais na UI autenticada (dashboard, reservas, `/admin` etc.) — decisão do dono do produto de não criar conta de teste na Supabase de produção pra isso. Recomendo passar pelas telas principais manualmente depois do commit, em especial as que tiveram a validação de IDOR adicionada (Reservas, Passageiros) e o `/admin` novo.

## 19. Primeiro deploy em produção — Vercel (sessão de 2026-08-14)

O app foi ao ar pela primeira vez. Domínio próprio (`.com.br`) já comprado na HostGator, mas **ainda não conectado** — o deploy está rodando no subdomínio gratuito da Vercel por enquanto, o que já é uma URL pública e funcional (não é obrigatório ter domínio próprio pra operar).

- **URL de produção**: https://nauticflow.vercel.app
- Projeto Vercel: `nautic-flow/nauticflow` (criado via CLI, `npx vercel link --project nauticflow`)
- Login no CLI feito via device flow (`npx vercel login`, código de autorização confirmado pelo navegador) — não precisou de senha compartilhada.
- **Conexão automática com o GitHub falhou**: a conta Vercel usada não tem permissão de admin/escrita no repositório `castrocompny/Nauticflow`. Por enquanto o deploy é manual (`npx vercel deploy --prod`) a partir do código local — não re-deploya sozinho a cada `git push`. Pra resolver: conectar o repositório pela própria interface da Vercel (Project Settings → Git), autorizando o GitHub App da Vercel a acessar esse repositório.
- **Variáveis de ambiente**: todas as 7 do `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `ASAAS_API_KEY`, `ASAAS_API_URL`, `ASAAS_WEBHOOK_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) foram enviadas pra Vercel via `vercel env add` (ambientes Production e Preview), lendo os valores direto do `.env.local` local sem nunca aparecerem no texto do chat. `.gitignore` ganhou `.vercel` e `.env*` automaticamente (feito pelo próprio `vercel link`).
- Smoke test pós-deploy: `/` e `/dashboard` redirecionam 307 pro login (correto, sem sessão), `/login` e `/termos` respondem 200 com conteúdo real renderizado — confirma que as env vars do Supabase estão corretas em produção.

### Pendências decorrentes do deploy (ver seção 6 também)

- ~~Atualizar Redirect URLs no Supabase~~ / ~~Atualizar webhook do Asaas~~ / ~~Conectar domínio da HostGator~~ — ver seção 20, a história completa mudou bastante desde que isto foi escrito (domínio conectado, mas a um projeto Vercel diferente do que está descrito acima).

## 20. Domínio em produção, dois projetos Vercel, e um commit que nunca tinha ido pro ar (sessão de 2026-08-14/15)

Continuação direta da seção 19. Resumo do que rolou, na ordem que aconteceu — importante entender pra não se perder, porque teve uma reviravolta grande no meio.

### Existem DOIS projetos Vercel agora — só um deles importa

- `nautic-flow/nauticflow` — o que **eu** criei via CLI (seção 19). URL: `nauticflow.vercel.app`. Continua existindo e funcionando, mas **não é mais o que serve o domínio real**. Candidato a ser apagado depois, pra não confundir (não apaguei ainda, decisão de vocês).
- `Passatempo/fluxo náutico` (nome interno do projeto: `nauticflow`) — criado pelo **usuário direto pela interface da Vercel**, importando o repositório do GitHub. Esse **já veio com Git conectado** (o que o meu, via CLI, não conseguiu por falta de permissão — ver seção 19). **Este é o projeto real, o que está atrás de `nauticflow.com.br` hoje.**

Como os dois projetos são de contas/times diferentes, o CLI que eu uso (logado como `jlpereiradcastro-droide`, time `nautic-flow`) **não enxerga nem consegue mexer no projeto `Passatempo/fluxo náutico`** — todo ajuste nele (variáveis de ambiente, domínio, deployment protection) teve que ser feito pelo usuário direto na interface, me mandando print pra eu confirmar/orientar o próximo passo.

**⚠️ CORREÇÃO (2026-08-16, ver seção 30 pra história completa)**: o parágrafo acima ("`Passatempo/fluxo náutico` é o projeto real") estava **desatualizado/errado**. O projeto que serve `nauticflow.com.br` de verdade hoje é o workspace **`joao's projects` → projeto `nauticflow`**, de uma conta que pertence a uma pessoa chamada **João** (conhecido do dono do produto, não é o dono do produto). Não se sabe ao certo se em algum momento o domínio migrou do `Passatempo/fluxo náutico` pra esse, ou se essa seção já nasceu com a informação errada — o importante é: **a partir de agora, é este workspace do João que importa**, e ele está no plano Hobby (gratuito), que não permite adicionar colaboradores. Ver seção 30.

### Variáveis de ambiente no projeto certo

O `Passatempo/fluxo náutico` foi criado do zero, sem nenhuma variável de ambiente configurada — por isso a primeira implantação de produção **crashou** (`MIDDLEWARE_INVOCATION_FAILED`, porque `src/lib/supabase/middleware.ts` não tinha `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` pra usar). Corrigido gerando um arquivo `variaveis-vercel-nauticflow.txt` (a partir do `.env.local`, sem o `VERCEL_OIDC_TOKEN`) na Área de Trabalho do usuário, pra ele colar no formulário "Adicionar variável de ambiente" da Vercel (função de colar `.env` de uma vez, que separa tudo sozinha). **Arquivo já deve ser apagado da Área de Trabalho depois de usado** (tinha segredo em texto puro).

### 🔴 Achado importante: 2 commits nunca chegaram no GitHub

Ao investigar riscos antes do commit, descobri que existiam **2 commits salvos localmente que nunca tinham sido enviados** (`git push`) pro GitHub:
- `024c4b6` — "atualização e otimização do sistema, melhoria na area de admin e teste de segurança no sistema" (o commit gigante: a correção de IDOR da auditoria de segurança, todo o painel `/admin` novo, as otimizações de performance, o upgrade do Next.js)
- `506152e` — "anotado na documentação.md"

Como o `Passatempo/fluxo náutico` builda a partir do `main` do GitHub, **o site que ficou no ar publicamente continha a falha de IDOR que a auditoria de segurança (seção 13) já tinha corrigido há dias** — a correção existia, só não tinha sido publicada. Resolvido com um `git push origin main` simples (fast-forward, sem conflito). A Vercel redeployou sozinha em seguida (Git já estava conectado).

**Lição pra próximas sessões**: sempre que algo relevante for commitado localmente, verificar `git log origin/main..HEAD` antes de considerar o trabalho "entregue" — commit local sem push não protege ninguém.

### Domínio: HostGator → descoberta de que na verdade é Cloudflare agora

1. Primeiro, conectamos `nauticflow.com.br` ao projeto certo na Vercel (aba Domains), que pediu um registro `A @ → 216.198.79.1`.
2. Guiei o usuário a colar isso na Zona de DNS da HostGator — funcionou, propagou, confirmado por `curl`/`dig`.
3. Depois, ao configurar o domínio de envio de e-mail no **Resend** (pra sair de `nauticflow.com.br` em vez do domínio antigo), o próprio Resend detectou o provedor de DNS como **Cloudflare**, não HostGator.
4. Investigado via `whois` + `dig`: os nameservers oficiais do domínio (registrados no `.br`) **já são do Cloudflare** (`hadlee.ns.cloudflare.com`, `shane.ns.cloudflare.com`). O usuário confirmou que fez essa troca ele mesmo (provavelmente ao usar a opção "Auto configure" do Resend, que integra com Cloudflare).
5. **Consequência prática**: a partir de agora, a Zona de DNS da HostGator **não controla mais nada** — quem manda é o painel do Cloudflare. O registro `A` do Vercel felizmente foi preservado/migrado na troca (o site não caiu), mas qualquer ajuste de DNS futuro (inclusive os registros do Resend) precisa ser feito no Cloudflare, não na HostGator.
6. Confirmado que o site continua no ar normalmente com Cloudflare na frente da Vercel (`server: cloudflare` no header, mas `x-vercel-id` presente também — passando a requisição adiante certinho).

### Resend (e-mail do domínio próprio) — em andamento, não concluído

Domínio `nauticflow.com.br` adicionado no Resend, com "Auto configure" (integração direta com Cloudflare). Status no fim desta sessão: **"Pending" / "Checking DNS"** — o próprio Resend avisa que pode levar horas. Ainda não confirmei os registros DNS de e-mail (MX/TXT específicos do Resend) aparecendo — só vi o SPF/MX antigos da HostGator até agora. **Retomar depois**: conferir se o status virou "Verified" e se o envio de e-mail (voucher, reset de senha, convite de equipe) está saindo do domínio novo.

### Checklist do que ainda falta (atualiza a seção 6 também)

- [ ] Confirmar Resend "Verified" e testar um envio de e-mail de verdade
- [ ] Redirect URLs no Supabase incluindo `https://nauticflow.com.br/**` (ainda não feito — só chegamos a mencionar pra `.vercel.app`, precisa atualizar pro domínio final)
- [ ] URL do webhook no Asaas apontando pra `https://nauticflow.com.br/api/webhooks/asaas`
- [ ] Corrigir o bug de timezone (seção 6) — agora que o site está de verdade em produção rodando em UTC (Vercel), isso deixou de ser risco teórico
- [x] ~~Decidir se apaga o projeto Vercel órfão (`nautic-flow/nauticflow`)~~ — checado em 2026-08-19: esse projeto não existe no workspace do João, só o `nauticflow` real. Nada a apagar (ver seção 6).
- [ ] Conectar Git no meu projeto original não é mais necessário — o `Passatempo/fluxo náutico` já tem Git; ele é o que deve continuar sendo usado

### Validação final desta sessão

`tsc --noEmit`, `next lint`, `next build` — todos limpos, sem erros novos. `npm audit` sem novidade (mesmos 2 advisories residuais já conhecidos, ver seção 6). Testado ao vivo em `nauticflow.com.br`: todas as rotas protegidas redirecionam certo, rotas públicas respondem 200, webhook recusa sem token, CSS carrega normal.

## 21. Chave do Asaas nunca tinha sido configurada — checkout testado e funcionando (sessão de 2026-08-14)

Pedido: testar a forma de pagamento. Descoberta: **nunca tinha funcionado**, desde o início do projeto — `ASAAS_API_KEY` no `.env.local` (e, por consequência, na Vercel, porque foi copiada de lá na seção 19) era literalmente o texto de exemplo `sua-chave-asaas`, nunca substituído pela chave real.

- Usuário colou a chave de **produção** por engano primeiro (prefixo `$aact_prod_`) — não foi usada pra nada, porque produção com dinheiro real não é o que se quer pra "testar". Trocado por uma chave de **sandbox** de verdade (prefixo `$aact_hmlg_`, gerada no painel do Asaas em ambiente de testes).
- **Segundo problema, mesmo depois da chave certa**: o `$` no início da chave estava sendo interpretado como referência de variável (mesmo bug já documentado na seção 4 sobre esse exato caractere) — precisou escapar como `\$aact_hmlg_...` no `.env.local` pra funcionar localmente. **Na Vercel não precisa escapar** (lá é só um valor de texto puro, sem parsing de shell/dotenv) — o valor colado lá é o `$aact_hmlg_...` sem barra.
- Testado direto contra a API do Asaas (sandbox) via `curl`, replicando as 3 chamadas que `src/lib/asaas.ts` faz: criar cliente → criar assinatura → pegar link da fatura. Funcionou depois da correção — cliente e assinatura de teste criados e apagados em seguida (dados de diagnóstico, sem deixar lixo na conta sandbox).
- Confirmado também pelo usuário, ao vivo: clicou em "Assinar" no plano Profissional em `/planos`, abriu a fatura real do Asaas sandbox (R$297, "Aguardando Pagamento") com os dados reais da empresa preenchidos automaticamente. **Checkout ponta a ponta funcionando.**
- **Não testado ainda**: completar o pagamento de fato e confirmar que o webhook (`/api/webhooks/asaas`) atualiza `paid_until` no Supabase — combinado de deixar pra uma próxima sessão (ver seção 6).

## 22. Senha forte no cadastro/reset e botão de excluir conta (sessão de 2026-08-14/15)

Pedido do dono do produto: reforçar a criação de senha (nada de `123456` ou data de nascimento) e adicionar um botão de excluir a própria conta.

**Senha forte** (`src/lib/password.ts`, função `validatePassword`): mínimo 8 caracteres, exige pelo menos uma letra e um número (isso já bloqueia sozinho qualquer senha 100% numérica, incluindo datas de nascimento como `15081995`), bloqueia uma lista de senhas óbvias comuns no Brasil (`senha123`, `brasil123`, `admin123` etc.) e rejeita o mesmo caractere repetido (`aaaaaaaa`). Usada tanto em `signUp` (`login/actions.ts`) quanto em `updatePassword` (`redefinir-senha/actions.ts`, substituindo o antigo mínimo de 6 caracteres do Supabase Auth). O front (`login/page.tsx`, `redefinir-senha/page.tsx`) mostra a dica de requisitos e aplica `minLength={8}` — só no modo cadastro/reset, não no login, pra não travar quem já tem conta com senha mais curta de antes.

**Excluir conta** (`configuracoes/actions.ts`, função `deleteMyAccount`, formulário em `configuracoes/delete-account-form.tsx`, seção "Zona de perigo" na tela de Configurações): decisão tomada — `staff` apaga só a própria conta (confirmação: digitar `EXCLUIR`); `company_admin` apaga a **empresa inteira** (confirmação: digitar o nome exato da empresa), porque não faz sentido o admin sumir e deixar uma empresa órfã sem dono. A rotina usa o client `service_role` (`createAdminClient`, mesmo padrão de `removeTeamMember` em `equipe/actions.ts`): apaga via `auth.admin.deleteUser` cada usuário do time (o admin por último), depois apaga a linha em `companies` — o `delete` em `companies` cascateia embarcações, passeios, clientes, reservas, notas fiscais etc. (única FK que não cascateia é `profiles.company_id`, por isso os perfis precisam ser removidos antes, via `auth.admin`, e não como consequência do delete da empresa). Sem período de carência — exclusão é imediata e definitiva, dado que a UX já exige digitar o nome/`EXCLUIR` como trava contra clique acidental.

Validado: `tsc --noEmit`, `next lint`, `next build` — todos limpos, sem erros novos.

**Chat de suporte — integrado e depois removido**: widget do Tawk.to chegou a ser adicionado no `<body>` do `src/app/layout.tsx` (via `next/script`, `strategy="lazyOnload"`), aparecendo em todas as páginas incluindo `/login`. Removido no mesmo dia a pedido do dono do produto: ele não quer ficar respondendo chat manualmente, e o widget do Tawk.to por padrão é atendimento humano ao vivo — a opção de bot automático de verdade (**AI Assist / Apollo AI**) é só grátis até 100 mensagens/mês, depois vira pago (~US$29/mês por site). Ficou decidido não integrar chat nenhum por enquanto (ver pendência reaberta na seção 6) até decidir um provedor com automação de fato gratuita, ou aceitar o custo do AI Assist.

## 23. Domínio verificado no Resend — e uma zona Cloudflare duplicada por engano (sessão de 2026-08-15)

Pedido: resolver a verificação pendente do domínio no Resend (`nauticflow.com.br` aparecia "Fracassado"/"Failed" há 22h). No processo, quase se criou um problema maior por engano — vale registrar o que rolou pra não repetir.

- Ao tentar corrigir pelo botão **"Auto configure"** no painel do Resend, foi criada sem querer uma **segunda zona no Cloudflare** (nameservers `ariadne.ns.cloudflare.com`/`rory.ns.cloudflare.com`), diferente da zona que já estava ativa de verdade (`hadlee.ns.cloudflare.com`/`shane.ns.cloudflare.com`, confirmada via `whois -h whois.registro.br nauticflow.com.br`). Como o registrador (Registro.br, via revenda da HostGator/Newfold) nunca teve os nameservers trocados pra essa zona nova, ela ficou só "pendente" e nunca chegou a valer — **nada quebrou**, mas gerou bastante confusão até isso ficar claro.
- Ao investigar uma alternativa (voltar o DNS pra HostGator), descobriu-se que o painel de "nameservers padrão" da HostGator pra esse domínio estava associado a um **plano de hospedagem cancelado** ("Plano M") — ou seja, não seria uma base estável pra depender no longo prazo. Path descartado.
- **A causa real do "Fracassado" no Resend**: nenhuma das duas coisas acima. Checando os registros DNS de verdade (`dig TXT/MX` para `send.nauticflow.com.br`, `resend._domainkey`, `_dmarc`), todos já estavam corretos e propagados na zona antiga (a que sempre esteve ativa) — o domínio só precisava que a verificação fosse **reiniciada** no próprio Resend (botão "Restart"/"Reiniciar verificação"). Assim que reiniciado, ficou "Verificado" em ~3 minutos, sem tocar em Cloudflare nem HostGator.
- **Lição pra próxima vez que o Resend (ou qualquer serviço) mostrar DNS como "falhou"**: checar os registros de verdade via `dig` antes de sair mexendo em nameserver/provedor — o status pode estar só desatualizado de uma checagem antiga, e a correção pode ser só clicar em "reiniciar verificação".
- A zona Cloudflare duplicada (ariadne/rory) foi removida pelo usuário. A conta Cloudflare "castrocompany" que a criou continua sendo uma incógnita — ninguém lembra de ter criado essa conta de propósito (provavelmente foi provisionada automaticamente via SSO/Google na primeira vez que algum "Auto configure" de algum serviço pediu acesso ao Cloudflare). Não é um problema agora, mas vale ter em mente se aparecer de novo.

## 24. Bug de timezone corrigido (UTC vs. Brasília) — sessão de 2026-08-15

Esse era o item 🔴 urgente da seção 6: em produção (Vercel roda em UTC), toda a lógica de horário de saída estava calculando 3 horas errado, porque o código montava/lia `departs_at` como se o processo sempre rodasse no fuso de Brasília (só verdade em dev, na máquina do desenvolvedor).

**Abordagem**: sem adicionar biblioteca de timezone (não havia `date-fns-tz`/`luxon`/`dayjs` no projeto) — como o Brasil não tem horário de verão desde 2019, o offset de Brasília é fixo em `-03:00` o ano inteiro, então dá pra resolver com aritmética simples. Centralizado em `src/lib/format.ts`, que ganhou funções novas além de `fmtTime`/`fmtDate` (que passaram a receber `timeZone: "America/Sao_Paulo"` explícito):

- `saoPauloToUTC(date, time)` — grava um `departs_at` a partir dos campos separados `date`/`time` do formulário, interpretados como horário de Brasília (usa em `saidas/actions.ts`, nas duas ações `createDeparture`/`updateDeparture`, substituindo o antigo `new Date(\`${date}T${time}\`)` que confiava no fuso do processo).
- `saoPauloHour(iso)` / `saoPauloHHMM(iso)` — hora (0-23) / "HH:MM" de um timestamp UTC já convertido pro horário de Brasília. Substituiu todo `new Date(iso).getHours()`/`.getMinutes()` espalhado pelo app: agrupamento por hora na Agenda e no Dashboard, e a checagem "essa saída está dentro do horário comercial (08:00-19:00)?" que existia **duplicada** em `reservas/page.tsx` (`hhmm` local) e `reservas/actions.ts` (`createReservation`, validação server-side antes de aceitar reserva).
- `saoPauloStartOfDay(instant)` / `saoPauloStartOfMonth(instant, monthOffset?)` / `saoPauloDayKey(iso)` — limites de dia/mês em Brasília, usados no `startEndOfToday()` (dashboard "hoje"), nos filtros "hoje/amanhã/semana" da Agenda (`rangeFor`, `sameDay`), e nas séries diárias/mensais do Dashboard (`periodStartFor`, `monthStart`, `prevMonthStart`, `d30`, `next7End`, agrupamento por dia dos gráficos). O caso mais delicado (testado explicitamente) é perto da meia-noite: às 23h30 em Brasília já é 02h30 UTC do dia seguinte — sem a correção, o servidor achava que já tinha virado o dia.
- O e-mail de voucher (`supabase/functions/send-reservation-voucher/index.ts`, Edge Function em Deno — **não é deployada pelo `git push`/Vercel, precisa de `supabase functions deploy` manual**) também ganhou `timeZone: "America/Sao_Paulo"` explícito nos dois `toLocale*Date/TimeString`.
- O gatilho no banco (`0014_horario_saida_no_banco.sql`) **não precisou mudar** — ele já convertia `departs_at at time zone 'America/Sao_Paulo'` corretamente; o bug era só na escrita vinda do app, que gravava o instante UTC errado pro banco converter.

**Validado**: `tsc --noEmit`, `next lint`, `next build` limpos. Testado adicionalmente rodando com `TZ=UTC node -e ...` (simulando o ambiente da Vercel, que a máquina de dev não reproduz sozinha) — confirmado que um horário digitado como 14:30 grava `17:30:00.000Z` e volta a exibir `14:30` corretamente, e que os limites de dia/mês acertam o caso de virada de meia-noite.

## 25. "Esqueci minha senha" corrigido de ponta a ponta (sessão de 2026-08-15)

O e-mail de reset simplesmente não chegava. Foram **quatro problemas independentes**, descobertos um atrás do outro:

1. **Redirect URLs do Supabase sem o domínio de produção** — em Authentication → URL Configuration, a lista de "Redirect URLs" só tinha `http://localhost:3000/**`. O Supabase recusa gerar/enviar o link de reset se o `redirectTo` não bater com algo da lista — e o código (`forgotPassword` em `login/actions.ts`) engole esse erro de propósito (pra não revelar quais e-mails existem no sistema), então a tela sempre mostrava "e-mail enviado" mesmo falhando. Corrigido adicionando `https://nauticflow.com.br/**`; "Site URL" também ajustado pra `https://` (estava `http://`).
2. **Remetente do SMTP customizado num domínio errado** — o Custom SMTP (Project Settings → Auth) já estava configurado com o Resend, mas o "Sender email address" era `contato@castrocompny.online`, um domínio que nunca foi verificado no Resend (o verificado é `nauticflow.com.br`). Resend recusa enviar a partir de domínio não verificado. Corrigido trocando pra `contato@nauticflow.com.br`.
3. **Template de e-mail em inglês e sem a logo** — cosmético, mas pedido do dono do produto: traduzido o template "Reset Password" do Supabase (Authentication → Email Templates) pra português e adicionada a tag `<img src="https://nauticflow.com.br/nauticflow-icon.png">` no topo. (O avatar circular ao lado do remetente no Gmail é outra coisa — foto de perfil de conta Google, não controlável por HTML de e-mail nem por config do Supabase/Resend; decidido não perseguir isso, nem configurar BIMI, por não valer o esforço nesse estágio.)
4. **O bug de código de verdade** — mesmo com o e-mail chegando certo, clicar no link caía de volta no `/login` em vez de abrir `/redefinir-senha`. Dois bugs empilhados:
   - `src/app/auth/callback/route.ts` só sabia processar o fluxo PKCE (`?code=...`), mas o link de recovery do Supabase manda o fluxo OTP (`?token_hash=...&type=recovery`) — o `if (code)` era pulado silenciosamente, nenhuma sessão era criada, sem erro nenhum. Corrigido tratando os dois formatos (`exchangeCodeForSession` pro `code`, `verifyOtp({ token_hash, type })` pro OTP).
   - `src/lib/supabase/middleware.ts` não tinha `/redefinir-senha` na lista de rotas públicas (`isPublic`) — então qualquer acesso sem sessão válida (inclusive um link expirado, que deveria mostrar a mensagem amigável "Link inválido ou expirado" que já existe em `redefinir-senha/actions.ts`) era redirecionado pro `/login` antes mesmo da página renderizar. Adicionado à lista.

**Validado**: `tsc --noEmit`, `next lint`, `next build` limpos. Os itens 1-3 foram configuração manual no painel do Supabase (não versionada em código); o item 4 foi commitado normalmente.

## 26. 🔴 Nova auditoria de segurança — falha crítica de escalação de privilégio corrigida (sessão de 2026-08-15/16)

Pedido do dono do produto: varredura completa de segurança em todo o codebase ("aja como profissional sênior de cyber"). Encontrados 3 problemas reais, todos corrigidos e validados no mesmo dia.

### 🔴 CRÍTICO — escalação de privilégio via cadastro público (corrigido: migration `0018_corrige_escalacao_privilegio_convite.sql`)

`handle_new_user()` (o gatilho `SECURITY DEFINER` que roda em todo `INSERT` em `auth.users`, criado na migration `0002` e reescrito na `0013` pra suportar convite de colaborador) confiava sem validação nenhuma em `raw_user_meta_data->>'invited_to_company_id'` e `raw_user_meta_data->>'role'` pra decidir a empresa e o cargo do novo perfil. Esses dois campos vêm de `options.data` passado pro `supabase.auth.signUp()` — uma chamada **pública**, que qualquer pessoa consegue fazer direto contra a API do Supabase usando a `NEXT_PUBLIC_SUPABASE_ANON_KEY` (pública por design, embutida no bundle do site). Ou seja: bastava chamar `signUp` com `{ invited_to_company_id: '<uuid de qualquer empresa>', role: 'super_admin' }` pra virar super admin da plataforma inteira, ou `role: 'company_admin'`/`'staff'` de qualquer empresa alvo — sem precisar de senha, convite real, nem nenhum dado secreto. É a mesma classe de bug que a migration `0003` já tinha corrigido uma vez (lá, via `UPDATE` em `profiles.company_id`/`role`, bloqueado revogando o `GRANT UPDATE` dessas colunas) — só que reaberta por um caminho novo (`INSERT` dentro de função `SECURITY DEFINER`, que ignora completamente a restrição de coluna do `GRANT`).

**Correção**: `auth.users.invited_at` só é preenchido pelo próprio GoTrue (motor de auth do Supabase) quando o usuário é criado via `admin.inviteUserByEmail()` — endpoint que exige a `SUPABASE_SERVICE_ROLE_KEY`, nunca exposta ao cliente. Diferente de `raw_user_meta_data`, esse campo não pode ser forjado por uma chamada pública a `signUp()`. O gatilho agora só aceita o caminho de "colaborador convidado" quando `new.invited_at is not null`; caso contrário, mesmo que o metadata contenha `invited_to_company_id`, ele é ignorado e o cadastro segue o fluxo normal (cria uma empresa nova pro próprio usuário, comportamento inofensivo). Além disso, `role` do colaborador convidado agora é sempre `'staff'` fixo no SQL, ignorando qualquer valor vindo do metadata — nunca herda `company_admin`/`super_admin` por esse caminho, consistente com o que `equipe/actions.ts` (`inviteTeamMember`) sempre envia.

**Testado contra produção de verdade** (não só localmente): script Node com a `service_role` key criou uma empresa "alvo" e tentou o exploit exato (`signUp` forjando `invited_to_company_id` da empresa alvo + `role: 'super_admin'`) — confirmado que nenhum perfil malicioso foi criado após a correção. Usuário de teste removido em seguida.

### 🟡 MÉDIO — passageiros sem checagem de empresa (`src/app/(app)/reservas/[id]/passenger-actions.ts`)

`setPassengerStatus` e `removePassenger` faziam `UPDATE`/`DELETE` em `passengers` só com `.eq('id', id)`, sem checar `company_id` — dependiam inteiramente da RLS como única barreira, ao contrário do padrão usado em todo o resto do app (inclusive no `addPassenger`, poucas linhas acima do mesmo arquivo). Corrigido adicionando `.eq('company_id', profile.company_id)` nas duas.

### 🟢 BAIXO — trilha de auditoria podia gravar a empresa errada (`src/app/admin/actions.ts`, `deleteInvoice`)

Ao excluir uma nota fiscal, o `company_id` usado no log de auditoria (`admin_audit_log`) vinha direto de um campo escondido do formulário, sem confirmar contra o banco que aquela nota realmente pertencia a essa empresa. Corrigido buscando o `company_id` de verdade da nota antes de apagar.

**Validado**: `tsc --noEmit`, `next lint`, `next build` limpos, exploit testado e bloqueado em produção. Áreas revisadas e consideradas limpas nesta varredura: middleware/CVE-2025-29927 (correção da seção 13 continua de pé), todos os outros Server Actions (reservas, embarcações, clientes, parceiros, saídas, equipe, configurações, billing — todos aplicam `company_id` corretamente), webhook do Asaas (comparação em tempo constante), RPC `link_asaas_subscription`, ausência de `dangerouslySetInnerHTML`/`eval`, nenhum secret commitado, e-mail do voucher escapa HTML corretamente.

## 27. Favicon (sessão de 2026-08-15/16)

O site não tinha favicon configurado (`src/app/layout.tsx` sem `metadata.icons`) — aba do navegador mostrava o ícone genérico. Adicionado `public/favicon.png`, referenciado em `metadata.icons.icon`.

Passou por algumas iterações até o formato final:
- Versão inicial usava `nauticflow-icon.png` (o mesmo ícone da sidebar/e-mail) direto — mas esse arquivo é bem largo (738x341, não quadrado), então o navegador esmagava/cortava a imagem de forma distorcida na aba.
- Corrigido gerando uma versão quadrada (padding transparente + resample de qualidade via Python/Pillow, já que o projeto não tem `sharp`/ImageMagick disponível — usei `pip3 install pillow` na hora).
- Testadas variações de fundo (branco, navy da marca, azul da marca) — descartadas todas a pedido do dono do produto, que preferiu manter fiel à arte original.
- Dono do produto forneceu uma logo nova (`~/Downloads/logo.png`, barco branco + onda azul, já com fundo transparente de verdade — confirmado checando o canal alpha) — essa é a versão usada agora, sem nenhuma cor de fundo adicionada.
- Ajustado o enquadramento (corte um pouco mais justo nas laterais, já que a arte é bem larga e sobrava muita margem vazia em cima/embaixo do quadrado) e depois revertido a pedido do dono do produto pro enquadramento anterior.

**Nota pra próxima sessão**: como o barco é branco e o fundo é transparente, o favicon fica ilegível em superfícies claras (aba de navegador em tema claro, apps com fundo branco) — só funciona bem em fundos escuros. Foi uma escolha explícita do dono do produto (testei variações com fundo colorido e ele preferiu sem), não um bug.

## 28. Varredura de segurança passiva e cabeçalhos HTTP (sessão de 2026-08-16)

O dono do produto rodou uma análise de segurança passiva no site publicado (`nauticflow.com.br`) usando um agente de navegador (Claude), sem testes ativos de invasão. Resultado, ponto a ponto:

- **Cookie de sessão sem `HttpOnly`** — reportado como risco médio-alto. **Avaliação real: comportamento esperado, não é uma falha de configuração.** O projeto já usa o pacote oficial `@supabase/ssr` (`createBrowserClient` em `src/lib/supabase/client.ts`, `createServerClient` em `src/lib/supabase/middleware.ts` e `src/lib/supabase/server.ts`) — esse é hoje o jeito recomendado pela própria Supabase de fazer auth em apps com SSR (Next.js App Router). Esse fluxo **precisa** que o cookie seja legível via `document.cookie` no navegador, porque o client-side também lê/escreve o cookie pra manter a sessão sincronizada entre cliente e servidor; não dá pra marcar `HttpOnly` sem quebrar esse mecanismo (não é uma opção de configuração esquecida). A mitigação de verdade pra esse cenário é impedir XSS na origem — é exatamente pra isso que serve o CSP (`Content-Security-Policy`) adicionado abaixo.
- **Controle de acesso a rotas privadas, HTTPS forçado, source maps bloqueados** — confirmados corretos, nenhuma ação necessária.
- **Todas as rotas inexistentes retornam 200 (tela de login) em vez de 404** — comportamento do middleware (`src/middleware.ts`): qualquer rota não-pública sem usuário autenticado é redirecionada pro login, mesmo que a rota nem exista. Risco baixo (não vaza informação), efeito colateral aceitável do padrão de auth-gate. Não foi alterado.
- **Cabeçalhos de segurança HTTP ausentes** (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`) — esse ponto era real: o projeto não tinha nenhum desses cabeçalhos configurados. **Corrigido** em `next.config.mjs`, função `headers()`, aplicada a todas as rotas (`/:path*`):
  - `Content-Security-Policy`: restringe de onde o navegador pode carregar script/estilo/imagem/conexão. Libera `'self'`, o domínio do Supabase (`*.supabase.co`, pra chamadas de API) e do Sentry (`*.sentry.io`, pra relatório de erros do navegador). `script-src` inclui `'unsafe-inline'` porque o script anti-flash do tema (ver seção 11, "Modo escuro") roda inline antes da página pintar e não usa nonce — endurecer isso é item de pendência (seção 6), não urgente.
  - `Strict-Transport-Security`: força HTTPS por 2 anos, inclusive em subdomínios.
  - `X-Frame-Options: DENY` + `frame-ancestors 'none'` (no CSP): impede o site de ser carregado dentro de um `<iframe>` de outro domínio (proteção contra clickjacking).
  - `X-Content-Type-Options: nosniff`: impede o navegador de tentar "adivinhar" o tipo de um arquivo servido, mitigando alguns ataques de MIME-sniffing.
  - `Referrer-Policy: strict-origin-when-cross-origin` e `Permissions-Policy` (bloqueando câmera/microfone/geolocalização, que o app não usa).
- **Rate limiting / CAPTCHA no login** — não testado pelo agente (exigiria tentativas reais de login, evitado de propósito). A própria Supabase Auth (GoTrue) já aplica rate limiting por IP em tentativas de login por padrão; não foi adicionada camada extra no app.

**Importante**: essa foi uma varredura passiva (observação de comportamento público), não um pentest. Testes ativos (SQL injection, força bruta, troca de IDs entre empresas/IDOR) não foram feitos porque exigiriam autorização formal — e, feitos de forma descuidada num sistema multi-tenant em produção, podem afetar outros clientes reais da plataforma.

### 🔴 Achado adicional durante essa sessão: merge com conflito nunca resolvido, quebrando o deploy

Ao tentar publicar a correção acima, o deploy na Vercel falhou (`SyntaxError: Unexpected token '<<'` no `next.config.mjs`). Causa: um merge anterior (commit `a418459`, "Merge branch 'main' of ...") tinha sido commitado **com os marcadores de conflito do Git ainda dentro dos arquivos** (`<<<<<<<`, `=======`, `>>>>>>>`), tanto em `next.config.mjs` quanto neste próprio `DOCUMENTACAO.md` (a numeração de seções tinha duplicado "seção 12" — uma pro conteúdo de otimização de performance de outra sessão, outra pra essa varredura de segurança). Corrigido resolvendo os dois arquivos manualmente (juntando o conteúdo dos dois lados do conflito, sem descartar nada) e validado com `npm run build` completo antes de recommitar.

**Lição pra próximas sessões**: depois de qualquer `git pull`/merge, sempre rodar uma busca por `<<<<<<<` no repo (ou pelo menos `npm run build`) antes de dar como resolvido — um merge "sem erro visível no terminal" ainda pode deixar marcadores de conflito soltos num arquivo se a resolução foi feita errado.

### Confirmação pós-deploy (securityheaders.com)

Rodado depois do deploy: nota **A** em https://nauticflow.com.br/login, todos os cabeçalhos acima confirmados presentes de verdade em produção (`curl -I` também confirmou, direto). Dois pontos observados no relatório:

- **`unsafe-inline` no `script-src`** — já documentado acima como pendência (ver seção 6), é o único motivo da nota não ser A+.
- **`Access-Control-Allow-Origin: *` presente, mesmo sem eu ter configurado isso** — investigado: não vem do `next.config.mjs` nem de nenhum código do projeto (`grep` no repo só encontra esse header na Edge Function do voucher, que não tem nada a ver com `/login`). É comportamento **padrão da própria Vercel** para páginas geradas como estáticas no build (`/login` é `○ Static`) — a Vercel aplica esse header em conteúdo estático servido pelo Edge Network, e é uma configuração de plataforma conhecida por **não respeitar override** feito via `next.config.mjs`/`vercel.json` nesse cenário. **Risco considerado baixo e aceito, sem ação**: `/login` não tem cookie de sessão nem dado de usuário — é a mesma página pública que qualquer um vê acessando a URL direto, então permitir leitura cross-origin dela não vaza nada sensível. O próprio relatório do securityheaders.com não contou isso como "Warning" (só listou na seção informativa).

## 29. Linhas de tabela pesadas — formulário de edição separado em chunk sob demanda (sessão de 2026-08-16)

Pendência aberta desde a seção 12 (otimização de performance): cada linha de tabela nas listas (`saidas/departure-row.tsx`, `reservas/reservation-row.tsx`, `parceiros/partner-row.tsx`, `embarcacoes/vessel-row.tsx`, `clientes/client-row.tsx`) é seu próprio Client Component, com o formulário de edição inteiro embutido no mesmo arquivo — mesmo quando fechado (`{editing && (...)}` evita renderizar o DOM do formulário, mas não evita o React montar o hook `useFormState` daquela linha). Numa lista com 25-50 linhas, isso significa até 50 chamadas de `useFormState` sendo inicializadas no mount da página, só pra no máximo uma linha estar realmente em edição por vez.

**Correção**: cada par de arquivos virou um par `{nome}-row.tsx` (fica como estava, só que sem o formulário) + `{nome}-edit-form.tsx` (novo, contém só o `<form>`, o `useFormState`/`useFormStatus` e o botão "Salvar"). O `{nome}-row.tsx` carrega o formulário via `next/dynamic(() => import("./{nome}-edit-form")..., { ssr: false })`, renderizado só dentro do `{editing && ...}`. Resultado prático:

- O código do formulário de cada uma das 5 telas virou um chunk JS separado (~4KB cada, confirmado no build: `232.js`, `376.js`, `383.js`, `580.js`, `901.js`), fora do bundle da página.
- Esse chunk só é baixado e hidratado (e o `useFormState` daquela linha só é chamado) no momento em que alguém clica no lápis de editar **daquela linha específica** — as outras 24-49 linhas na tela não pagam esse custo.
- **Vessel (`embarcacoes`) precisou de atenção extra**: o cálculo de "capacidade comercial" ao vivo (`official - crew`, mostrado enquanto o usuário digita) dependia de dois `useState` (`official`, `crew`) que viviam no componente da linha — migrados junto pro `vessel-edit-form.tsx`, já que só fazem sentido durante a edição.
- **Cuidado ao portar o formulário de saídas**: o campo de hora em `departure-row.tsx` tinha `min="08:00" max="19:00"` (trava de horário comercial, seção 10) que não estava visível numa leitura antiga do arquivo — conferido contra o arquivo atual antes de mover, pra não perder essa validação no HTML.

**Validado**: `tsc --noEmit`, `next lint`, `next build` limpos. Build confirma os 5 chunks separados existindo fora dos bundles de página, e o tamanho de "First Load JS" das rotas afetadas não piorou (`embarcacoes` e `saidas` inclusive caíram de tamanho: 3.8kB→2.16kB e 4.54kB→2.91kB). **Não testado clicando na UI real** (sem login de teste disponível no ambiente) — recomendo confirmar visualmente que abrir/fechar/salvar edição em cada uma das 5 telas (Saídas, Reservas, Parceiros, Embarcações, Clientes) continua funcionando igual, especialmente o cálculo de capacidade comercial ao vivo em Embarcações.

## 30. 🔴 Descoberta importante: quem hospeda `nauticflow.com.br` de verdade — e o problema de deploy bloqueado (sessão de 2026-08-16)

Ao tentar confirmar se o commit da seção 29 (linhas de tabela) tinha ido pro ar, o dono do produto mandou um print do painel Vercel que revelou algo que a seção 20 tinha documentado errado (ou que mudou sem ninguém registrar): **o projeto que serve `nauticflow.com.br` de produção hoje não é o `Passatempo/fluxo náutico`** (como a seção 20 afirmava) — **é o workspace `joao's projects` → projeto `nauticflow`**, confirmado pelo campo "Domains" do próprio painel mostrando `nauticflow.com.br`.

**Achado mais importante**: esse workspace **pertence a uma pessoa chamada João, não ao dono do produto** — o dono do produto usa a conta dele com acesso que o próprio João concedeu (login compartilhado), mas **não é dono/membro reconhecido pela Vercel**. Isso já causava sintomas antes de ser diagnosticado: o commit `3020e09` (seção 29, correção de performance das tabelas) ficou com o deploy **"Blocked"**, com o aviso "Usuário Vercel não encontrado" — o e-mail do commit (`davimagi1234@gmail.com`, GitHub `DAVIWENDELL`) aparece como **"Não vinculado"** a nenhuma conta Vercel.

### Por que isso acontece

O workspace do João está no plano **Hobby (gratuito)**, que **não suporta colaboração em repositório privado de jeito nenhum** — não é uma questão de "criar uma conta Vercel e linkar com o GitHub" (isso sozinho não resolve, testado/confirmado por pesquisa: o Hobby bloqueia qualquer segundo colaborador, com conta ou sem). As únicas formas de parar esse bloqueio de vez seriam: (a) pagar o plano Pro (US$20/mês por pessoa com acesso de deploy — Owner ou Member, mesmo preço; pra deixar dono+João como donos, seriam 2 assentos = US$40/mês), ou (b) transferir o projeto inteiro pra uma conta só do dono do produto (grátis, mas o João perde acesso ao painel), ou (c) tornar o repositório do GitHub **público** (a Vercel libera colaboração de graça pra repositórios públicos — mas isso expõe todo o código-fonte do sistema publicamente, não recomendado pra um produto comercial).

### Decisão tomada (2026-08-16)

O dono do produto optou por **não pagar e não transferir** — quer manter o João como dono também, e prefere que ele apenas destranque cada deploy bloqueado manualmente. **Fluxo combinado, sem custo**: toda vez que um commit meu (Claude) for enviado pro `main` do GitHub e a Vercel mostrar "Blocked" no painel do João, o João precisa publicar manualmente, direto do computador dele:

```
git pull origin main
npx vercel login     # só na primeira vez
npx vercel --prod
```

Isso funciona porque o CLI autentica pela pessoa logada (o João), não pelo autor do commit no Git — então não passa pela checagem que bloqueia o deploy automático via GitHub.

**Consequência prática pra próximas sessões**: depois de qualquer commit/push que eu fizer daqui pra frente, **não presumir que o site atualizou sozinho** — a Vercel só redeploya automático se o commit não for bloqueado, e commits meus (autor `DAVIWENDELL`/e-mail vinculado ao Git do usuário) muito provavelmente **vão** ser bloqueados, dado que o e-mail do commit não está vinculado a nenhuma conta Vercel. Sempre avisar o dono do produto que ele (ou o João) precisa confirmar/rodar o deploy manual depois de um push importante, e idealmente confirmar depois (`curl -I https://nauticflow.com.br` ou um teste funcional) que a mudança realmente chegou ao ar antes de dar a tarefa como concluída.

### Testado o CLI, também bloqueado — e a solução final: repositório público

Testado ao vivo, com login novo feito pelo dono do produto no computador local (conta `castrocompny-9189`, com acesso de visualização ao time `joao-s-projecto1`): tanto o botão "Redeploy" no painel (logado como o próprio João) quanto `npx vercel --prod` pelo CLI **também ficaram bloqueados** — o build nunca chegava a rodar de verdade (`vercel inspect` mostrava `0ms` de build). Ou seja, a trava do plano Hobby bloqueia **qualquer** forma de publicar com mais de uma identidade envolvida no projeto, não só o deploy automático via GitHub — não existia nenhum atalho gratuito com o repositório privado.

**Resolvido pelo dono do produto**: tornou o repositório `castrocompny/Nauticflow` **público** no GitHub (estava privado desde o início, decisão consciente de expor o código-fonte em troca de destravar o deploy sem custo — ele foi avisado da implicância antes de decidir). Confirmado via `curl https://api.github.com/repos/castrocompny/Nauticflow` (`"private": false`). Testado na sequência com `npx vercel --prod --scope joao-s-projecto1`: **funcionou de primeira**, build completo, `▲ Aliased https://nauticflow.com.br`, confirmado com `curl -I` mostrando `Etag` novo e `X-Vercel-Cache: PRERENDER` (conteúdo fresco, não reaproveitado do cache antigo). Deploy automático via GitHub (push direto) também deve voltar a funcionar sozinho a partir de agora, já que a colaboração em repositório público é liberada de graça pela Vercel.

**Nota de segurança pra próximas sessões**: com o repositório público, todo o código-fonte do sistema (regras de negócio, estrutura do banco via migrations, etc.) é visível publicamente no GitHub — segredos continuam seguros (nunca estiveram versionados, só em `.env.local`/variáveis de ambiente da Vercel), mas não tratar mais o conteúdo do repositório como confidencial em nenhuma circunstância (ex: não assumir que ninguém de fora vai ler o código ao decidir o quão detalhado um comentário pode ser).

## 31. Auditoria de segurança pré-produção (sessão de 2026-08-17)

Pedido explícito do dono do produto, antes de publicar de vez: revisão completa cobrindo autenticação/sessão, controle de acesso, exposição de dados/secrets, injeção/validação, dependências/infra e lógica de negócio. Relatório completo entregue primeiro (sem corrigir nada), depois indo item por item conforme o dono do produto for priorizando.

**Achados, visão geral**: a base já estava bem cuidada por causa das auditorias anteriores (seções 13 e 26) — a maioria dos itens já estava OK (RLS em todas as 14 tabelas, sem secrets hardcoded/commitados, sem SQL injection, sem XSS, preço da assinatura SaaS validado server-side, webhook com comparação em tempo constante). Achados reais, em ordem de risco:

1. **🔴 IDOR em `departures.vessel_id`/`tour_id` — corrigido nesta sessão.** A migration 0015 (seção 13) tinha corrigido o mesmo tipo de falha em `reservations`/`passengers`, mas esqueceu `departures`: `createDeparture`/`updateDeparture` (`saidas/actions.ts`) aceitavam `vessel_id`/`tour_id` do formulário sem checar se pertenciam à própria empresa — nem no app, nem no banco. Um usuário autenticado de qualquer empresa que soubesse o UUID de uma embarcação/passeio de outra empresa podia criar uma saída referenciando ela. **Corrigido em duas camadas**, mesmo padrão da 0015: checagem explícita de `company_id` no app (`saidas/actions.ts`, `createDeparture` e `updateDeparture`) + gatilho novo no banco, `supabase/migrations/0019_valida_dono_fk_saidas.sql` (**aplicada no Supabase** pelo dono do produto).
2. **🟠 Rate limiting no login — corrigido pelo dono do produto direto no painel do Supabase.** Os limites em si já eram razoáveis (30 tentativas de sign-in/5min por IP, 360/hora), mas havia uma falha de configuração real: o login desse app não fala com o Supabase direto do navegador, passa por uma Server Action (roda no servidor da Vercel primeiro) — sem "IP Address Forwarding" habilitado, o Supabase via o IP da Vercel, não o do usuário/atacante real, misturando o "balde" de tentativas de todo mundo no mesmo limite. **Corrigido**: dono do produto habilitou "Enable IP address forwarding" em Authentication → Rate Limits no painel do Supabase (não é código, é configuração de projeto). CAPTCHA (hCaptcha/Turnstile) fica como melhoria futura opcional, só se houver sinal de abuso real (acompanhável em Authentication → Audit Logs).
3. **🟡 Valor/quantidade da reserva sem validação — corrigido nesta sessão.** `createReservation`/`updateReservation` (`reservas/actions.ts`) aceitavam qualquer `total_cents` (inclusive negativo) e `people_count` (inclusive zero/fracionário) vindos do formulário, sem checagem nenhuma. **Corrigido**: bloqueia valor negativo/não-numérico e quantidade de passageiros que não seja um inteiro ≥ 1. **De propósito, não trava contra o `tours.base_price_cents`** — desconto e preço combinado com o cliente são uso legítimo do negócio, só o valor sem sentido (negativo/inválido) é que era o problema real.
4. **🟡 `npm audit`: 5 advisories HIGH** (`next`, `postcss`, `glob` — dev dependency) — correção exige `next@16.3.1` (major, breaking change). A maioria dos cenários cobertos (custom server, i18n, WebSocket, `remotePatterns`) não se aplica hoje, mas duas são genéricas (DoS com Server Components, cache poisoning) e valem uma avaliação de migração futura. Pendente, não bloqueador imediato.
5. **🟢 `node_modules` local desatualizado** (`14.2.13` instalado vs `14.2.35` no lockfile/produção) — só afeta paridade de teste local, produção já usa a versão certa (confirmado no log de build da Vercel). Corrigir com `rm -rf node_modules && npm install` quando conveniente.
6. **Itens aceitos conscientemente, não bloqueiam publicação**: cookie de sessão sem `HttpOnly` (inerente ao `@supabase/ssr`, mitigado por CSP — já discutido na seção 28), mensagens de erro do Postgrest repassadas pra UI (vazamento mínimo, sem stack trace/SQL), `unsafe-inline` no CSP (necessário pro script anti-flash do tema).

**Validado após o item 1**: `tsc --noEmit`, `next build` limpos.

## 32. Migração major do Next.js 14 → 16 (item 4 da auditoria, sessão de 2026-08-17)

Corrige os 5 advisories HIGH residuais do `npm audit` (seção 31) — a única correção disponível era `next@16.3.1`, versão major, com mudanças que quebram compatibilidade. Feito com cuidado, testando cada etapa antes de avançar, porque é o tipo de mudança que pode quebrar o site inteiro silenciosamente.

**Versões**: `next` 14.2.35 → 16.3.1, `react`/`react-dom` 18.3.1 → 19.2.8, `eslint` 8 → 9, `eslint-config-next` → 16.3.1. `npm audit` foi de 5 HIGH pra **0 vulnerabilidades**.

### Breaking changes encontrados e corrigidos

1. **`cookies()`/`headers()` do `next/headers` viraram assíncronos.** Achado em `src/lib/supabase/server.ts` (usava `cookies()` sem `await`) e nos dois lugares que montam link de e-mail com `headers().get("origin")` (`login/actions.ts`, `equipe/actions.ts`). Corrigido tornando `getAll`/`setAll` do client Supabase funções `async` internamente (evita ter que tornar `createClient()` inteiro assíncrono e mudar todo lugar que chama ele) e adicionando `await` nos dois `headers()`.
2. **`params`/`searchParams` das páginas viraram `Promise`.** Esse foi o achado mais sério: 16 páginas (`admin/[id]`, `voucher/[id]`, `saidas/[id]`, etc.) tipavam `params`/`searchParams` como objeto simples e acessavam direto (`params.id`). **O build não acusa isso como erro** — só quebraria silenciosamente em produção (`params.id` viraria `undefined`, já que `params` passa a ser uma Promise não resolvida). Corrigido com a ferramenta oficial da própria Next.js: `npx @next/codemod@canary next-async-request-api .`, que reescreveu as 16 páginas certinho (`const params = await props.params`). **Lição pra próximas migrações major do Next.js**: `next build` sozinho não é suficiente pra confiar que `params`/`searchParams` estão certos — comparar o diff do codemod com o que existia antes é o jeito de confirmar.
3. **`next lint` foi removido do Next 16.** O comando `next lint` (usado no script `lint` do `package.json`) passou a ser interpretado como `next [diretório]`, dando erro "Invalid project directory". Corrigido: script `lint` agora roda `eslint .` direto, e o `.eslintrc.json` (formato antigo) foi trocado por `eslint.config.mjs` (formato "flat config", exigido pelo ESLint 9), importando `eslint-config-next/core-web-vitals`.
4. **Duas regras novas do ESLint (`react-hooks/purity`, `react-hooks/set-state-in-effect`)** vieram junto no `eslint-config-next` novo — fazem parte da preparação do ecossistema React pro React Compiler. Pegaram dois padrões que já existiam no código e continuam corretos, só que a regra nova não gosta:
   - `src/components/theme-toggle.tsx`: `setDark(...)` dentro de um `useEffect` vazio — é o padrão certo pra evitar erro de hidratação (o componente precisa nascer "claro" igual ao HTML do servidor, e só corrigir pro tema real depois de montado no navegador). Suprimida a regra nessa linha específica, com comentário explicando por quê.
   - `src/app/(app)/planos/page.tsx`: `Date.now()` calculado durante a renderização de um **Server Component** — a regra existe pra evitar isso em Client Components (por causa da memoização do React Compiler), mas não faz sentido pra Server Component (que roda de novo a cada requisição de qualquer jeito, sem memoização nenhuma envolvida). Suprimida a regra nessa linha também, com o mesmo tipo de comentário.
5. **`middleware.ts` está com aviso de depreciação** ("please use 'proxy' instead") — não quebra nada ainda no Next 16, só um aviso no build. Não corrigido nesta sessão (ver pendência na seção 6); a própria Next.js oferece um codemod pra isso também (`npx @next/codemod@canary middleware-to-proxy .`).

### Validação

`tsc --noEmit`, `eslint .` (0 erros, só os 2 avisos de sempre sobre `<img>`), `next build` completo (as 22 rotas geradas no mesmo padrão de antes), `npm audit` zerado, e teste funcional rodando `next start` de verdade: rotas públicas retornam 200, rotas protegidas redirecionam 307 sem sessão (incluindo `/admin/[id]`, que foi a página com o bug do `params.id`), webhook do Asaas recusa sem token (401). **Não testado**: navegação autenticada de verdade na UI (sem login de teste disponível no ambiente) — recomendo passar pelas telas principais manualmente depois do deploy, com atenção especial às páginas que usam `params`/`searchParams` (item 2 acima), já que é o tipo de bug que só aparece em uso real.

## 33. Verificação em duas etapas (2FA/TOTP) obrigatória pro Super Admin (sessão de 2026-08-18)

Pedido do dono do produto: proteger a área `/admin` (que dá acesso a todas as empresas clientes — renovar assinatura, suspender, ver dados de faturamento) com um segundo fator, além da senha.

### Como funciona

Usa o MFA nativo do Supabase Auth (TOTP — Google Authenticator, Authy, 1Password etc.), sem infraestrutura própria de segredo/QR code:

- `src/lib/admin-auth.ts` — `requireSuperAdminPage()` (usado nas páginas `/admin` e `/admin/[id]`) e `requireSuperAdminAction()` (usado em todas as Server Actions de `admin/actions.ts`, no lugar do antigo `requireSuperAdmin` local). Ambos checam, nesta ordem: sessão existe → `profiles.role === "super_admin"` → `supabase.auth.mfa.getAuthenticatorAssuranceLevel().currentLevel === "aal2"`.
- Sem sessão → `/login`. Não é super admin → tela de "acesso restrito" (não revela que a área existe). É super admin mas nunca cadastrou o segundo fator → `/admin/mfa-setup` (cadastro obrigatório, com QR code). Cadastrou mas ainda não verificou o código *nesta sessão* → `/admin/mfa-challenge`.
- O AAL (Authenticator Assurance Level) fica preso à sessão — cada novo login começa em `aal1` e exige o código de 6 dígitos de novo, mesmo que o dispositivo já tenha o segundo fator cadastrado. É exatamente o "sempre pede o código pra entrar no Super Admin" pedido.
- As Server Actions de admin (`renewSubscription`, `suspendCompany` etc.) também exigem `aal2`, não só a página — importante porque uma Server Action pode ser chamada diretamente, sem passar pela renderização da página.

### Arquivos

- `src/lib/admin-auth.ts` (novo)
- `src/app/admin/mfa-setup/page.tsx` + `mfa-setup-form.tsx` (novo) — cadastro do TOTP: gera QR code (`supabase.auth.mfa.enroll`), limpa fatores não verificados de tentativas anteriores antes de gerar um novo, confirma com o código de 6 dígitos (`challenge` + `verify`).
- `src/app/admin/mfa-challenge/page.tsx` + `mfa-challenge-form.tsx` (novo) — pede só o código, pra sessão que já tem fator cadastrado.
- `src/app/admin/page.tsx`, `src/app/admin/[id]/page.tsx`, `src/app/admin/actions.ts` — trocado o auth check antigo (só checava `role`) pelos helpers novos de `admin-auth.ts`.

### Único super admin cadastrado

Só existe uma conta com `role = "super_admin"` hoje (a do dono do produto), compartilhada com o sócio (João) — ele usa o mesmo e-mail/senha, não tem conta separada. Pra ele também conseguir passar pelo desafio de 2FA, o mesmo segredo TOTP foi cadastrado manualmente no autenticador dele também (opção "inserir chave de configuração" em vez de escanear o QR, já que o QR some depois que o fator é confirmado — o segredo em texto, mostrado atrás do link "Não consigo escanear o QR code" na tela de cadastro, foi salvo e enviado pra ele antes de confirmar). Se um dia precisar resetar (perda de celular), é preciso apagar o fator TOTP direto no Supabase (Authentication → Users → o usuário → MFA) e cadastrar de novo — não tem tela de "recuperar 2FA" no app ainda.

**Detalhe de troubleshooting**: na primeira tentativa, o cadastro falhou com "Failed to fetch" — era uma extensão do navegador bloqueando a chamada (funcionou normalmente numa aba anônima). Servidor, CORS e CSP foram todos conferidos e estavam corretos; não foi um bug do sistema.

### Botão "Voltar ao sistema" (mesma sessão, 2026-08-18)

Adicionado no cabeçalho de `/admin` (`src/app/admin/page.tsx`), voltando pra `/dashboard`. Motivo: pedido do dono do produto pensando em uso como "app" instalado no celular (atalho de tela inicial), onde não existe botão de voltar do navegador disponível.

### Cancelamento definitivo de empresa (mesma sessão, 2026-08-18)

Pedido do dono do produto depois de revisar a tela do `/admin`: até então só existia "suspender" (reversível) — não tinha nenhum caminho no sistema pra encerrar uma empresa de vez, só mexendo direto no banco.

- `deleteCompanyPermanently(companyId, confirmName)` em `src/app/admin/actions.ts` — exige `aal2` (via `requireSuperAdmin`, seção 33) + o nome exato da empresa como segunda confirmação (checado no cliente e de novo no servidor). Usa o client de `service_role` (`createAdminClient`) só pra apagar os usuários da empresa (`auth.admin.deleteUser`, um por um) e a linha de `companies` — o mesmo padrão já usado na autoexclusão de conta em `configuracoes/actions.ts`. O resto (assinatura, embarcações, passeios, reservas, clientes, parceiros, notas fiscais) já cai sozinho via `on delete cascade` no banco (schema em `0000_init_schema.sql`).
- Registra no `admin_audit_log` **antes** de apagar, com o nome da empresa em `details` — depois que a empresa some, `target_company_id` fica nulo (`on delete set null`), então sem isso o rastro perderia qual empresa foi.
- UI: `src/app/admin/[id]/delete-company-controls.tsx`, num card "Zona de risco" na página de detalhe da empresa (`admin/[id]/page.tsx`). Botão discreto que expande um formulário de confirmação com aviso, e só libera o botão de excluir depois do nome digitado bater exatamente.

### Empresa do próprio dono marcada como plano Premium sem vencimento (mesma sessão, 2026-08-18)

A empresa "Castro Compny" (a do dono do produto, também a conta `super_admin`) foi movida direto no banco pra plano Premium com `paid_until` em 2099-12-31, pra parar de pedir renovação manual toda hora no painel. **Isso NÃO cancelou a cobrança real no Asaas** — ver a pendência 🔴 marcada como prioridade na seção 6, ainda em aberto (depende do João, que tem acesso à conta do Asaas).

### Ideias levantadas e deixadas como pendência (não implementadas ainda)

Na mesma revisão da tela do `/admin`, mais 3 ideias ficaram anotadas pra quando fizer sentido (base de clientes ainda é pequena hoje):
- **Impersonar empresa** (entrar no sistema como se fosse aquele cliente, pra dar suporte sem pedir senha) — precisa de log de auditoria bem feito se for implementar, por ser sensível.
- **Exportar lista de empresas em CSV/planilha** — útil pro contador/controle financeiro fora do sistema.
- **Indicador de risco de churn** (empresa que sumiu depois de já ter usado, não só quem nunca ativou) — hoje só existe "onboarding travado" pra quem nunca cadastrou nada.

### Validação

`tsc --noEmit` e `eslint .` sem erros, `next build` completo (`/admin/mfa-setup` e `/admin/mfa-challenge` aparecem como rotas dinâmicas, igual ao resto de `/admin`). Não depende de nenhuma tabela nova nem RLS — MFA vive no schema `auth`, gerenciado pelo GoTrue, fora do alcance das políticas do schema `public`.

## 34. Barra lateral mais limpa — resumo do plano virou um link, detalhes ficaram em `/planos` (sessão de 2026-08-18)

Pedido do dono do produto: o cartão do rodapé da barra lateral (nome do plano + embarcações usadas + reservas do mês + data de renovação + botão "Gerenciar plano") ocupava espaço fixo o tempo todo. Trocado por uma linha única (nome do plano + um indicador "vencida" se for o caso + seta), que já é o link pra `/planos`.

- `src/components/sidebar.tsx` — removidas as props `reservasUso`, `vesselsUso`, `vesselsLimite`, `paidUntil` (não são mais exibidas ali). `overdue` continua, agora só pra mostrar "vencida" ao lado do nome do plano.
- `src/app/(app)/layout.tsx` — removidas as 2 queries que só existiam pra alimentar essas props (`vessels` e `reservations` do mês) — efeito colateral bom: **2 queries a menos em toda navegação do app**, não só simplificação visual.
- `src/app/(app)/planos/page.tsx` — ganhou um card no topo com "Embarcações em uso: X / limite" e "Reservas este mês: X", pra não perder a informação que saiu da barra lateral — agora concentrada no único lugar que já existia pra gerenciar o plano, em vez de duplicada em dois lugares.

### Validação

`tsc --noEmit`, `eslint .` e `next build` sem erros. Mudança é só de UI/consulta — nenhum controle de acesso foi alterado.

## 35. Link "Super Admin" na barra lateral, bug de CSS no `/admin` e reorganização do menu em grupos (sessão de 2026-08-18)

Três ajustes menores de UI feitos na mesma sessão do 2FA (seção 33) e do cancelamento de empresa (seção 34):

- **Link "Super Admin" no menu** (`src/components/sidebar.tsx`) — aparece só quando `isSuperAdmin` (calculado no servidor em `layout.tsx` a partir de `profile.role`, não confiável pelo cliente) é `true`. Antes disso não tinha como chegar em `/admin` sem digitar a URL na mão.
- **Bug de CSS corrigido**: a busca com ícone e o select de filtro do `/admin` (ver seção 6) tinham o ícone de lupa sobreposto ao texto digitado, e o select ficava esticado ocupando a linha inteira. Causa raiz em `globals.css`: a regra base de `input`/`select` usava um seletor com dois `:not()`, que sem querer dava a ela **mais especificidade CSS** que uma classe utilitária normal (`pl-9`, `w-auto`) — então qualquer tentativa de ajustar padding/largura num elemento específico perdia pra esse estilo base, mesmo com a classe certa aplicada. Corrigido envolvendo o seletor em `:where(...)` (zera a especificidade do que está dentro), o jeito padrão de resolver esse problema em Tailwind. Afeta só onde alguém já tentava sobrescrever esses estilos — não muda nada nos outros inputs/selects do sistema.
- **Menu lateral reorganizado em grupos**: os 11 itens (antes todos numa lista única) viraram 3 grupos com rotulozinho — **Operação** (Dashboard, Reservas, Agenda, Saídas), **Cadastros** (Clientes, Embarcações, Parceiros) e **Gestão** (Financeiro, Relatórios, Equipe, Configurações) — pra quebrar visualmente a lista longa. A cor dos itens inativos também foi corrigida: usava `text-muted` (variável que muda com o tema claro/escuro do app), mas a barra lateral é **sempre escura** (`bg-navy` é fixo, não muda com o tema) — então no modo claro o texto ficava escuro demais num fundo escuro, quase ilegível. Trocado por `text-slate-300`/`text-slate-400` fixos (não dependem do tema), consistentes com o resto das cores fixas da barra lateral (`bg-navy`, `bg-brand` etc.).

### Validação

`tsc --noEmit`, `eslint .` e `next build` sem erros em cada mudança (validado individualmente antes de cada commit). Todas as três são só UI/CSS — nenhuma mudança em controle de acesso, dados ou lógica de negócio.

## 36. Dois bugs achados rodando `npm run dev` local (sessão de 2026-08-18)

O dono do produto rodou `npm run dev` pela primeira vez desde a migração pro Next 16/React 19 (seção 32) e achou 2 erros que só apareciam em desenvolvimento:

1. **`useFormState` renomeado pra `useActionState`** — no React 19 essa função saiu de `"react-dom"` e foi pra `"react"`. A migração do Next 16 usou o codemod oficial (`@next/codemod`), que cobre só APIs do *Next.js* (`params`/`searchParams` async etc.) — não pega renomeações do *React* em si, então esse ficou pra trás. Corrigido nos 18 formulários do sistema que usam Server Actions (busca: `grep -rl 'useFormState' src`). `useFormStatus` não mudou, continua vindo de `"react-dom"` normalmente.
2. **CSP bloqueando `eval()` em dev** — o Next usa `eval()` internamente em modo desenvolvimento (Hot Module Reload, stack traces). Como a CSP (seção 28) não tinha `'unsafe-eval'` no `script-src`, a página quebrava ao rodar localmente. Corrigido em `next.config.mjs`: `'unsafe-eval'` só entra quando `NODE_ENV !== "production"` — o build/deploy real continua com a CSP restrita de sempre (confirmado rodando `next build` e conferindo que o header em produção não muda).

### Validação

`tsc --noEmit`, `eslint .`, `next build` sem erros. Testado também rodando `npm run dev` de verdade: confirmado que o header CSP local já inclui `unsafe-eval` e que a página `/login` carrega sem os dois erros do console reportados.

## 37. Sistema responsivo pra celular (item 4 da lista de pendências, sessão de 2026-08-19)

Trabalho grande, feito em duas etapas: primeiro a estrutura básica numa branch de teste (`testes`) com link de preview da Vercel pro dono do produto aprovar (seção 9, regra de branch de teste), depois vários ajustes finos direto na `main` a partir de prints reais do celular dele.

### Estrutura (branch de teste, depois aprovada e mesclada)

- **Barra lateral virou menu retrátil** — escondida por padrão no celular (fora da tela), abre com um botão ☰ novo no `Topbar`, fecha clicando fora/no X/navegando. Continua sempre visível em telas grandes (`lg:` +), sem mudança nenhuma pra quem usa desktop. `src/components/app-shell.tsx` (novo) segura o estado de aberto/fechado — Sidebar e Topbar são componentes irmãos, então precisavam de um estado compartilhado que `layout.tsx` (Server Component) não pode segurar sozinho.
- **Todas as 13 tabelas do sistema** (clientes, reservas, embarcações, parceiros, equipe, financeiro, admin, dashboard, e as páginas de detalhe de cada uma) ganharam um container com scroll horizontal — antes, numa tela estreita, a tabela estourava a largura da página inteira.
- Vários cabeçalhos de página (`PageHeader` compartilhado + duplicatas manuais em `saidas/[id]`, `parceiros/[id]`, `reservas/[id]`) e cartões com múltiplos botões numa linha só (`departure-row.tsx`, cartão de passageiro em `reservas/[id]`, cartão de saída em `embarcacoes/[id]`) ganharam `flex-wrap`, pra quebrar em mais linhas em vez de cortar conteúdo.

### Ajustes finos (direto na `main`, a partir de prints reais do celular)

- **Sombra fixa nas bordas das tabelas** (`src/components/scroll-shadow-x.tsx`, novo componente) — a barra de rolagem nativa do celular fica escondida por padrão (comportamento do próprio iOS/Android, não dá pra forçar ela a ficar sempre visível). Em vez disso, mostra uma sombra/gradiente fixa na borda direita de qualquer tabela que tenha mais conteúdo pra rolar — fixa de propósito (não acompanha a posição do dedo, só liga/desliga uma vez), depois que a versão que acompanhava o scroll gerou confusão ("por que a sombra sumiu?").
- **Cartão de saída reorganizado em 3 linhas previsíveis** — o `flex-wrap` "solto" de antes deixava os ícones de ação quebrarem de um jeito desorganizado. Agora agrupado explicitamente em blocos (info / status+manifesto / ações) usando `sm:contents` — em telas grandes o agrupamento "some" da hierarquia visual e volta a ser uma linha só, sem duplicar código.
- **Menu de status (confirmada/pendente) trocado de `<select>` nativo pra um menu customizado** (`reservation-status-select.tsx`) — o `<select>` estilizado renderizava errado no Android (ora abria vazio até clicar, ora mostrava o conteúdo da coluna vizinha por baixo do menu aberto). Substituído por um botão com o status como etiqueta colorida + um menu próprio via `React.createPortal` (não fica preso ao overflow da tabela).
- **Menu do menu lateral, rótulos de grupo e cartões de indicador** — pequenos ajustes de cor/tamanho pra caber melhor em telas pequenas (ver seções 34/35 pra mais detalhes de cor do menu).
- **Painel de notificações** (`notifications-bell.tsx`) — era posicionado relativo ao próprio botão do sino (perto da borda direita da tela); num celular estreito, os 288px do painel vazavam pra fora à esquerda. Trocado pra posição fixa ancorada na borda da tela (`fixed right-4 top-16`), com largura máxima limitada ao que cabe na viewport.
- **🔴 Bug de especificidade CSS descoberto e corrigido**: a correção do ícone de busca do Super Admin (seção 35) usou `:where()` em volta de todo o seletor `input:not(...)`, zerando a especificidade da regra por completo — sem querer, isso deixou o padding padrão dos campos de formulário **mais fraco que o próprio reset do Tailwind** (`@tailwind base` zera padding de `input`/`select`/`textarea`). Resultado: nenhum ajuste de padding feito durante a sessão (`px-3`→`px-4`, `py-2`→`py-2.5`) estava de fato sendo aplicado — só o padding mínimo do navegador, por isso o texto continuava "colado" na borda mesmo depois de aumentado várias vezes. Corrigido movendo o `:where()` pra só em volta dos `:not()` (não em volta do seletor inteiro): a regra volta a ter a mesma especificidade de um seletor de elemento comum (empata com o reset do Tailwind, e como vem depois no arquivo, ganha dele), mas continua mais fraca que qualquer classe utilitária normal (`pl-9`, `w-auto`), então a correção original do ícone de busca continua funcionando. **Lição**: `:where()` precisa envolver só a parte do seletor que dava especificidade indesejada (os `:not()`), nunca o seletor inteiro — senão a regra fica fraca demais e perde até pro reset padrão do framework.
- **Autofill do navegador** (`input:-webkit-autofill`) — campos preenchidos automaticamente (login salvo) usam a renderização interna do próprio Chrome, que não respeita nosso padding/cor direito. Corrigido com o truque padrão da indústria (`box-shadow` inset gigante forçando nosso fundo + `-webkit-text-fill-color`).

### Validação

Cada mudança validada individualmente (`tsc --noEmit`, `eslint .`, `next build`) antes do commit. Todas as mudanças de hoje foram só UI/CSS — nenhum controle de acesso ou lógica de negócio alterado. Item 4 da lista de pendências (seção 6) concluído.

## 38. Dois itens técnicos pendentes resolvidos: `middleware.ts` → `proxy.ts` e URL fixa nos e-mails (sessão de 2026-08-19)

Feito logo no início da sessão, antes do trabalho de responsividade (seção 37), como itens 1 e 2 de uma lista de pendências técnicas menores que o dono do produto pediu pra atacar.

- **`middleware.ts` → `src/proxy.ts`**: rodado o codemod oficial (`npx @next/codemod@canary middleware-to-proxy .`), que renomeia o arquivo e a função exportada (`middleware` → `proxy`) automaticamente. Só tirava um aviso de depreciação do Next 16 (seção 32) — sem mudança de comportamento, `updateSession()` (a lógica de verdade) continua igual.
- **`headers().get("origin")` trocado por `NEXT_PUBLIC_SITE_URL` fixa**: usado pra montar o link nos e-mails de reset de senha (`login/actions.ts`) e convite de equipe (`equipe/actions.ts`). Antes dependia do cabeçalho `Origin` da requisição (protegido pela validação nativa de Origin/Host das Server Actions do Next.js, mas ainda assim uma dependência frágil de comportamento de framework pra algo sensível). Criado `src/lib/site-url.ts`: usa `NEXT_PUBLIC_SITE_URL` se estiver setada (produção, `https://nauticflow.com.br`), cai pra `VERCEL_URL` se for um deploy de preview (branch de teste, ver seção 9), e `localhost:3000` em dev. A variável `NEXT_PUBLIC_SITE_URL` foi adicionada na Vercel (ambiente Production) via `vercel env add` antes do deploy, pra não quebrar os e-mails.
- De quebra, confirmado nessa mesma sessão que o "projeto Vercel órfão" (item 3 da lista, `nautic-flow/nauticflow`) não existe — já atualizado na seção 6.

### Validação

`tsc --noEmit`, `eslint .`, `next build` sem erros. Confirmado em produção via `curl -I` que o site continuou respondendo normalmente depois do deploy.

## 39. Webhook do Asaas cadastrado e teste de pagamento de ponta a ponta confirmado (sessão de 2026-08-19)

Descoberta ao checar o painel do Asaas (Integrações → Webhooks): **nenhum webhook tinha sido cadastrado ainda** — era um item pendente desde a seção 20/21, nunca tinha sido feito de verdade (só documentado como "falta fazer").

### O que foi feito

1. Gerado um token novo pro webhook (`crypto.randomBytes(32).toString('hex')`) e sincronizado nos dois lados:
   - Removido o `ASAAS_WEBHOOK_TOKEN` antigo da Vercel (`vercel env rm`) e adicionado o novo (`vercel env add`), ambiente Production.
   - Disparado um redeploy (`vercel --prod`) — variável de ambiente só entra em vigor num deploy novo, não é aplicada em quente nos deploys já no ar.
2. Cadastrado o webhook no painel do Asaas Sandbox: URL `https://nauticflow.com.br/api/webhooks/asaas`, eventos `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` (os dois que `src/app/api/webhooks/asaas/route.ts` já tratava, mas nunca recebia porque não tinha webhook nenhum configurado), webhook habilitado e fila de sincronização ativada.
3. **Teste de ponta a ponta**: criada uma conta nova no site (simulando um cliente real), escolhido um plano em `/planos` → abriu a fatura de verdade no Asaas Sandbox (checkout já confirmado funcionando desde a seção 21) → confirmado o pagamento usando a faixa **"Ações de Sandbox" → "Confirmar pagamento"** (um recurso do próprio Asaas Sandbox pra simular pagamento sem precisar de número de cartão de teste) → voltado pro `/planos` da conta de teste e confirmado que o plano apareceu como **"Plano contratado: Premium, ativa até [30 dias à frente]"**, sem nenhuma ação manual no nosso sistema — confirma que o webhook recebeu o evento, achou a assinatura certa pelo `externalReference` (`company_id`) e atualizou `paid_until`/`status` sozinho.

### Importante

O token novo do webhook **não está escrito neste arquivo de propósito** (é versionado/público) — está salvo só na Vercel (env var, "Sensitive") e no painel do Asaas. Se precisar recadastrar o webhook (ex: perdeu o valor), é preciso gerar um token novo e sincronizar os dois lados de novo, do mesmo jeito.

### Validação

Teste real, não só automatizado: pagamento confirmado no Asaas, webhook recebido, `subscriptions.paid_until` atualizado no banco, tudo refletido na UI sem intervenção manual. Essa era a última verificação que faltava antes de trocar as chaves do Asaas pra produção (ver seção 6, pendência de trocar pra produção quando for lançar de verdade).

## 40. Site institucional / landing page na raiz `/` (sessão de 2026-08-19)

Até aqui o domínio raiz não tinha página institucional: `src/app/page.tsx` fazia `redirect("/dashboard")` e, como `/dashboard` exige login, o visitante caía direto num formulário de login vazio. Esta sessão trouxe uma **landing page pública** pra raiz `/`, pra apresentar o produto, mostrar os planos e converter visitante em cadastro. A landing foi primeiro prototipada como projeto separado (Next 14, pasta irmã `nauticflow-site`, fora do repo) e depois **integrada ao produto real** (Next 16 / React 19), reaproveitando o design system existente.

### O que mudou

- **`src/app/page.tsx`** — deixou de redirecionar e passou a renderizar a landing. É um Server Component **estático** (sai como `○` no `next build`, ótimo pra SEO/performance), com `export const metadata` (title, description, keywords em pt-BR, Open Graph + Twitter) e um bloco JSON-LD (`SoftwareApplication` + `Offer` por plano). O redirecionamento de quem já está logado foi movido pro proxy (abaixo).
- **`src/lib/supabase/middleware.ts`** (o `proxy`) — a raiz virou rota pública. **Cuidado importante**: a allowlist usa `path === "/"` (casamento EXATO), **não** `startsWith("/")` — um `startsWith` abriria o app inteiro sem login. E o redirect de quem tem sessão foi estendido de `path === "/login"` pra incluir também `path === "/"`, então logado que abre a raiz vai direto pro `/dashboard` (preserva o comportamento antigo).
- **`src/app/login/page.tsx`** — passou a ler `?mode=up` da URL (`useSearchParams`, dentro de um limite `<Suspense>` exigido pelo App Router no Next 16) e já abrir na aba **"Crie sua empresa"**. Antes o parâmetro era ignorado e sempre abria em "Entrar". É o que faz o CTA "Começar grátis" (`/login?mode=up`) levar direto ao cadastro. Sem mudança nas server actions.
- **`src/components/marketing/`** (novo) — as seções da landing: `site-header` (nav + `<ThemeToggle/>` + menu mobile), `hero` + `dashboard-mockup` (mockup ilustrativo, sem dados reais), `features`, `how-it-works`, `pricing`, `trust`, `final-cta`, `site-footer`, e `plans.ts` (dados literais dos planos + links/contatos). CTAs são links relativos (`/login`, `/login?mode=up`); rodapé linka `/termos` e `/privacidade`.
- **`src/app/layout.tsx`** — adicionado `metadataBase: new URL("https://nauticflow.com.br")` pra as imagens de OG/Twitter resolverem pro domínio real em vez de `localhost` (tirava um aviso do `next build`).
- **`public/og-image.png`** — imagem Open Graph 1200×630.

### Reaproveitamento (nenhuma dependência nova)

A landing usa o que o produto já tem: fontes Inter/Poppins (já no `layout.tsx`), tokens de tema (`bg-app`, `bg-surface`, `text-heading`/`body`/`muted`, `border-line`), cores `navy`/`brand`, o `<ThemeToggle/>`, o logo real (`/nauticflow-icon.png`) e ícones `lucide-react`. Hero e CTA final ficam em navy fixo (identidade de marca); o resto é reativo ao tema (claro/escuro), consistente com o app.

### Ambiente (achado)

O `node_modules` local estava desatualizado: em **Next 14/React 18**, anterior ao commit de migração pro Next 16 (o lockfile e a Vercel já estavam em **16.3.1/React 19**). Ou seja, o `next dev`/`build` local rodava numa versão diferente da produção. Rodado `npm install` pra sincronizar com o lockfile antes de desenvolver — agora local bate com produção.

### Placeholders deixados (trocar antes de divulgar)

- **Contato** em `src/components/marketing/plans.ts` (`MKT_CONTACT`): **preenchido em 2026-08-20** — WhatsApp `(65) 99240-7699` e e-mail `castrocompny@gmail.com`.
- **Depoimentos**: seção **removida em 2026-08-20** (`src/components/marketing/trust.tsx`) — o dono optou por não ter depoimentos falsos no site no ar; fica só a seção de garantias verificáveis. Reativar quando houver avaliações reais.

### Escopo / segurança

Nenhuma rota do app (`(app)`), Supabase, billing/Asaas, admin ou webhook foi alterada. A única ampliação de acesso foi tornar a **raiz exata** `/` pública no proxy.

### Validação

Deslogado, `/` responde **200** com a landing completa (todos os planos com os valores literais R$147/R$297/R$597); `/login?mode=up` abre na aba de cadastro e `/login` (sem parâmetro) abre em "Entrar"; `/termos` e `/privacidade` seguem 200. `next build` sem erros, com `/` prerenderizada estática e o aviso de `metadataBase` resolvido. Conferido visualmente em claro e escuro, desktop e mobile, e o fluxo CTA "Começar grátis" → cadastro ponta a ponta.

### Ajuste nos cards de planos: botão "Assinar por R$X/mês" + teste grátis separado (mesma sessão)

A pedido do dono, os três cards de planos deixaram de ter cada um o botão "Começar teste grátis" e passaram a ter o **valor real como ação**: o botão virou **"Assinar por R$147/mês"** (etc.), e o teste grátis foi **separado** num bloco único abaixo dos três cards ("Quer testar antes de assinar? · Começar teste grátis"). O botão de assinar de cada card **sinaliza o plano escolhido** e leva a pré-seleção pra dentro do sistema:

- **`src/components/marketing/pricing.tsx`** — botão do card = `Assinar por {preço}{período}`, link `/login?mode=up&plan=<code>` (`code` = `start`/`profissional`/`premium`, os mesmos da tabela `plans`). Bloco de teste grátis separado logo abaixo, apontando pra `/login?mode=up` (sem plano).
- **`src/app/login/page.tsx`** — lê `?plan=` da URL (validando contra os 3 códigos; lixo é ignorado) e injeta um `<input type="hidden" name="plan">` no formulário de cadastro.
- **`src/app/login/actions.ts`** (`signUp`) — lê o `plan` do form (revalidado) e, quando o cadastro já cria sessão, redireciona pra `/planos?plan=<code>` em vez de `/dashboard`. Sem plano, segue pro dashboard como antes. **Não** mexe no gatilho do banco nem no fluxo de pagamento (Asaas).
- **`src/app/(app)/planos/page.tsx`** — passou a receber `searchParams` (assíncrono no Next 16, `await props.searchParams`) e **destaca** o card do plano escolhido (borda + `ring` + selo "PLANO ESCOLHIDO NO SITE"), onde o usuário conclui o pagamento com o `PayPlanButton` que já existia.

Como não existe pagamento sem conta (checkout real é interno, via Asaas), o "Assinar" da landing continua passando pelo cadastro — só que agora carrega qual plano foi escolhido até a tela de planos. `next build` sem erros; `/` e `/login` estáticas, `/planos` dinâmica. Validado por HTML servido: botões "Assinar por…", `href` com `&plan=` codificado, `<input hidden name="plan">` presente pra plano válido e ausente pra valor inválido.

## 41. Landing: FAQ, "pra quem é", botão de WhatsApp e analytics (sessão de 2026-08-20)

Rodada de melhorias na landing pra aumentar conversão e confiança, depois de decidir remover os depoimentos (não ter nada falso, ver seção 40). Tudo com conteúdo verdadeiro, baseado no produto real.

- **FAQ** (`src/components/marketing/faq.tsx`, seção `#faq`, novo item "Perguntas" no menu) — 9 perguntas que derrubam as objeções típicas do público (precisa saber mexer em computador?, funciona no celular?, precisa de cartão pra testar?, como o cliente recebe o voucher?, posso cancelar?, cobram comissão por reserva?, serve pro meu tipo de embarcação?, meus dados ficam seguros?, como é o suporte?). Acordeão nativo com `<details>/<summary>` (zero JS). Emite **FAQPage JSON-LD** pra o Google poder mostrar as perguntas na busca.
- **"Pra quem é"** (`src/components/marketing/audience.tsx`) — faixa logo abaixo do hero com os tipos de operação atendidos (escuna, lancha, jet-ski, catamarã, marinas/operadores), pro visitante se reconhecer de cara.
- **Botão flutuante de WhatsApp** (`src/components/marketing/whatsapp-button.tsx`) — canto inferior direito, cor da marca do WhatsApp, com mensagem pré-preenchida, `target="_blank"` + `rel="noopener noreferrer"`. Usa o número real já configurado em `MKT_CONTACT`.
- **Vercel Web Analytics** — adicionado `@vercel/analytics` (v2) e `<Analytics/>` no layout raiz (`src/app/layout.tsx`). É **cookieless e não coleta PII**, então não exige banner de consentimento (LGPD ok). Endpoints são same-origin (`/_vercel/insights`), compatível com a CSP atual. **⚠️ Pendência**: só coleta de verdade depois de **ativar "Web Analytics" no painel da Vercel** (projeto → aba Analytics → Enable); sem isso o `<Analytics/>` é inofensivo/no-op.

### Mockup do hero refeito fiel ao produto real (2026-08-20)

Com base em prints reais da conta de teste (dashboard, agenda, saídas), o `dashboard-mockup.tsx` foi **reescrito pra espelhar o layout de verdade do NauticFlow** — sidebar, KPIs com os ícones/cores certos (Reservas, Receita, Ocupação, Passageiros), "Receita" com toggle de período (7/30/90 dias) que **anima o gráfico**, e "Próximas saídas". **De propósito não colamos os prints crus**: a conta de teste tinha dados vazios (R$ 700, 0%, "Sem dados ainda") e mostrava o menu "Super Admin" — ficaria feio e exporia a conta. Em vez disso é uma recriação em HTML/CSS (nítida em qualquer tela, leve, interativa) com números ilustrativos saudáveis, fixa no tema escuro (como o app real). Virou client component, mas `/` continua prerenderizada estática.

### Ainda pendente (precisa de ação do dono)

- **Ativar o Web Analytics na Vercel** (ver acima).

### Validação

`eslint .` (0 erros, só os warnings de `<img>` já existentes) e `next build` exit 0 — `/` continua prerenderizada estática. Conferido por HTML servido: seção FAQ + FAQPage JSON-LD, faixa "pra quem é", botão de WhatsApp e o item "Perguntas" no menu, todos presentes.

## 42. Planos anuais (toggle Mensal/Anual, ciclo YEARLY no Asaas) — sessão de 2026-08-20

Adicionada a opção de **cobrança anual** além da mensal, com **2 meses grátis** (anual = 10× o mensal): Start **R$1.470/ano**, Profissional **R$2.970/ano**, Premium **R$5.970/ano** (~17% de desconto).

**Por que mexeu em tanta coisa:** todo o billing era mensal e três pontos somavam prazo fixo em +30 dias (webhook do Asaas, renovação do admin, trial). O Asaas fixava `cycle: "MONTHLY"`. Como o webhook descobre a assinatura pela empresa (não sabe o ciclo do pagamento), o ciclo precisou virar coluna **na subscription** pra ele somar 30 ou 365 dias.

- **Migration `0020_planos_anuais.sql`** (⚠️ **precisa ser aplicada no Supabase pelo dono**):
  - `subscriptions.billing_cycle` (`mensal|anual`, default `mensal`) — fonte da verdade do prazo.
  - `plans.price_cents_yearly` + seed 147000/297000/597000.
  - `link_asaas_subscription` recriada com 4º arg `p_billing_cycle` (grava o ciclo na subscription).
- **`src/lib/asaas.ts`** — `createSubscription` aceita `cycle: MONTHLY|YEARLY`.
- **`billing-actions.ts`** — `startAsaasCheckout(planCode, billingCycle)`: escolhe preço mensal/anual, manda YEARLY/MONTHLY pro Asaas, passa o ciclo pra RPC.
- **Webhook (`api/webhooks/asaas/route.ts`)** e **renovação do admin (`admin/actions.ts`)** — leem `billing_cycle` e somam **365** (anual) ou **30** (mensal). Botão do admin virou "Renovar assinatura" (o prazo é resolvido no servidor).
- **`/planos` do app** — extraído `plan-cards.tsx` (client) com toggle **Mensal/Anual**; preço e ciclo certos; `PayPlanButton` repassa o ciclo. Respeita `?cycle=` vindo do cadastro.
- **Landing** — `pricing.tsx` virou client com toggle Mensal/Anual (mostra 1.470/2.970/5.970 + "2 meses grátis · economize X"); "Assinar" leva `/login?mode=up&plan=X&cycle=anual`. `login/page.tsx` + `signUp` carregam `?cycle=` (validado) até `/planos?plan=X&cycle=anual`. `MKT_PLANS` ganhou `priceYear`/`economiaYear`.

**Nota (gap pré-existente):** trocar de plano/ciclo cria uma assinatura NOVA no Asaas sem cancelar a antiga — já acontecia ao trocar entre planos mensais. Fica pra tratar depois (cancelar a `asaas_subscription_id` antiga ao criar a nova), fora do escopo do anual.

### Validação

`next build` exit 0 e `eslint .` sem erros; `/` e `/login` seguem estáticas. Conferido por HTML: toggle Mensal/Anual na landing, preços anuais (R$1.470/2.970/5.970) e badge "2 meses grátis", e o login carregando `plan`+`cycle` como campos ocultos. **Falta testar ponta a ponta** (checkout YEARLY → webhook soma 365) — só é possível **depois de aplicar a migration** e no Sandbox do Asaas. **(Atualização: migration aplicada e testada com sucesso pelo dono em 2026-08-20 — planos anuais em produção.)**

### Favicon `.ico` — logo aparecendo nos previews de link

Nos previews de link (busca do Google, cards de chat) o site aparecia com um **globo genérico** em vez da logo. Causa: a home só declarava `<link rel="icon" href="/favicon.png">` e **`/favicon.ico` dava 404** — muitos crawlers pedem `/favicon.ico` direto por padrão e, sem ele, caem no globo. O `favicon.png` (a logo barco+onda de [public/favicon.png](public/favicon.png)) estava certo, só faltava o `.ico`.

- Gerado **`public/favicon.ico`** de verdade (container ICO com PNGs 16/32/48px) a partir do `favicon.png`, usando o `sharp` que já vem com o Next (script temporário, apagado depois). Também **`public/apple-icon.png`** 180×180 (fundo branco, iOS não curte transparência).
- [src/app/layout.tsx](src/app/layout.tsx): `metadata.icons` ampliado pra `icon: [/favicon.ico (sizes any), /favicon.png]` + `apple: /apple-icon.png`. HTML passou a emitir os 3 `<link>` e `/favicon.ico` serve 200.
- **Observação:** aba do navegador atualiza na hora; previews de Google/apps de chat têm **cache** e podem demorar a re-buscar o favicon (dá pra forçar re-scan em ferramentas de teste de link, mas o normal é atualizar sozinho em alguns dias).

**De quebra — `robots.txt` + `sitemap.xml` (mesma investigação):** ao checar por que o Google não atualizava, descobri que **`/robots.txt` retornava 307** (o `proxy` de auth redirecionava pro `/login`) e **não havia sitemap**. Isso não bloqueia o Google, mas atrapalha o rastreio. Corrigido: `src/proxy.ts` passou a excluir `robots.txt`/`sitemap.xml` do matcher, e criados `src/app/robots.ts` (allow all + link do sitemap) e `src/app/sitemap.ts` (home). Confirmado que servem 200. **Nota:** o Google mostrar dado antigo (título "NauticFlow" / "Gestão inteligente para o turismo náutico", de antes da landing) é sinal de que ele ainda não re-rastreou — quando re-rastrear, favicon + título + descrição atualizam juntos. Acelera via Search Console → Inspecionar URL → Solicitar indexação.
