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

- ~~Auditoria de segurança + correção controlada (rate limiting, RPCs/grants legados, exposição de erros, logging, Storage órfão, open redirect)~~ — **resolvido** (ver seção 74, sessão de 2026-08-28). Deploy em produção confirmado, `DEPLOY CONCLUÍDO — GO`. **5 pendências técnicas não-bloqueantes registradas ali** (TTL de `api_rate_limits`, rate limit global da API pública, rate limit de auth vs. botnet distribuída, caminho de falha na deduplicação do webhook Asaas, migrations históricas `0000b`/`0000c`/`0032`/`0033`) — nenhuma é vulnerabilidade em aberto, todas candidatas a rodada futura de manutenção/confiabilidade. **Antes de propor qualquer coisa relacionada a isso, ver seção 74 primeiro.**
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
- ~~Aplicar a migration `0020_planos_anuais.sql` no Supabase~~ — **resolvido** (ver seção 42). Aplicada e testada com sucesso pelo dono em 2026-08-20; planos anuais funcionando em produção.
- **Logo da empresa** — ideia levantada pelo dono (2026-08-20): permitir subir uma imagem/logo da empresa pra trocar o círculo com a inicial do nome (sidebar, cabeçalho, e talvez o voucher por e-mail). Avaliado e **adiado de propósito**: dá trabalho real (upload de arquivo, Supabase Storage, validação/redimensionamento de imagem, trocar o avatar em vários lugares do sistema) e não é algo que trava ninguém de usar o sistema hoje — fica pra quando a base de clientes crescer e a demanda por personalização visual aparecer de verdade.
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

### Seção "Veja por dentro" — 3 telas do produto recriadas (2026-08-20)

Pra "mostrar" mais o produto (não só descrever com texto/ícones), adicionada a seção **"Veja por dentro"** (`src/components/marketing/showcase.tsx`), entre "Como funciona" e "Planos": 3 telas no formato **imagem + texto alternado** — **Agenda** (grade por horário), **Voucher automático** (a peça que o cliente recebe por e-mail) e **Manifesto de embarque** (lista de passageiros). São **recriações em HTML fiéis ao layout real** (opção A — não são prints da conta de teste), com **dados de exemplo fictícios e limpos** (nomes genéricos, sem dado real, sem menu de super admin). Telas do app no tema escuro (como o produto); o voucher em card claro porque é um e-mail pro cliente. `next build` exit 0 e `/` segue estática.

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

**Nota (gap pré-existente):** trocar de plano/ciclo cria uma assinatura NOVA no Asaas sem cancelar a antiga — já acontecia ao trocar entre planos mensais. **Resolvido em 2026-08-20, ver seção 47.**

### Validação

`next build` exit 0 e `eslint .` sem erros; `/` e `/login` seguem estáticas. Conferido por HTML: toggle Mensal/Anual na landing, preços anuais (R$1.470/2.970/5.970) e badge "2 meses grátis", e o login carregando `plan`+`cycle` como campos ocultos. **Falta testar ponta a ponta** (checkout YEARLY → webhook soma 365) — só é possível **depois de aplicar a migration** e no Sandbox do Asaas. **(Atualização: migration aplicada e testada com sucesso pelo dono em 2026-08-20 — planos anuais em produção.)**

### Favicon `.ico` — logo aparecendo nos previews de link

Nos previews de link (busca do Google, cards de chat) o site aparecia com um **globo genérico** em vez da logo. Causa: a home só declarava `<link rel="icon" href="/favicon.png">` e **`/favicon.ico` dava 404** — muitos crawlers pedem `/favicon.ico` direto por padrão e, sem ele, caem no globo. O `favicon.png` (a logo barco+onda de [public/favicon.png](public/favicon.png)) estava certo, só faltava o `.ico`.

- Gerado **`public/favicon.ico`** de verdade (container ICO com PNGs 16/32/48px) a partir do `favicon.png`, usando o `sharp` que já vem com o Next (script temporário, apagado depois). Também **`public/apple-icon.png`** 180×180 (fundo branco, iOS não curte transparência).
- [src/app/layout.tsx](src/app/layout.tsx): `metadata.icons` ampliado pra `icon: [/favicon.ico (sizes any), /favicon.png]` + `apple: /apple-icon.png`. HTML passou a emitir os 3 `<link>` e `/favicon.ico` serve 200.
- **Observação:** aba do navegador atualiza na hora; previews de Google/apps de chat têm **cache** e podem demorar a re-buscar o favicon (dá pra forçar re-scan em ferramentas de teste de link, mas o normal é atualizar sozinho em alguns dias).

**De quebra — `robots.txt` + `sitemap.xml` (mesma investigação):** ao checar por que o Google não atualizava, descobri que **`/robots.txt` retornava 307** (o `proxy` de auth redirecionava pro `/login`) e **não havia sitemap**. Isso não bloqueia o Google, mas atrapalha o rastreio. Corrigido: `src/proxy.ts` passou a excluir `robots.txt`/`sitemap.xml` do matcher, e criados `src/app/robots.ts` (allow all + link do sitemap) e `src/app/sitemap.ts` (home). Confirmado que servem 200. **Nota:** o Google mostrar dado antigo (título "NauticFlow" / "Gestão inteligente para o turismo náutico", de antes da landing) é sinal de que ele ainda não re-rastreou — quando re-rastrear, favicon + título + descrição atualizam juntos. Acelera via Search Console → Inspecionar URL → Solicitar indexação.

## 43. Painel `/admin` não tinha acompanhado os planos anuais da seção 42 (sessão de 2026-08-20)

A seção 42 colocou o ciclo anual em todo o fluxo de cobrança (checkout, webhook, RPC), mas o painel `/admin` ficou pra trás — auditoria pedida pelo dono do produto depois de revisar o que tinha mudado no dia. Três problemas achados:

1. **MRR inflado**: o card "MRR" somava `plans.price_cents` (preço mensal cheio) pra qualquer assinatura paga, inclusive as anuais. Um cliente anual de R$5.970/ano contava como se pagasse R$597/**mês**, em vez do equivalente real (~R$497,50/mês).
2. **Ciclo invisível**: nem a lista de empresas nem a página de detalhe mostravam se o cliente era mensal ou anual — só dava pra saber olhando o banco direto.
3. **Renovação manual sem opção de ciclo**: o botão "Renovar assinatura" (usado quando o dono recebe pagamento fora do Asaas, ex: PIX) só sabia renovar mensal; pra um cliente anual pagando fora do fluxo automático, a renovação gravaria o ciclo errado.

Corrigido em [src/app/admin/page.tsx](src/app/admin/page.tsx), [src/app/admin/[id]/page.tsx](src/app/admin/[id]/page.tsx), [src/app/admin/actions.ts](src/app/admin/actions.ts) e [src/app/admin/renew-button.tsx](src/app/admin/renew-button.tsx):
- MRR normaliza anual pelo valor mensal equivalente (`price_cents_yearly / 12`).
- Lista de empresas e ficha da empresa mostram "(mensal)"/"(anual)" ao lado do plano; histórico de assinaturas ganhou coluna "Ciclo".
- `RenewButton` ganhou seletor de ciclo (padrão = ciclo atual da assinatura), preço exibido no botão já reflete a escolha, e `renewSubscription` grava o `billing_cycle` certo.

`tsc --noEmit` e `next build` passaram limpos. Subido direto pro `main` (correção só do painel interno, não afeta cliente final).

## 44. Cliente pode cancelar a própria assinatura em `/planos` (sessão de 2026-08-20)

Pedido do dono do produto: quem não quiser mais usar o NauticFlow precisa conseguir parar de ser cobrado sem ter que pedir suporte manualmente (nem continuar levando cobrança no cartão/Pix mês a mês contra a vontade).

- **`src/lib/asaas.ts`** — nova `cancelSubscription(subscriptionId)`, `DELETE /subscriptions/{id}` no Asaas (para as cobranças futuras). Idempotente: se o Asaas já não tiver mais essa assinatura (404), trata como sucesso. `asaasFetch` passou a aceitar `DELETE` e a devolver o `status` HTTP no erro (antes só a mensagem), pra dar pra distinguir 404 de erro de verdade sem depender de procurar "404" dentro do texto.
- **`billing-actions.ts`** — `cancelAsaasSubscription()`: só `company_admin`/`super_admin` pode cancelar (mesma regra de quem exclui a conta, ver seção 22/`configuracoes/actions.ts`). Busca a assinatura mais recente da empresa pelo `company_id` da sessão (sem receber id de fora — sem brecha de IDOR), cancela no Asaas, e só depois marca `status: "cancelada"` no banco usando o client `service_role` (a RLS de `subscriptions` só deixa `super_admin` escrever direto — migration `0007`). **Não mexe em `paid_until`**: a empresa mantém acesso normal até a data que já tinha pago, só não renova mais sozinha depois (porque não sobra assinatura ativa no Asaas gerando cobrança nova).
- **`planos/cancel-subscription-button.tsx`** (novo) + `planos/page.tsx` — botão "Cancelar assinatura" com confirmação, visível só pro admin da empresa e só quando existe assinatura paga via Asaas (`asaas_subscription_id` preenchido e `status != "cancelada"`) — quem está no período de teste não vê o botão, porque não há cobrança recorrente pra cancelar. Depois de cancelada, a página mostra um aviso "cancelada, acesso até X" no lugar do botão; pra voltar, é só assinar de novo normalmente (mesmo fluxo dos outros planos).

`tsc --noEmit`, `eslint` e `next build` passaram limpos. Revisão de segurança: sem novo IDOR (busca sempre pelo `company_id` da sessão), permissão checada no servidor (não só escondendo o botão no client), e o único uso do client `service_role` é a atualização final de status, depois que o cancelamento no Asaas já foi confirmado.

## 45. Botão "Gerenciar plano" em Configurações e "Zona de perigo" mais segura (sessão de 2026-08-20)

Dois ajustes pedidos pelo dono depois de revisar a tela de Configurações.

**Botão "Gerenciar plano"**: o card "Plano contratado" em `/configuracoes` não linkava pra lugar nenhum — só dava pra chegar em `/planos` pelo atalho do rodapé da sidebar. Adicionado um botão azul preenchido (`bg-brand`, mesmo estilo dos outros botões de ação — a primeira versão em outline ficou "apagada demais" no feedback dele) levando pra `/planos`.

**"Zona de perigo" (excluir conta/empresa) — menos chamativa, mais segura**: o dono pediu pra reduzir o quanto a caixa vermelha chamava atenção na tela por padrão, e reforçar a proteção contra clique acidental ou alguém com acesso ao computador dele já logado (sem saber a senha).

- [delete-account-form.tsx](src/app/(app)/configuracoes/delete-account-form.tsx): por padrão aparece só um botão vermelho compacto ("Excluir empresa e conta") — identifica que é perigoso sem ocupar a tela com a caixa/texto de aviso o tempo todo. Só ao clicar é que aparece a caixa completa com o aviso e o formulário (senha + confirmação).
- [configuracoes/actions.ts](src/app/(app)/configuracoes/actions.ts): `deleteMyAccount` agora exige a **senha da conta** antes de apagar qualquer coisa, reautenticando via `supabase.auth.signInWithPassword(email, senha)` — antes a única barreira era digitar o nome da empresa, que aparece na sidebar/cabeçalho pra qualquer um ver, então não protegia de verdade. Sem a senha certa, a exclusão nem chega a rodar. Continua pedindo o nome da empresa (ou "EXCLUIR") como segunda confirmação, igual antes.

**Iterações de visual feitas depois, no mesmo dia** (feedback direto do dono a cada print): o botão fechado perdeu o ícone de alerta e a borda vermelha (só texto vermelho, borda neutra — "mais profissional"); e o formulário de senha+confirmação virou um **modal de verdade** (fundo escurecido, `createPortal` pro `document.body`, título com X, fecha com X/clique fora/Esc), inspirado no modal de exclusão de conta do Discord que o dono mostrou como referência.

`tsc --noEmit`, `eslint` e `next build` passaram limpos.

## 46. E-mail da empresa unificado com o e-mail de login (sessão de 2026-08-20)

A tela de Configurações tinha dois campos de e-mail: "E-mail da empresa" (`companies.email`, praticamente sempre vazio) e o e-mail de login do administrador (`profiles.email`, o que a empresa realmente usa todo dia). O dono achou os dois campos confusos e pediu pra unificar, usando o e-mail de login como o único e-mail da empresa.

- [settings-form.tsx](src/app/(app)/configuracoes/settings-form.tsx) + [configuracoes/actions.ts](src/app/(app)/configuracoes/actions.ts): campo "E-mail da empresa" removido do formulário; `updateSettings` parou de escrever em `companies.email` (a coluna continua existindo no banco, só não é mais lida/editada pelo app).
- [billing-actions.ts](src/app/(app)/billing-actions.ts): `startAsaasCheckout` agora manda `profile.email` (login) como e-mail do cliente pro Asaas, em vez de `company.email` — é o e-mail que efetivamente recebe as notificações de cobrança agora.
- [admin/[id]/page.tsx](src/app/admin/[id]/page.tsx): a ficha da empresa no painel admin mostra o e-mail de login do administrador (busca `profiles.email` do `company_admin` da empresa) em vez do campo `companies.email`, que ficava vazio na maioria dos casos.

`tsc --noEmit`, `eslint` e `next build` passaram limpos.

## 47. 🔴 Corrigido bug de cobrança dupla ao trocar de plano com assinatura ativa (sessão de 2026-08-20)

Pedido do dono pra verificar: "quando um cliente no plano Start troca pro Profissional já assinando, dá algum erro?" **Não dava erro nenhum visível — o problema era pior, silencioso.**

**O que acontecia:** `startAsaasCheckout` sempre criava uma assinatura **nova** no Asaas e sobrescrevia a única linha de `subscriptions` da empresa com o novo `asaas_subscription_id`. A assinatura **antiga nunca era cancelada** — ficava lá, ativa, cobrando sozinha por fora, e como o banco só guarda 1 assinatura por empresa (a referência da antiga se perde na hora do `update`), não tinha mais como localizar/cancelar ela nem pelo painel admin. Resultado possível: cliente pagando **dois planos ao mesmo tempo** sem ninguém perceber até olhar o extrato. Esse gap já tinha sido anotado na seção 42 mas nunca corrigido.

**Correção em [billing-actions.ts](src/app/(app)/billing-actions.ts):** `startAsaasCheckout` agora busca a assinatura atual da empresa antes de criar a nova; se existir uma `asaas_subscription_id` ainda não cancelada, chama `cancelSubscription()` (mesma função da seção 44) **antes** de criar a nova assinatura no Asaas. Se o cancelamento falhar, a troca de plano é abortada com erro em vez de seguir e criar a cobrança duplicada. Vale tanto pra trocar de plano quanto pra trocar de ciclo (mensal↔anual) ou renovar manualmente pagando de novo.

`tsc --noEmit`, `eslint` e `next build` passaram limpos.

## 48. Logo sumia na prévia compacta de link do WhatsApp (`og-image.png`) (sessão de 2026-08-20)

Dono percebeu que ao compartilhar `nauticflow.com.br` no WhatsApp, o cartão grande (o que aparece enquanto se digita a mensagem, antes de enviar) mostrava a logo certinha, mas a versão compacta da mensagem já **enviada** aparecia sem logo, só texto genérico.

**Causa:** `public/og-image.png` é 1200×630 (bem mais largo que alto), com a logo posicionada no canto superior esquerdo. O cartão grande do WhatsApp respeita a proporção original (logo visível), mas a versão compacta **recorta a imagem num quadrado central** (~630×630, cortando as bordas laterais) — como a logo ficava bem na pontinha esquerda, fora dessa área central, o corte cortava ela fora.

**Primeira correção:** recentralizada a logo (ícone + "NauticFlow") horizontalmente na imagem, mantendo o resto do design (headline, subtexto, botão "Teste grátis", domínio). Resolvia o corte, mas o dono preferiu ir mais longe.

**Segunda correção:** tirar todo o texto de marketing da imagem — sem headline, subtexto, botão nem domínio — e deixar só a logo grande e centralizada sobre o fundo em gradiente da marca.

**Correção final (pedido do dono):** o ícone usado até aqui no `og-image.png` era um desenho simplificado (veleiro laranja num quadrado azul) que **não é o logo de verdade do produto** — só existia dentro dessa imagem, sem ligação com o resto do site. O logo real, usado em todo o app (`src/components/logo.tsx`, sidebar/header), é `public/nauticflow-icon.png` (o iate detalhado + onda). `og-image.png` refeito com esse logo real: cartão branco arredondado (mesmo tratamento do `Logo.tsx` — fundo branco fixo pro casco escuro do barco ficar visível sobre o navy) + "NauticFlow" ao lado, centralizado sobre o gradiente. Validado de novo no recorte quadrado central.

**Nota (inconsistência que sobrou, não mexida ainda):** o favicon (`favicon.ico`/`favicon.png`/`apple-icon.png`, seção 27/42) usa um **terceiro** desenho (só as ondas, sem o barco visível) — diferente tanto do logo real (`nauticflow-icon.png`) quanto do antigo ícone do `og-image.png`. Unificar fica pra quando o dono confirmar que quer.

**Nota:** depois do deploy, o WhatsApp/Google podem continuar mostrando a prévia antiga por um tempo (cache do link) — tende a atualizar sozinho em alguns dias; dá pra forçar re-scan em ferramentas de teste de link (ex: o "Sharing Debugger" do próprio Facebook/Meta, que também é usado pelo WhatsApp).

### Google Search Console verificado + reindexação solicitada (mesma sessão)

Pra acelerar o Google re-rastrear o site (título/descrição/favicon antigos apareciam na busca, sinal de que ele não tinha visitado de novo desde a landing nova — ver seção 40), o dono criou a propriedade `https://nauticflow.com.br` no Google Search Console.

- Verificação de propriedade via **Tag HTML**: adicionada `verification.google` no `metadata` de [src/app/layout.tsx](src/app/layout.tsx) (gera `<meta name="google-site-verification" content="...">` no `<head>` de toda página). **Não remover essa entrada** — se sumir, a propriedade perde a verificação.
- Depois de verificado, usado "Inspecionar URL" → **"Solicitar indexação"** pra `https://nauticflow.com.br`, colocando a página numa fila de rastreamento prioritário (mais rápido que esperar o Google visitar sozinho).
- Resultado esperado em algumas horas a poucos dias: título, descrição e favicon nos resultados de busca do Google atualizam juntos, refletindo a landing page atual.

## 49. Menu da landing com efeito vidro adaptativo + bug de opacidade do Tailwind na raiz (sessão de 2026-08-20)

Pedido do dono, olhando o site publicado: o menu (`site-header.tsx`) fica em cima do hero (sempre navy), e no modo claro o texto ficava com contraste ruim contra esse fundo. Foram **várias iterações** até chegar no resultado final, cada uma testada com print real enviado pelo dono direto do site — vale registrar o caminho porque no meio dele apareceu um bug de raiz que vinha sendo a causa de todas as tentativas frustradas.

**Comportamento final do menu:**
- **No topo da página** (hero visível, mas sem ter rolado): fundo branco sólido, letra escura.
- **Rolando um pouco, ainda em cima do hero**: efeito vidro (translúcido + blur) sobre o navy, letra branca.
- **Depois que o hero sai de vista**: efeito vidro sobre fundo claro, letra escura.

Detectado com `IntersectionObserver` no próprio hero (`id="topo"`, ver [hero.tsx](src/components/marketing/hero.tsx)) combinado com a posição de scroll — não um número fixo de pixels rolados, porque o hero tem altura variável (mobile/desktop, quebra de linha do título).

**🔴 Causa raiz achada no meio do processo (afeta o projeto inteiro, não só a landing):** `bg-surface` e `bg-app` — usados em praticamente toda a interface (cards, painéis, fundo de página) — **nunca deram suporte ao modificador de opacidade do Tailwind** (`bg-surface/90`, `bg-app/60` etc.). Eles apontavam direto pro hex da variável CSS (`surface: "var(--bg-surface)"`), e o Tailwind só consegue aplicar opacidade em cores que seguem o padrão `rgb(var(...) / <alpha-value>)` — sem isso, a opacidade era **silenciosamente ignorada**, sem erro nenhum. Foi por causa disso que toda tentativa de deixar o menu "quase branco e translúcido" falhava do mesmo jeito, não importa qual opacidade eu tentasse (60%, 90%, 95%, 98%) — só funcionava 100% opaco (sem modificador nenhum).

**Correção na raiz** ([tailwind.config.ts](tailwind.config.ts) + [globals.css](src/app/globals.css)): criadas `--bg-app-rgb`/`--bg-surface-rgb` (formato "r g b" sem vírgula, mesmo padrão que `--bg-surface-hover-rgb` já usava corretamente) ao lado dos hex existentes (que continuam usados direto em CSS puro, ex: o box-shadow do autofill), e `app`/`surface` no Tailwind passaram a usar `rgb(var(...) / <alpha-value>)`. Não muda a aparência de nada que já usava essas cores sem opacidade — só destrava o modificador `/NN` que nunca funcionou.

**Outros ajustes da mesma leva:**
- [site-header.tsx](src/components/marketing/site-header.tsx): header virou `fixed` (antes era `sticky`) — não reserva espaço no fluxo, então o hero começa exatamente no topo, atrás do header, em vez de deixar um vão claro antes dele começar.
- [hero.tsx](src/components/marketing/hero.tsx): padding-top do conteúdo aumentado (compensa a altura do header, que não empurra mais o conteúdo pra baixo sozinho).
- [trust.tsx](src/components/marketing/trust.tsx): a pedido do dono, a seção "Confiança e segurança" virou um bloco navy fixo (mesma cor do hero/CTA final) — quebra a sequência de seções brancas empilhadas, dá ritmo visual à página.
- [theme-toggle.tsx](src/components/theme-toggle.tsx): ganhou uma prop opcional `borderClassName` (mantém o padrão de sempre pra quem usa sem passar nada) — a borda padrão ficava quase invisível em cima do fundo branco do topo da landing.

Validado com screenshots reais tirados localmente (Playwright, instalado só pra esse teste, não ficou como dependência do projeto) antes de mandar pro dono conferir — inclusive foi assim que a causa raiz da opacidade foi finalmente encontrada, comparando a classe CSS computada de verdade contra o que devia estar sendo aplicada. `tsc --noEmit`, `eslint` e `next build` passaram limpos. Revisão de segurança: só mudanças visuais/CSS, sem escopo de segurança.

## 50. Novo tipo de embarcação: "Táxi marítimo" (sessão de 2026-08-20)

A pedido do dono, adicionado **Táxi marítimo** aos tipos de embarcação (aparece no dropdown "Tipo" do cadastro/edição, entre Catamarã e Outro).

- **Migration `0021_tipo_embarcacao_taxi_maritimo.sql`** (⚠️ **aplicar no Supabase antes do deploy**): recria o `CHECK` de `vessels.type` incluindo `'taxi_maritimo'` — sem ela, cadastrar/editar como táxi marítimo falha no constraint (os outros tipos seguem funcionando).
- Código: `src/lib/types.ts` (`VesselType`), os dois selects (`new-vessel-form.tsx`, `vessel-edit-form.tsx`) e os dois mapas de rótulo (`vessel-row.tsx`, `embarcacoes/[id]/page.tsx`). A server action de embarcação não valida `type` contra whitelist — o único gate é o constraint do banco.

`next build` exit 0. Ordem de deploy: **migration primeiro**, depois o push do código.

## 51. Passeios: fim das duplicatas + botão de excluir (sessão de 2026-08-20)

O dropdown "Passeio" (form de nova saída) enchia de duplicatas porque criar saída com "Novo passeio..." + nome digitado **sempre inseria um tour novo**, sem checar se já existia igual (ex.: "ilha do japa" e "Manguinhos" apareciam 2× cada). Isso também dividia o ranking de "passeios mais vendidos". Três correções:

- **Evita novas duplicatas** — `src/app/(app)/saidas/actions.ts`: antes de inserir um passeio novo, procura um passeio **ativo** da empresa com o mesmo nome ignorando maiúsculas/acento (`normalizeTourName`) e **reaproveita** em vez de duplicar.
- **Botão de excluir passeio** — a pedido do dono, a lixeira fica **dentro do próprio dropdown "Passeio"** (ao lado de cada nome), não num painel separado. Como um `<select>` nativo não permite botões nas opções, o select virou um dropdown customizado (`saidas/passeio-picker.tsx`, client): mostra "Novo passeio..." + cada passeio com uma lixeira; a escolha vai num input escondido `tour_id` (form inalterado). A action `deleteTour`: se o passeio **não tem saídas**, apaga de vez; se **tem** (a FK `departures.tour_id` é `on delete restrict`), **desativa** (`active=false`) — some da lista, mas o histórico das saídas fica intacto. (Um painel "Passeios cadastrados" separado chegou a ser feito e depois removido a pedido do dono.)
- **Migration `0022_passeios_dedup.sql`** (⚠️ **rodar no Supabase** pra limpar o que já existe): junta os duplicados por empresa (mesmo nome, ignorando maiúsculas/espaços) num canônico (repointa as saídas, apaga os extras) e cria um **índice único parcial** `(company_id, lower(btrim(name))) where active` como rede de segurança. Sem dependência de ordem com o deploy do código (o código já previne dupes novas sozinho); a migration é a limpeza do backlog.

`next build` exit 0, `eslint` sem erros novos.

## 52. Olhinho de mostrar/ocultar senha + checkbox "Lembre-me" (sessão de 2026-08-22)

- **Olhinho nos campos de senha** — novo componente `src/components/password-input.tsx` (`PasswordInput`): input com botão de olho (ícone `Eye`/`EyeOff` do lucide) que alterna `type="password"`/`type="text"`. Aplicado em todo campo de senha do sistema: login, criar conta (`src/app/login/page.tsx`), redefinir senha (`src/app/redefinir-senha/page.tsx`) e confirmação de senha no modal de excluir conta (`src/app/(app)/configuracoes/delete-account-form.tsx`).
- **Checkbox "Lembre-me"** — em login e criar conta, marcado por padrão. `src/lib/supabase/server.ts`: `createClient()` ganhou o parâmetro opcional `{ persistSession }`; quando `persistSession === false`, o `setAll` dos cookies remove `maxAge`/`expires` da opção antes de gravar, virando **cookie de sessão do navegador** (some ao fechar o navegador) em vez do cookie persistente que o `@supabase/ssr` define por padrão. `src/app/login/actions.ts` (`signIn`/`signUp`) lê o checkbox `remember` do formulário e repassa pro `createClient`. Não altera `httpOnly`/`secure`/`sameSite` nem a validade real do token no Supabase — só o tempo de vida do cookie no navegador.

`tsc --noEmit` limpo. Testado visualmente com Playwright contra o dev server (login, criar conta, redefinir senha).

## 53. Botão "Reenviar convite" na Equipe (sessão de 2026-08-22)

Investigado um relato do dono: um operador convidado recebia o e-mail, clicava no link e caía num erro de "link inválido ou expirado". O fluxo de convite (`equipe/actions.ts` → `admin.inviteUserByEmail` → `/auth/callback` → `/redefinir-senha`) usa exatamente o mesmo mecanismo já validado pro "Esqueci minha senha" (seção 25) — nenhum bug de código encontrado. A causa mais provável é o link de uso único ser consumido antes da pessoa clicar de verdade (scanner de segurança de e-mail corporativo tipo Outlook/Office 365 "Safe Links", ou expirou depois de 1h, ou clicou um convite antigo de um teste anterior).

Como não dava pra reenviar sem apagar e recriar o colaborador, adicionado:

- **`resendInvite(memberId)`** em `equipe/actions.ts` — mesmas checagens de permissão/empresa de `removeTeamMember`, chama `admin.inviteUserByEmail` de novo pro mesmo e-mail. Isso gera um link novo (o antigo, de uso único, vira inválido) — é o "reenviar" de verdade, não só reenviar o e-mail antigo. Se o usuário já confirmou o acesso, retorna aviso amigável em vez do erro cru do Supabase ("já confirmou o acesso — não precisa reenviar").
- **`ResendInviteButton`** (`equipe/resend-invite-button.tsx`, ícone de envelope) — ao lado do botão de remover, na tabela de Equipe (`equipe/page.tsx`), visível pra quem já podia remover aquele colaborador (admin, colaborador não-admin).

`tsc --noEmit` e `eslint` limpos.

## 54. Bug: exclusão de empresa/conta travava com espaço sobrando no nome (sessão de 2026-08-22)

Duas empresas de teste apagadas direto pelo Supabase continuavam aparecendo no Super Admin (`/admin`) — confirmado que a query da listagem busca sempre direto do banco, sem cache: se a empresa ainda aparecia, a exclusão no Supabase não tinha ido até o fim de verdade (provável causa: `profiles.company_id` é `on delete set null`, não `cascade` — apagar só a linha de `companies` direto por SQL deixa a conta de login do dono órfã, sem apagar de fato). O caminho seguro pra apagar uma empresa já existia (botão "Excluir empresa definitivamente" na "Zona de risco" de `/admin/[id]`, usando `deleteCompanyPermanently` em `admin/actions.ts`, que apaga as contas de login via API de admin antes de apagar a empresa).

Ao tentar usar esse botão numa das duas empresas ("Escuna amigos"), o dono não conseguia — o botão ficava sempre desabilitado mesmo digitando o nome certinho. Causa raiz: o nome dessa empresa no banco tem um **espaço sobrando no final** (`"Escuna amigos "`, dado de cadastro antigo) — invisível no `<strong>` da tela (HTML colapsa espaço em branco na exibição), então o dono digitava o nome exatamente como via na tela, sem esse espaço, e a comparação (`confirmName.trim() !== companyName`, sem `.trim()` do lado do nome vindo do banco) nunca batia. Mesma classe de bug encontrada e corrigida em três lugares (todos comparavam o texto digitado — trimado — contra o nome cru do banco — não trimado):

- `src/app/admin/[id]/delete-company-controls.tsx` (botão do Super Admin)
- `src/app/admin/actions.ts` (`deleteCompanyPermanently`, validação no servidor)
- `src/app/(app)/configuracoes/actions.ts` (`deleteMyAccount`) + `configuracoes/delete-account-form.tsx` (auto-exclusão de conta pelo próprio dono da empresa)

Todos agora comparam `.trim()` dos dois lados. Não enfraquece a proteção — continua exigindo o nome exato (e senha, no caso da auto-exclusão), só ignora espaço nas pontas que o usuário não consegue nem ver na tela.

## 55. 🔴 Bug: convite pra e-mail já cadastrado virava conta órfã, some da Equipe (sessão de 2026-08-22)

Investigado outro relato: um colaborador convidado pela Equipe nunca aparecia na lista, mesmo depois de confirmar a senha pelo link. Rastreado direto no banco (via script pontual com a service role key, apagado depois de usar):

- O e-mail convidado já tinha uma conta **pendente** no sistema (criada antes por engano, via "Criar conta" do login, nunca confirmada — mesma pessoa testando).
- `admin.inviteUserByEmail()` do Supabase, quando o e-mail já existe mas está **sem confirmar**, não cria conta nova — **reaproveita** a conta existente (atualiza ela, manda um novo e-mail). Isso é um `UPDATE` em `auth.users`, não um `INSERT`.
- O gatilho `on_auth_user_created` (que decide se a pessoa entra como colaborador na empresa de quem convidou, ou vira dona de uma empresa nova) só roda em `after insert` — **não dispara de novo num update**. Resultado: a pessoa confirma a senha normalmente (sem erro de link nem nada), mas o perfil dela continua com a empresa/papel de **antes** do convite (no caso investigado: dono de uma "Minha empresa" própria, criada na tentativa de cadastro anterior) — nunca vira `staff` da empresa de quem convidou, e por isso nunca aparece na lista da Equipe de quem convidou.

**Correção** (`src/app/(app)/equipe/actions.ts`, `inviteTeamMember`): antes de chamar `inviteUserByEmail`, agora verifica se já existe qualquer `profiles` com aquele e-mail (`select id from profiles where email = $1`) — se existir, bloqueia com "Já existe uma conta cadastrada com esse e-mail no sistema" em vez de deixar o Supabase reaproveitar a conta silenciosamente. Cobre tanto conta confirmada de outra empresa quanto conta pendente/nunca confirmada. Essa checagem usa o **client admin (service_role)**, não o client normal da sessão — a RLS de `profiles` (migration 0013) só deixa um `company_admin` ver colegas da própria empresa, então com o client normal um e-mail cadastrado em *outra* empresa (o caso real que causou o bug) passaria batido pela checagem. Não mexeu no gatilho `handle_new_user()` (código sensível, alvo de uma correção crítica de segurança na migration `0018` — mudar o comportamento dele de novo pede mais cautela do que vale a pena aqui, já que bloquear o convite na origem resolve o problema por completo).

A conta de teste afetada ("Minha empresa" nova, dona = e-mail convidado) precisa ser limpa manualmente pelo dono via `/admin` → entrar na empresa → "Excluir empresa definitivamente" (o mesmo botão corrigido na seção 54).

`tsc --noEmit` e `eslint` limpos.

## 56. 🔴 Causa raiz real do convite quebrado: `invited_at` chega depois do gatilho de criação (sessão de 2026-08-22)

Depois da seção 55, veio outro relato: convite pra um e-mail **nunca usado antes** (sem o problema de conta reaproveitada) — a pessoa clicou no link, confirmou a senha sem erro nenhum, mas **virou dona de uma empresa nova** ("Minha empresa") em vez de entrar como `staff` na empresa de quem convidou. Ou seja: o próprio gatilho de convite (`handle_new_user()`, correções anteriores nas migrations `0013`/`0018`) nunca funcionou direito em produção, nem nos casos "limpos".

**Diagnóstico** (direto no banco, via `supabase db push`/CLI já linkado ao projeto — sem precisar do SQL Editor manual): reproduzido o bug com convites de teste reais (e-mails descartáveis, deletados depois) e confirmado com uma tabela de log temporária (migration `0024`, removida depois) dentro do próprio gatilho — **`new.invited_at` chega `null` no gatilho `AFTER INSERT on auth.users`**, mesmo em convites de verdade feitos via `admin.inviteUserByEmail()`. O Supabase grava a linha em `auth.users` **primeiro**, e só preenche `invited_at` numa **atualização separada** logo em seguida (confirmado: ~34ms depois, na resposta da própria API) — como o gatilho de criação dispara imediatamente no `INSERT`, ele nunca via esse campo preenchido, e a condição de segurança da migration `0018` (`if new.invited_at is not null`) nunca era verdadeira. Todo convite, desde que essa lógica existe, caiu sempre no caminho de "cadastro normal".

(A migration `0023`, aplicada antes desse diagnóstico mais fundo, só reafirmava a lógica da `0018` sem mudar nada — não resolveu, porque o problema nunca foi o código da função estar desatualizado, e sim o timing de quando `invited_at` fica disponível.)

**Correção definitiva** (migration `0025_conserta_gatilho_convite_timing.sql`):
- `handle_new_user()` (dispara em `AFTER INSERT on auth.users`, sem mudança nenhuma pro cadastro normal): se o metadata tiver `invited_to_company_id`, **não decide nada ainda** — só devolve, esperando confirmação.
- **Novo gatilho** `on_auth_user_invited`, em `AFTER UPDATE OF invited_at on auth.users`, com `WHEN (old.invited_at is null and new.invited_at is not null)` — dispara exatamente no momento em que o Supabase confirma que é um convite de verdade (só a API admin, que exige `service_role`, preenche esse campo — segue impossível de forjar via `signUp()` público, mesma garantia de segurança da `0018`). Aí sim insere o perfil como `staff` na empresa que convidou.
- Sem impacto no cadastro normal (`Criar conta`): sem `invited_to_company_id` no metadata, `handle_new_user()` segue exatamente igual a antes.

**Validado** com convites de teste reais (e-mails descartáveis via alias `+`, removidos logo depois): convite → perfil correto (`role=staff`, `company_id` da empresa que convidou) na hora, sem precisar a pessoa nem confirmar o link. Cadastro normal testado de novo também, sem regressão (`role=company_admin`, empresa própria, como sempre foi).

## 57. 🔴 Convite de equipe passa a mandar e-mail próprio (Resend), não mais o do Supabase (sessão de 2026-08-22)

Mesmo com a seção 56 corrigida (perfil certo criado na hora), o link do e-mail de convite continuava caindo em "link inválido ou expirado" quando a pessoa clicava. Causa: o e-mail padrão do Supabase usa `{{ .ConfirmationURL }}`, que aponta pro **endpoint hospedado do próprio Supabase** (`/auth/v1/verify`) — esse endpoint verifica o token no servidor dele e redireciona pro nosso site com a sessão **no fragmento da URL** (`#access_token=...`). Fragmento de URL nunca é enviado pelo navegador ao servidor — só existe no lado do cliente — então o nosso `/auth/callback` (que roda no servidor) nunca recebe a sessão, mesmo com o link genuíno e recém-clicado. Confirmado com um teste direto (`fetch` seguindo os redirects manualmente): o `Location` do primeiro redirect vinha com `#access_token=...` no final.

**Tentativa que não resolveu**: customizar o template "Invite user" no painel do Supabase (Authentication → Email Templates) pra usar `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/redefinir-senha` em vez de `{{ .ConfirmationURL }}` — o mecanismo em si funciona (testado isoladamente, com sucesso, montando esse link na mão), mas a edição salva no painel **não estava realmente sendo usada** nos e-mails enviados de verdade (confirmado testando várias vezes, com o token mudando a cada tentativa mas o link sempre voltando pro formato antigo/quebrado — mesmo após confirmar, com reload da página, que o template estava salvo corretamente). Causa exata não identificada (suspeita de cache/propagação no lado do Supabase); não perseguido mais a fundo porque havia um caminho melhor disponível.

**Solução definitiva**: parar de depender do e-mail de convite do Supabase Auth por completo.

- **Nova Edge Function `send-email`** (`supabase/functions/send-email/index.ts`) — mailer genérico via Resend (mesmo serviço já usado por `send-reservation-voucher`), recebe `{ to, subject, html }`. Só aceita chamada com um segredo compartilhado dedicado (`MAILER_SECRET`, header `x-mailer-secret`) — não faz nenhuma checagem de permissão/RLS sozinha, então só pode ser chamada pelo nosso backend (que já validou tudo antes). `MAILER_SECRET` gerado e configurado como secret da function (`supabase secrets set`) e como env var do Next.js (`.env.local` + Vercel Production, via `vercel env add`).
- **`src/lib/team-invite-email.ts`** (novo) — monta o HTML do e-mail de convite (mesmo estilo visual do voucher: cabeçalho navy, logo, `color-scheme: light only` pra não inverter em modo escuro).
- **`src/app/(app)/equipe/actions.ts`** — `inviteTeamMember`/`resendInvite` não usam mais `admin.auth.admin.inviteUserByEmail()` (que manda o e-mail do Supabase). Agora usam `admin.auth.admin.generateLink({ type: "invite", ... })`, que cria o usuário/token **sem mandar e-mail nenhum** — só devolve o `hashed_token`. O link é montado na mão (`${SITE_URL}/auth/callback?token_hash=...&type=invite&next=/redefinir-senha`, o mesmo formato já validado) e o e-mail é enviado chamando a Edge Function `send-email` direto.
- **Efeito colateral encontrado e corrigido**: nesse processo, a secret `RESEND_FROM` (usada por `send-reservation-voucher` e agora por `send-email`) estava configurada com remetente em `castrocompny.online` — domínio **nunca verificado** no Resend (o verificado é `nauticflow.com.br`, corrigido faz tempo só nas configurações de SMTP do Supabase Auth, seção 25). Resend recusava o envio (`403 domain not verified`). Corrigido pra `NauticFlow <contato@nauticflow.com.br>` — isso também deve ter corrigido silenciosamente o envio de voucher por e-mail, que provavelmente vinha falhando desde sempre sem ninguém notar (a reserva sempre é criada mesmo se o e-mail falhar, então o erro não bloqueava nada, só não avisava).

**Validado de ponta a ponta** com um convite de teste real (e-mail descartável): `generateLink` → e-mail enviado com sucesso via Resend (`{"sent":true}`) → link clicado → sessão estabelecida (cookie setado) → redireciona pra `/redefinir-senha` → perfil já correto (`staff`, empresa certa) desde a criação.

## 58. Colaborador (staff) deixa de ver Configurações/Planos/Financeiro/Relatórios/Equipe (sessão de 2026-08-22)

Com o convite de equipe finalmente funcionando (seções 56-57), o dono notou que um colaborador convidado (`staff`) via **tudo** no menu — inclusive Configurações (dados da empresa, cobrança, exclusão de conta) e o rodapé de plano/renovação. Pedido: colaborador só deveria ver o operacional (Reservas, Agenda, Saídas, Clientes, Embarcações, Parceiros) — nada de conta/assinatura/gestão de equipe, pra evitar mexida acidental na conta do dono.

- **Menu lateral** (`src/components/sidebar.tsx`) — grupo "Gestão" (Financeiro, Relatórios, Equipe, Configurações) marcado `adminOnly` e filtrado pra sumir quando `isStaff`. Rodapé de plano/renovação (link pra `/planos`) também escondido pra staff. Prop `isStaff` propagada por `app-shell.tsx` e calculada em `src/app/(app)/layout.tsx` (`rawRole === "staff"`).
- **Bloqueio no servidor** (defesa em profundidade — nunca confiar só em esconder botão/menu): `/configuracoes`, `/equipe`, `/planos`, `/financeiro` e `/relatorios` agora redirecionam `staff` pra `/dashboard` direto na Server Component da página, então nem digitando a URL dá pra entrar.
- **Brecha real fechada**: a RLS de `companies` (`propria empresa - update`, migration `0000`) permite **qualquer membro** da empresa atualizar os dados dela — não só `company_admin`. A action `updateSettings` (`configuracoes/actions.ts`) não tinha checagem de cargo nenhuma; um colaborador que soubesse a URL conseguia editar nome/CNPJ/cidade/telefone da empresa mesmo com a tela escondida. Adicionada checagem `role !== "company_admin" && role !== "super_admin"` na própria action.

Não mexeu em `cancelAsaasSubscription`/plano (já tinha checagem de cargo desde que foi criada) nem em `inviteTeamMember`/`removeTeamMember` (idem).

**Validado** com Playwright + um convite de teste real (sessão de `staff` de verdade, via `generateLink` + cookie de sessão real, não simulado): menu lateral mostra só Operação + Cadastros, sem rodapé de plano; acesso direto às 3 URLs bloqueadas (`/configuracoes`, `/equipe`, `/planos`) redireciona pra `/dashboard`. `tsc --noEmit` e `eslint` limpos.

## 59. Telas de Clientes/Embarcações/Parceiros/Saídas/Agenda/Reservas atualizam sozinhas (Realtime) (sessão de 2026-08-23)

Pedido do dono: testando com dois colaboradores ao mesmo tempo (um daqui, um de outro dispositivo), quem cria/edita/apaga um cliente ou embarcação só aparece pro outro depois de sair e voltar da aba — perguntou se dava pra atualizar sozinho. (Aproveitei pra confirmar que o medo de fundo dele — dois funcionários venderem a mesma vaga ao mesmo tempo — já não acontece: `check_departure_capacity` (migration `0000`) confere a capacidade **direto no banco** a cada `insert`/`update` de reserva confirmada, então mesmo com a tela desatualizada não dá pra estourar a capacidade por coincidência de cliques simultâneos.)

- **`src/components/realtime-refresh.tsx`** (novo, client component) — assina Supabase Realtime (`postgres_changes`) nas tabelas passadas e chama `router.refresh()` (com debounce de 400ms) quando algo muda — reconsulta os dados da página atual sem perder o estado da UI, sem precisar sair/voltar da aba. Adicionado em `clientes`, `embarcacoes`, `parceiros`, `saidas`, `agenda` e `reservas` (`saidas`/`agenda`/`reservas` assinam tanto `departures` quanto `reservations`, já que essas telas dependem das duas).
- **Migration `0026_realtime_operacional.sql`** — habilita Realtime (`alter publication supabase_realtime add table ...`) em `vessels`, `clients`, `partners`, `departures`, `reservations`.
- **CSP** (`next.config.mjs`) — `connect-src` só permitia `https://*.supabase.co`; o canal do Realtime usa `wss://` (websocket), que a CSP bloqueava silenciosamente (sem erro visível pro usuário, só no console do navegador). Adicionado `wss://*.supabase.co`.
- **Bug real encontrado e corrigido durante o teste** (o recurso simplesmente não funcionava até isso): o Realtime só entrega um evento pra quem a RLS de `SELECT` da tabela deixaria ver aquela linha (isolamento por empresa) — mas isso depende do client mandar o `access_token` da sessão pro servidor do Realtime (`supabase.realtime.setAuth(...)`), e o `@supabase/ssr` sincroniza isso de forma assíncrona/atrasada. O canal estava sendo assinado **antes** dessa sincronização terminar, então ficava autenticado só como `anon` — a policy (`for select to authenticated`) barrava tudo, silenciosamente, sem erro nenhum. Corrigido buscando a sessão (`supabase.auth.getSession()`) e chamando `setAuth` explicitamente **antes** de criar o canal.
- **Verificação de segurança adicional, feita por iniciativa própria**: a filtragem por RLS em eventos de `UPDATE`/`DELETE` (diferente de `INSERT`) depende de `REPLICA IDENTITY FULL` na tabela — sem isso, o Postgres só manda a chave primária no "old record", e o Realtime não consegue avaliar a política de RLS contra uma linha editada/apagada (documentado pelo próprio Supabase como pré-requisito). Nenhuma das 5 tabelas tinha isso configurado. Adicionada migration `0029_realtime_replica_identity_full.sql`.

**Validado com teste de isolamento entre empresas de verdade** (não só "parece certo"): sessão real do `company_admin` da LLEDENEW assinando `clients`, e via `service_role`: (1) inserido cliente em **outra** empresa → não apareceu pra ele (correto); (2) inserido cliente na **própria** empresa → apareceu sozinho, sem reload (correto, prova que o recurso funciona); (3) editado o cliente da outra empresa → não vazou o novo nome (correto). `tsc --noEmit` e `eslint` limpos.

## 60. 🔴 Auditoria de segurança completa do sistema — falha crítica de graça no plano corrigida (sessão de 2026-08-23)

Pedido do dono: revisão de segurança do sistema **inteiro** (não só do que mudou recentemente), mais uma checagem geral de erro de código. Rodado em paralelo: `tsc --noEmit`, `eslint .` e `next build` completos (todos limpos — só 4 avisos cosméticos preexistentes de `<img>` vs `next/image`) e uma auditoria de segurança de ponta a ponta cobrindo todo o codebase (RLS de cada tabela, toda action com `createAdminClient()`, os dois gatilhos de auth, a área `/admin`, o webhook do Asaas, as Edge Functions).

### 🔴 CRÍTICO — qualquer usuário logado conseguia virar Premium de graça

`link_asaas_subscription()` (RPC do Postgres criada na migration `0012`, atualizada na `0020` pros planos anuais) tinha `grant execute ... to authenticated` — ou seja, **qualquer pessoa logada no sistema** (colaborador ou dono, de qualquer empresa) conseguia chamar essa função **direto pelo navegador**, sem passar pela tela de Planos nem pelo Asaas de verdade:

```js
supabase.rpc('link_asaas_subscription', {
  p_customer_id: 'x', p_subscription_id: 'qualquer-coisa-inventada',
  p_plan_code: 'premium', p_billing_cycle: 'anual'
})
```

A função é `security definer` e só grava na própria empresa de quem chama (`current_company_id()`) — então não dava pra mexer na empresa de outro cliente —, mas ela **nunca conferia se `p_subscription_id` correspondia a uma cobrança real no Asaas**, só trocava o `plan_id` da assinatura direto. Como `getSubscriptionStatus()` (`src/lib/subscription.ts`) só olha `paid_until`/`suspended_at` pra liberar uso (nunca o `status` da assinatura), qualquer empresa dentro da janela válida (ex: os 7 dias de trial que todo cadastro novo já ganha) virava Premium (limites de embarcações/usuários maiores) **sem pagar nada**, e isso não se autocorrigia sozinho depois — o webhook do Asaas só estende `paid_until`, nunca reverte `plan_id`.

**Correção** (migration `0030_fecha_bypass_link_asaas_subscription.sql`): a função não confia mais em quem a chama pra saber "qual é a empresa dela mesma" — agora exige `p_company_id` explícito e **só o `service_role` pode executá-la** (`revoke ... from public/authenticated/anon`, `grant ... to service_role`). `startAsaasCheckout` (`billing-actions.ts`) agora chama essa RPC pelo `createAdminClient()` (mesmo client já usado ali pra outras operações administrativas), passando o `company_id` já validado no servidor — nenhuma mudança de comportamento pro fluxo legítimo (checkout continua funcionando igual), só fecha a porta que deixava chamar direto do navegador.

**Validado**: (1) exploit antigo (assinatura de 4 parâmetros) — função nem existe mais; (2) exploit com a assinatura nova (5 parâmetros) usando a chave pública — `permission denied for function`; (3) fluxo legítimo via `service_role` — funciona normal. Testado numa assinatura real (LLEDENEW) e restaurado ao estado original depois.

### Resto da auditoria — nada mais de alta confiança encontrado

Checado e confirmado seguro: os gatilhos de convite (`handle_new_user`/`handle_invited_user`, seção 56) continuam só confiando em `invited_at`, nunca forjável; a coluna `company_id`/`role` de `profiles` é destravada só por `UPDATE` direto (migration `0003`), o client nunca consegue mudar isso; toda action com `createAdminClient()` faz checagem de cargo antes; a área `/admin` exige `super_admin` + MFA (AAL2) em toda página e toda action; o webhook do Asaas usa comparação seguro contra timing attack (`timingSafeEqual`) e nunca lê `company_id` de campo controlável pelo atacante; as duas Edge Functions (`send-email`, `send-reservation-voucher`) estão protegidas certinho; nenhum segredo hardcoded no código; nenhum HTML não escapado com dado de usuário.

`tsc --noEmit`, `eslint` e `next build` limpos.

## 61. Card de "plano atual" mostra o ciclo (mensal/anual) (sessão de 2026-08-23)

Pedido do dono: na tela de Planos, o card "SEU PLANO ATUAL" mostrava só o nome (ex: "Premium"), sem dizer se a assinatura é mensal ou anual — confuso principalmente ao alternar o toggle Mensal/Anual da tela, que não muda o plano real da empresa, só o que está sendo *visualizado/escolhido*.

- `src/app/(app)/planos/page.tsx` — passa a buscar `billing_cycle` da assinatura (já existia na tabela desde a migration `0020`, só não estava sendo lido aqui) e repassa como `currentBillingCycle` pro `PlanCards`.
- `src/app/(app)/planos/plan-cards.tsx` — badge do plano atual passa de "SEU PLANO ATUAL" pra "SEU PLANO ATUAL · MENSAL" ou "· ANUAL", usando o ciclo real salvo no banco (não o toggle da tela, que é só pra escolher o próximo pagamento).

Testado com Playwright (sessão real) — badge aparece corretamente. `tsc --noEmit` e `eslint` limpos.

## 62. Bug: não dava pra trocar de mensal pra anual no mesmo plano (sessão de 2026-08-23)

Achado pelo dono logo depois da seção 61: no plano atual (ex: Premium mensal), ao clicar na aba "Anual" da tela de Planos, o card continuava mostrando só "Ativo até [data]" — **sem nenhum botão pra pagar**. Não tinha como migrar de mensal pra anual (nem o contrário) no mesmo plano.

Causa: `isCurrent` (`p.code === currentPlanCode`) decidia sozinho se mostrava "Ativo até" (sem botão) ou o botão de pagamento — mas isso só olha o **plano**, não o **ciclo**. Alternar a aba Mensal/Anual não muda o que a empresa realmente paga, só o que está sendo visualizado; então o card do plano atual escondia o botão em qualquer aba, mesmo numa aba de ciclo diferente do que está ativo de verdade.

**Correção** (`src/app/(app)/planos/plan-cards.tsx`): novo `isExactCurrent` (`isCurrent && cycle === currentBillingCycle`) — só esconde o botão quando o plano **e** o ciclo selecionados na tela batem exatamente com o que está ativo. Quando é o mesmo plano mas ciclo diferente, aparece um botão "Mudar para anual"/"Mudar para mensal" (em vez de "Pagar este plano" ou "Renovar plano"). O backend (`startAsaasCheckout`) já suportava isso sem mudança nenhuma — já cancelava a assinatura antiga no Asaas e criava uma nova com o ciclo escolhido, só a tela é que nunca deixava chegar no botão.

Testado com Playwright (sessão real, DAVI/LLEDENEW, plano Premium mensal): aba Mensal → "Ativo até" sem botão (correto); aba Anual → botão "Mudar para anual" aparece (correto). `tsc --noEmit` e `eslint` limpos.

## 63. Trava o reaproveitamento infinito do trial de 7 dias (sessão de 2026-08-23)

Pedido do dono: um usuário podia esperar os 7 dias de trial acabarem, excluir a conta, criar outra com e-mail diferente e ganhar mais 7 dias — repetindo pra sempre, sem nunca pagar.

- **CNPJ/CPF virou obrigatório no cadastro** (`src/app/login/page.tsx`, `src/app/login/actions.ts`) — antes era opcional; sem exigir um documento, não tem como identificar quem já usou o trial. `signUp()` valida a quantidade de dígitos (11 = CPF, 14 = CNPJ) antes de criar a conta.
- **Nova tabela `trial_history`** (migration `0031_bloqueia_trial_repetido_por_documento.sql`) — guarda o documento (só dígitos) de quem já ganhou o trial. Fica **separada** de `companies` de propósito: excluir a conta/empresa apaga a linha de `companies`, mas essa tabela nunca é tocada por nenhum fluxo do app (sem FK, sem cascade), então continua "lembrando" mesmo depois da conta sumir. RLS habilitada sem nenhuma policy — fechada pra `authenticated`/`anon`, só o gatilho (`security definer`) e o `service_role` acessam.
- **`handle_new_user()`** (gatilho de cadastro) — no cadastro normal, normaliza o CNPJ/CPF pra só dígitos e confere em `trial_history`: documento novo → ganha os 7 dias normalmente e fica registrado; documento já usado antes (mesmo que a conta anterior tenha sido excluída) → a assinatura já nasce com `paid_until = agora` (mesmo efeito de "assinatura vencida" que `getSubscriptionStatus` já trata — a conta é criada, mas sem cadastrar nada novo até pagar um plano).

**Validado** com cadastro real (via `signUp()` público, não simulado): primeiro cadastro com um CPF de teste ganhou os 7 dias; segundo cadastro (e-mail diferente, **mesmo CPF**) não ganhou nada, `trial_history` continuou com só 1 registro (sem duplicar). `tsc --noEmit` e `eslint` limpos.

## 64. Favicon trocado pela logo de verdade (sessão de 2026-08-24)

O favicon (`public/favicon.ico`/`favicon.png`/`apple-icon.png`) usava um desenho antigo, meio "fantasma"/desbotado — diferente da logo de verdade (`public/nauticflow-icon.png`) já usada em todo o resto do sistema (login, menu lateral, e-mails, `og-image.png`). Gerados os três arquivos de novo a partir da logo real (fundo branco quadrado, logo centralizada) via `sharp`; `favicon.ico` escrito manualmente (formato ICO com PNG embutido — suportado desde o Windows Vista, sharp não tem encoder de `.ico`). Confirmado servindo certo (`/favicon.ico`, `/favicon.png`, `/apple-icon.png` → 200, content-type correto) antes de commitar.

## 65. Preparação do Core para o marketplace ToursFlow (sessão de 2026-08-26)

Pedido do dono: preparar o NauticFlow para futuramente alimentar o **ToursFlow** (marketplace B2C de passeios, projeto/domínio separado, `toursflow.com.br`), sem conectar os dois sistemas ainda. Antes da implementação foi feita uma auditoria completa só de leitura (ver histórico da sessão) mapeando o que já existia, o que faltava e o que não devia ser mexido. Esta seção documenta o que foi de fato implementado a partir dela — **nenhuma integração com o ToursFlow foi feita nesta etapa**, só o Core do NauticFlow.

Princípio seguido em tudo: reaproveitar `tours`/`departures`/`reservations`/`companies` (nada de tabela duplicada de saída, reserva ou capacidade), tudo aditivo (nenhuma coluna existente alterada/removida, nenhum dado antigo quebrado), e o mecanismo de proteção contra overbooking (`SELECT ... FOR UPDATE` na migration `0003`) preservado exatamente como estava.

### Migrations (`0032` a `0037`)

- **`0032_marketplace_expande_tours.sql`** — `tours` vira o cadastro comercial completo do passeio: `slug`, `description`, `short_description`, `itinerary`, `duration_minutes`, `category` (categoria da **experiência** — privativo/pôr do sol/praias/ilhas/compartilhado/outro — não confundir com `vessels.type`, que é tipo de **embarcação**), `destination` (+ `destination_slug`, coluna **gerada** via `public.slugify()`, indexada, pra filtro de URL tipo `/destinos/buzios` sem acento e sem precisar carregar tudo e comparar em JavaScript), `price_type`, `cancellation_policy`, `important_information`, `included`, `not_included`, os 10 campos de local de embarque (`boarding_*`, incluindo lat/long), e `marketplace_status` (`draft → review → published`, mais `paused`/`rejected`) com `published_at` e `marketplace_rejection_reason`.
  - **Slug**: gerado automaticamente (nome + sufixo do próprio `id`, garante unicidade global sem fila de tentativas — dois operadores podem ter passeios com nome igual). Trigger `trg_tour_slug` trava a troca do slug **depois que o passeio já foi publicado uma vez** (`published_at` não nulo) — editar nome/descrição depois de publicado nunca muda a URL.
  - Passeios já existentes ganharam slug automaticamente no backfill da própria migration — nenhum ficou sem.
- **`0033_marketplace_preco_saida.sql`** — `departures` ganha `price_cents`/`price_type` (nullable). Decisão de arquitetura: `tours.base_price_cents` continua sendo o preço-base/fallback de vitrine; `departures.price_cents`, quando preenchido, é o preço oficial e vendável **daquela saída específica** (permite alta/baixa temporada). Nenhuma mudança no fluxo de reserva atual — `reservations.total_cents` continua sendo digitado à mão, sem ler essas colunas novas.
- **`0034_marketplace_fotos_passeio.sql`** — tabela `tour_photos` (capa, ordem, `storage_path`), RLS por empresa + gatilho de defesa em profundidade (mesmo padrão das migrations `0015`/`0019`). Bucket de Storage `tour-photos` criado **privado** (não público), com policies que só liberam quem está autenticado e cujo `current_company_id()` bate com o primeiro segmento do caminho (`{company_id}/{tour_id}/arquivo`) — um operador nunca acessa foto de outra empresa.
- **`0035_reservas_origem_estruturada.sql`** — `reservations.source` (enum `manual`/`operator`/`website`/`marketplace`/`partner`/`agency`), backfill `'manual'` em tudo que já existia (é exatamente o que o painel sempre foi). `origin_name` (texto livre) continua existindo sem nenhuma mudança — os dois campos coexistem, `source` é o canal estruturado pra filtro/relatório, `origin_name` é a observação livre.
- **`0036_infra_pagamentos_marketplace.sql`** — tabela `payments` (`reservation_id`, `provider`, `status`, `amount_cents`...) **só a estrutura**, sem nenhuma integração com Asaas ainda — RLS habilitada sem nenhuma policy (mesmo padrão de `trial_history`, fechada por padrão). `companies` ganha `asaas_wallet_id`/`asaas_receiver_status` (colunas, sem onboarding financeiro implementado).
- **`0037_idempotencia_webhook_asaas.sql`** + `src/app/api/webhooks/asaas/route.ts` — corrige um bug real encontrado na auditoria: o webhook somava dias em `subscriptions.paid_until` **sem checar se aquele evento já tinha sido processado**. Se o Asaas reenviasse a notificação (retry normal), ou mandasse `PAYMENT_CONFIRMED` e depois `PAYMENT_RECEIVED` do mesmo pagamento, a assinatura ganhava o prazo somado duas vezes. Corrigido com uma tabela `processed_webhook_events` (chave única `payment.id`, sem o tipo de evento de propósito) — a rota agora insere essa chave **antes** de renovar; se já existir (23505), ignora silenciosamente. Isso já valia pro SaaS atual, antes mesmo do marketplace existir.

### Painel do operador — `/passeios`

Nova área (`src/app/(app)/passeios/`), visível a `company_admin` e `staff` (mesmo nível de acesso de Clientes/Embarcações/Parceiros). Fluxo: "+ Novo passeio" cria um rascunho só com o nome e leva direto pra tela de edição, com as seções pedidas (informações básicas, preço, roteiro, incluso/não incluso, informações importantes, política de cancelamento, local de embarque). Um painel lateral (`publication-panel.tsx`) mostra o status de publicação e os botões de ação disponíveis pra cada estado.

Fotos (`photo-manager.tsx`): upload direto do navegador pro Storage (respeitando as policies da migration `0034`), com capa, reordenar (subir/descer) e excluir; ao apagar a capa, a próxima foto vira capa automaticamente pra nunca sobrar um passeio "publicável" sem nenhuma capa.

`/saidas` (criar/editar saída) ganhou um campo opcional "Preço desta saída" — se deixado em branco, mantém `price_cents = null` (herda o preço-base do passeio na hora de exibir).

### Publicação — o operador não aprova o próprio passeio

`draft`/`rejected` → **operador** pode enviar pra `review` (`submitTourForReview`), com validação (nome, descrição curta e completa, destino, categoria, duração, tipo de preço, local de embarque completo e **ao menos 1 foto** — um rascunho incompleto pode ser salvo livremente, só o *envio pra revisão* é bloqueado). `review` → só o **super admin** aprova (`published`) ou recusa (`rejected`, com motivo) — nova tela `/admin/passeios` (RLS: policy nova de `select`/`update` cross-empresa pra super admin em `tours`, mesmo padrão já usado em `vessels`/`profiles` desde a migration `0016`). `published` → operador pode `pausar` a qualquer momento; `paused` → operador pode reativar direto (sem passar por revisão de novo — fica documentado como possível melhoria futura: hoje editar o conteúdo de um passeio pausado não força reenvio pra revisão).

### API pública somente-leitura (`/api/public/*`)

Cinco rotas, todas usando `createAdminClient()` (service_role) internamente, mas **nunca abrindo RLS pra `anon`** — o filtro `marketplace_status = 'published'` é sempre aplicado em código, e o payload é sempre montado campo a campo (nunca um `select("*")` devolvido direto), então nenhuma coluna sensível (`company_id`, CNPJ, dados do Asaas, `marketplace_rejection_reason`) sai por acidente:

- `GET /api/public/tours?destination=buzios&category=por_do_sol&page=1&limit=20` — lista paginada (limite máximo 50/página), filtra por `destination_slug`/`category` direto no banco (índices da migration `0032`), devolve nome da empresa/cidade (nunca CNPJ/e-mail/dados internos) e a foto de capa como signed URL.
- `GET /api/public/tours/[slug]` — detalhe completo (descrição, roteiro, incluso/não incluso, local de embarque, todas as fotos). 404 (nunca 500, nunca revela "existe mas não está publicado") pra slug inexistente ou não publicado.
- `GET /api/public/tours/[slug]/departures` — saídas futuras, não canceladas e **já precificadas** (sem `price_cents` = ainda não pronta pra venda). Nunca expõe a capacidade real da embarcação — só um `soldOut: boolean` calculado no servidor.
- `GET /api/public/destinations` e `GET /api/public/categories` — listas pra alimentar filtros/rotas tipo `/destinos/[slug]`.

Fotos são servidas via **signed URL de 1h** gerada sob demanda pelo `service_role` (o bucket continua privado) — decisão v1, documentada como pendente de revisão antes da integração real (ver seção "Pendências" abaixo).

### CSP

`next.config.mjs` — `img-src` passou a incluir `https://*.supabase.co` (fotos de passeios, tanto no painel do operador quanto na API pública, são exibidas via signed URL do Storage).

### Testes e verificação

`tsc --noEmit`, `eslint .` e `next build` (rotas novas incluídas: `/passeios`, `/passeios/[id]`, `/admin/passeios`, as 5 rotas de `/api/public/*`) — todos limpos, sem erro novo. Nenhuma migration foi aplicada em produção nesta etapa — ficaram só como arquivo, aguardando autorização explícita pra rodar `supabase db push` (mudança grande demais pra aplicar sem confirmar antes, diferente de sessões anteriores).

### Pendências / decisões que dependem do dono

- Rodar as migrations `0032`–`0037` em produção (nada foi aplicado ainda).
- Fotos: hoje servidas por signed URL gerada a cada chamada da API pública — funciona, mas complica cache (a URL expira). Antes de conectar o ToursFlow de verdade, decidir entre manter assim, aumentar o TTL, ou abrir uma policy pública restrita a "só fotos de passeio publicado".
- Reativar um passeio pausado não força nova revisão do conteúdo — se o operador editar tudo enquanto pausado, republica sem novo aval do super admin.
- Checkout do turista, cobrança, Asaas Split, voucher novo, QR Code, avaliações, login/área do turista — **nada disso foi implementado** (fora de escopo explícito desta etapa).

## 66. Fundação de reservas do ToursFlow — hold, idempotência e preço seguro (sessão de 2026-08-27)

Antes desta etapa, uma **auditoria completa só de leitura** mapeou como o NauticFlow trata reservas hoje (ver histórico da sessão): `reservations`/`passengers`/`clients`/`payments` já existiam e a proteção contra overbooking (`check_departure_capacity`, `SELECT ... FOR UPDATE`, migration `0003`) já era sólida — mas nada calculava preço a partir de `departures.price_cents` (o operador sempre digita o total à mão), não existia hold temporário de vaga, não existia rota alguma pra um sistema externo criar reserva, e nenhuma rota do projeto tinha rate limiting. Esta seção documenta a fundação implementada a partir dessa auditoria — **preparada mas não aplicada em produção nem conectada ao ToursFlow ainda** (ver "Pendências" abaixo).

Fora de escopo, de propósito, nesta etapa: checkout completo, Asaas, split, webhook de pagamento do turista, voucher, QR Code, passageiros completos, login do turista, cancelamento/reembolso, área do cliente.

Princípio seguido: reaproveitar **a mesma** `public.reservations` que o operador já usa (nenhuma tabela paralela tipo `marketplace_bookings`/`booking_holds`) — uma reserva vinda do ToursFlow é a mesma reserva que aparece no painel do operador.

### Migration `0042_marketplace_reservas_hold.sql` (ainda não aplicada em produção)

- **Hold de vaga**: `reservations` ganha `hold_expires_at` (timestamptz, nullable) e `idempotency_key` (text, nullable). Reserva do marketplace nasce `status='pendente'` com `hold_expires_at = now() + 15 minutos`. A vaga é considerada ocupada enquanto `status='confirmada'` **ou** (`status='pendente'` **e** `hold_expires_at > now()`) — um hold vencido para de contar sozinho, sem precisar de nenhuma rotina de limpeza rodar antes. Reservas manuais/de outros canais nunca preenchem essas colunas e continuam se comportando exatamente como hoje.
- **Capacidade** (`check_departure_capacity`, atualizada): preserva o `SELECT ... FOR UPDATE` da migration `0003` (trava a linha da saída até o fim da transação, serializando duas tentativas concorrentes pela mesma vaga), só muda o que conta como "ocupado" pra incluir hold ativo. O próprio `INSERT` da nova reserva pendente passa pela mesma trava — não existe caminho que crie um hold sem checar capacidade.
- **Idempotência**: índice único parcial em `idempotency_key`, restrito a `where source = 'marketplace' and idempotency_key is not null` — não muda em nada o comportamento de reservas manuais (nunca têm essa chave). Retry do ToursFlow com a mesma chave bate no índice único do banco (nunca resolvido só por "SELECT antes de INSERT", que teria a mesma corrida que se quer evitar) e a rota devolve a reserva original.
- **Rate limit** (`public.api_rate_limits` + função `check_rate_limit`): infraestrutura mínima em Postgres, sem serviço externo (sem Redis/Upstash). Atômica via lock de linha por `consumer_key` (mesmo padrão de `FOR UPDATE` já confiável no projeto), funciona igual em qualquer quantidade de instâncias serverless porque o estado vive no banco. Não guarda nenhum dado sensível — só um contador e um timestamp de janela.

### Nova rota — `POST /api/marketplace/bookings`

Fora de `/api/public/*` de propósito: é uma rota servidor-servidor (o **servidor** do ToursFlow chama, nunca o navegador do turista), autenticada com segredo compartilhado (`Authorization: Bearer <TOURSFLOW_API_SECRET>`, comparado em tempo constante com `timingSafeEqual`, mesmo padrão do webhook do Asaas). Sem header válido → `401`, sem revelar qual parte falhou. `TOURSFLOW_API_SECRET` é server-only (nunca `NEXT_PUBLIC_`), guardado só em `.env.local`/variáveis de ambiente do servidor.

**Achado durante o teste da rota**: o middleware de sessão (`src/lib/supabase/middleware.ts`) redireciona qualquer chamada sem sessão de usuário pra `/login` — e isso vale por padrão pra **qualquer** rota, inclusive `/api/marketplace/*`, já que essa rota nunca tem sessão de usuário (autentica só pelo Bearer). Corrigido adicionando `/api/marketplace` à mesma lista de exceção que `/api/public` e `/api/webhooks` já tinham (exatamente o mesmo achado que motivou a exceção de `/api/public` na sessão anterior).

Fluxo da rota: autentica (Bearer) → rate limit (`check_rate_limit`, consumidor `"toursflow"`, limite configurável por `TOURSFLOW_RATE_LIMIT_MAX_REQUESTS`/`TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS`) → exige `Idempotency-Key` (header, formato validado) → valida payload → resolve `departure → tour → company` **só a partir de `departureId`** (nunca aceita `company_id`/`tour_id`/preço/status do request) → calcula preço no servidor a partir de `departures.price_cents` → resolve/cria `client` (dedupe só por CPF quando informado; sem CPF, cria um novo — nunca assume nome/e-mail únicos) → insere em `reservations` (`status='pendente'`, `source='marketplace'`, `origin_name='ToursFlow'`, `created_by=null`, `partner_id=null`, `hold_expires_at`, `idempotency_key`) → devolve DTO.

**Preço** (`src/lib/marketplace-api.ts`): `price_type='por_pessoa'` → `total = price_cents × quantity`; `'por_grupo'` → `total = price_cents` (quantidade só afeta capacidade/passageiros, não multiplica o valor); `'a_partir_de'` → `422 PRICE_TYPE_NOT_SELLABLE` (não é vendável nesta primeira versão — não existe regra de cálculo definida pra ele em lugar nenhum do sistema). Preço enviado no request é **sempre ignorado** — só `departures.price_cents` decide.

**Erros**: `400 INVALID_REQUEST`/`INVALID_IDEMPOTENCY_KEY`, `401 UNAUTHORIZED`, `404 DEPARTURE_NOT_FOUND` (mesmo código pra saída inexistente, passeio não publicado/inativo, ou saída de passeio que não existe — nunca revela qual caso é o real), `409 INSUFFICIENT_CAPACITY`, `422 DEPARTURE_IN_PAST`/`DEPARTURE_NOT_SELLABLE`/`PRICE_NOT_CONFIGURED`/`PRICE_TYPE_NOT_SELLABLE`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR` (sem stack trace).

### `soldOut` na API pública passa a contar holds

`GET /api/public/tours/[slug]/departures` — o cálculo de `soldOut` agora soma reservas `confirmada` **e** `pendente` com `hold_expires_at` ainda válido (antes só olhava `confirmada`; sem isso, um hold do ToursFlow não aparecia como ocupação pra quem estivesse olhando o catálogo por outro canal). Continua sem expor capacidade real, quantidade reservada, `company_id` ou qualquer dado da reserva — só o booleano.

### Pendências / decisões que dependem do dono

- ~~Migration `0042` ainda não foi aplicada em produção~~ **Atualizado**: `0042` e a correção `0043` (ver seções abaixo) foram aplicadas em produção e a suíte funcional completa (A–K, payload malicioso, quantidade, rate limit) passou contra dados de teste isolados, já removidos. Ver "Migration `0042` aplicada em produção" e "Testes funcionais completos" abaixo.
- `TOURSFLOW_API_SECRET` de teste gerado só localmente (`.env.local`, nunca commitado) — precisa de um valor combinado de verdade com o time do ToursFlow antes de produção.
- Decisão de produto pendente: se um operador com assinatura vencida (`requireActiveSubscription`) deve continuar recebendo reservas do marketplace. Por decisão explícita desta etapa, a rota **não** aplica esse bloqueio ainda.
- O ToursFlow **não** foi alterado nesta etapa e **não** deve chamar esta rota ainda — validação isolada primeiro.
- Próxima etapa (não iniciada): checkout, Asaas, split, webhook de pagamento do turista, voucher, QR Code.

### Correções da revisão pré-deploy (mesma sessão, antes de qualquer aplicação em produção)

Uma revisão técnica da migration `0042` (ainda como arquivo, nunca aplicada) e da rota, feita antes de autorizar produção, encontrou e corrigiu localmente:

- **EXECUTE de função aberto por padrão**: confirmado testando de verdade contra produção que `anon` já consegue chamar hoje `is_super_admin()` só com a chave pública (`POST /rest/v1/rpc/is_super_admin` devolve `200`) -- Postgres concede `EXECUTE` pra `PUBLIC` em toda função nova, diferente de tabela. Sem `REVOKE EXECUTE FROM PUBLIC` explícito, `check_rate_limit` (e a nova função abaixo) seriam chamáveis por `anon` direto via RPC, bypassando a rota inteira. Corrigido: `revoke ... from public` + `grant ... to service_role` nas duas funções novas.
- **Idempotency-Key com payload diferente**: uma chave só deve valer pra UMA operação lógica. Adicionada `reservations.request_fingerprint` (hash sha256 de `departureId+quantity+e-mail`, nunca dado sensível cru) -- reenviar a mesma key com conteúdo diferente agora devolve `409 IDEMPOTENCY_CONFLICT` em vez de silenciosamente devolver a reserva antiga.
- **Cliente órfão em corrida de retry**: duas requisições concorrentes com a mesma Idempotency-Key e cliente sem CPF cada uma criava seu próprio `client` antes de disputar o insert da reserva -- a perdedora ficava com um `client` sem reserva nenhuma apontando pra ele. Corrigido criando `create_marketplace_booking()`: cliente + reserva agora nascem numa ÚNICA função/transação, com um bloco de exceção que desfaz o insert do cliente automaticamente se a reserva falhar (idempotência ou capacidade) -- a rota (`route.ts`) passou a chamar só esta RPC em vez de fazer os dois inserts separados.
- Validação de payload reforçada: `quantity` ganhou teto (`MARKETPLACE_QUANTITY_MAX = 50`, evita estourar o cálculo de preço), `cpf` (se informado) precisa ter exatamente 11 dígitos, `name`/`email`/`phone` ganharam limite de tamanho, e o total calculado é checado contra o limite real da coluna Postgres `int4` antes de tentar persistir.
- Confirmado por inspeção linha a linha (sem bug real encontrado): o trigger `check_departure_capacity` já excluía corretamente a própria linha (`id <> new.id`) num `UPDATE` -- uma transição `pendente → confirmada` nunca conta a mesma reserva duas vezes, porque a soma de ocupação sempre ignora a linha sendo atualizada e soma `new.people_count` uma única vez.
- **Bloqueio documentado**: sem Docker/Postgres local disponível neste ambiente, os testes de concorrência/expiração/idempotência de ponta a ponta continuam bloqueados até a migration `0042` ser autorizada e aplicada em produção (só autenticação e resolução de `departure` inexistente puderam ser testados de verdade, por não dependerem das colunas/funções novas).

### Migration `0042` aplicada em produção — e falha crítica encontrada e corrigida na `0043`

`0042` foi aplicada em produção via `supabase db push --linked` (fluxo oficial, dry-run conferido antes). Logo no smoke test pós-aplicação, testando explicitamente se `anon`/`authenticated` conseguiam chamar as RPCs novas direto (item da checklist de segurança), confirmou-se que **conseguiam**: `anon.rpc("create_marketplace_booking", ...)` executava de verdade (chegava a validar o `departureId` internamente, prova de que a função rodava com privilégio pleno via `SECURITY DEFINER`, bypassando RLS).

Causa raiz: o `revoke execute ... from public` da `0042` revogou exatamente o que pedia — mas o Supabase concede EXECUTE em toda função nova do schema `public` **diretamente** para `anon`/`authenticated`/`service_role` (uma política de privilégio padrão do projeto, independente do pseudo-role `PUBLIC`). Revogar de `PUBLIC` nunca tocava essas concessões diretas — confirmado inspecionando `pg_proc.proacl` antes e depois (não por suposição).

Corrigido pela **migration `0043_fecha_execute_rpc_marketplace.sql`** (só permissões, nenhuma tabela/RLS/lógica alterada): `revoke execute ... from public, anon, authenticated` + `grant execute ... to service_role`, nomeando os papéis problemáticos explicitamente em vez de confiar só em `PUBLIC`. De propósito, **não** usa `ALTER DEFAULT PRIVILEGES` (mudaria o comportamento pra toda função futura do projeto, não só estas duas — decisão maior, registrada abaixo como pendência separada). Verificado após aplicar: `anon` e `authenticated` agora recebem `permission denied for function ...` (SQLSTATE `42501`) **antes** de qualquer lógica interna rodar, em ambas as funções; `service_role` continua funcionando normalmente (rota `/api/marketplace/bookings` teve smoke test refeito e continua correta).

**Pendência nova**: auditar se alguma outra função `SECURITY DEFINER` do projeto (além de `is_super_admin`, que é `stable`/somente-leitura e portanto de baixo risco mesmo aberta) tem o mesmo problema de EXECUTE concedido a `anon`/`authenticated` por essa política padrão do Supabase — feito aqui só para as duas funções desta etapa, não para o projeto inteiro.

### Testes funcionais completos (mesma sessão, dados isolados)

Com `0042`+`0043` aplicadas e a ACL corrigida, rodou-se a suíte funcional completa contra um tour/saídas de teste dedicados (`[TESTE MARKETPLACE RESERVAS]`, removidos ao final) — nunca contra o passeio real publicado. Todos passaram: mesma `Idempotency-Key` simultânea (mesmo `bookingId`, um `201`+um `200 Idempotency-Replayed`), `IDEMPOTENCY_CONFLICT` por `quantity`/`phone`/`name` divergente, última vaga com keys diferentes (`201`+`409`), hold expirado manualmente liberando a vaga sem cron, `pendente → confirmada` sem double-count, `por_pessoa`/`por_grupo`/`a_partir_de`, `soldOut` refletindo hold ativo/expirado, ausência de client órfão (inclusive sob corrida), regressão do trigger (`confirmada` consome, `pendente` sem hold ou com hold vencido não consome, `pendente` com hold futuro consome), payload malicioso totalmente ignorado (`company_id`/preço/`status`/`source` forjados não tiveram efeito), validação de `quantity` (0/negativo/decimal/acima do teto), e rate limit real (30/60s, `429` a partir da requisição que excede).

- ~~Conectar o ToursFlow de verdade a esta API — não feito~~ **Atualizado**: código commitado (`35509d1`) e publicado em produção. E2E real (ToursFlow local → `nauticflow.com.br`) executado com sucesso — ver "E2E real com o ToursFlow" abaixo.

### Commit, push e deploy

Commit único `35509d1` ("feat: add secure marketplace booking holds") com os 7 arquivos da fundação (migrations `0042`/`0043`, rota, `marketplace-api.ts`, middleware, `soldOut`, documentação) — revisado item a item antes de commitar (nenhum `.env`/segredo/script/dado de teste incluído, `TOURSFLOW_API_SECRET` só como `process.env.*`). `git push` foi bloqueado pro assistente pelo classificador de auto mode do ambiente (ação de alto risco, dispara deploy de produção) — o push real foi feito pelo dono da conta. `origin/main` confirmado com o commit aplicado.

### E2E real com o ToursFlow

Fluxo completo `Browser → ToursFlow /api/bookings → NauticFlow /api/marketplace/bookings` testado de ponta a ponta contra um tour/saída de teste dedicados (`[TESTE E2E TOURSFLOW]`, capacity=2/price_cents=15000/por_pessoa) — nunca contra o passeio real publicado. Passou: criação `201`, replay `200`, `IDEMPOTENCY_CONFLICT 409`, preço calculado 100% server-side, `soldOut`, hold de 15 minutos exato (`hold_expires_at - created_at = 15min`), cadeia `reservation → departure → tour → company` consistente, exatamente 1 reservation por `idempotency_key` (replay não duplicou). Reserva/cliente/saída/tour de teste inspecionados e depois removidos — passeio real (`teste-integracao-toursflow-90f2bc`) confirmado intacto (publicado, 2 saídas, 2 fotos).

### Rate limit por visitante (`X-ToursFlow-Client-Key`)

Antes de liberar `/api/bookings` no ToursFlow pro público, adicionada uma segunda camada de rate limit — **sem nenhuma migration nova** (`check_rate_limit`/`api_rate_limits` já aceitam qualquer `consumer_key` de texto, sem CHECK constraint restringindo valores; mudança 100% em código).

- **Camada A (global, já existia)**: consumidor `"toursflow"`, protege o volume total vindo do marketplace como um todo.
- **Camada B (nova, por visitante)**: o ToursFlow calcula, no **próprio servidor dele**, `HMAC-SHA256(TOURSFLOW_API_SECRET, "rate-limit:v1:" + ipNormalizado)` e envia só o resultado — 64 caracteres hexadecimais — no header `X-ToursFlow-Client-Key`. O NauticFlow **nunca recebe o IP em claro**, nunca lê `X-Forwarded-For`, e só grava o hash já pronto (`consumer_key = "toursflow:client:<hash>"`, reaproveitando a mesma `api_rate_limits`/`check_rate_limit`). Formato validado (`^[a-f0-9]{64}$`, case-insensitive normalizado pra minúsculas — `"ABC...".toLowerCase()` cai no mesmo contador de `"abc..."`). Ausente ou mal formado → `400 INVALID_CLIENT_KEY`, e só é considerado **depois** do `Bearer` validado (nunca aceito de requisição não autenticada).
- **Ordem**: `Bearer` → `X-ToursFlow-Client-Key` → limite global → limite por visitante → `Idempotency-Key` → resto da validação/criação. Limite inicial: `TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS=10` requisições / `TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS=60` segundos (configurável por env, mesmo padrão do limite global) — qualquer um dos dois limites bloqueando devolve o mesmo `429 RATE_LIMITED` genérico, nunca revela qual camada nem contador/hash/IP.
- **Idempotência**: um replay (mesma `Idempotency-Key`) também consome uma tentativa do rate limiter — aceitável nesta primeira versão com o limite de 10/60s (retry normal tem folga de sobra); documentado como trade-off consciente, não bug.
- **Testado de verdade** (dados de teste com `departureId` inexistente, pra nunca criar reservation/client/hold): `401` sem `Bearer`/com `Bearer` errado; `400 INVALID_CLIENT_KEY` sem o header ou com formato inválido; header maiúsculo normalizado corretamente pro mesmo contador do minúsculo; 10 chamadas da mesma client key aceitas, 11ª → `429`; uma segunda client key totalmente diferente **não** foi afetada pelo limite da primeira; limite global continuou contando em paralelo; nenhuma linha de `api_rate_limits` contém IP (só os hashes e o consumidor `"toursflow"`); `anon` seguiu recebendo `permission denied` em `check_rate_limit`. Dados de teste (`toursflow:client:aaa...`/`toursflow:client:bbb...`) removidos ao final.

## 67. Publicação autônoma do operador + suspensão administrativa separada (sessão de 2026-08-27)

Auditoria prévia (só leitura) encontrou dois problemas reais: (1) a aprovação obrigatória do super admin (migration 0039) não batia mais com a decisão de produto atual, e (2) `companies.suspended_at` e `tours.active` não eram checados em NENHUMA rota pública nem na reserva do marketplace — um passeio de empresa administrativamente suspensa continuava visível e reservável via ToursFlow. Esta sessão implementou a correção. **Migration `0044_publicacao_autonoma_suspensao.sql` preparada mas NÃO aplicada em produção ainda** — aguardando autorização separada (mesmo protocolo já usado nas migrations 0042-0043: implementar → revisar → só depois aplicar).

**Decisão de produto (definitiva)**: aprovação manual deixa de ser obrigatória. O operador publica/despublica o próprio passeio diretamente (`draft ↔ published`, sem passar por `review`). `review`/`rejected`/`paused` continuam válidos no schema (nunca removidos do `CHECK`, compatibilidade com dados antigos), só não fazem mais parte do fluxo novo.

**Suspensão administrativa do passeio, separada de `marketplace_status`** (mesmo princípio de `companies.suspended_at`, migration 0016): `tours.marketplace_suspended_at`/`marketplace_suspended_by`/`marketplace_suspension_reason` (aditivo). `marketplace_status` continua representando a intenção do operador; a suspensão é um overlay que tira o passeio da vitrine sem mexer nisso — remover a suspensão depois basta pra ele reaparecer, sem o operador precisar publicar de novo. Só super_admin escreve nesses 3 campos — **não é GRANT de coluna** (operador e super_admin são o mesmo role Postgres `authenticated`; a distinção é `profiles.role`), é um trigger novo (`trg_tour_suspension_guard`) que chama `is_super_admin()`, mesmo padrão de `check_tour_marketplace_transition`.

`check_tour_marketplace_transition` (0039) reescrita via `CREATE OR REPLACE` (arquivo antigo não editado): operador pode ir pra `published` a partir de qualquer status anterior desde que `marketplace_suspended_at` esteja nulo, e `published → draft` sempre permitido (despublicar nunca é bloqueado por suspensão). `create_marketplace_booking` (0042/0043) também reescrita: nova checagem de `companies.suspended_at` logo após resolver a empresa da saída — antes de tocar `client`/`reservation`/hold — devolve `COMPANY_NOT_AVAILABLE`, defesa em profundidade (a rota já checa isso antes de chamar a função).

**Server Actions**: `submitTourForReview`/`withdrawTourFromReview`/`pauseTour`/`resumeTour` removidas (sem nenhum outro caller depois da troca de UI — deletadas, não deixadas como código morto) e substituídas por `publishTour`/`unpublishTour` (`src/app/(app)/passeios/actions.ts`). `approveTour`/`rejectTour` (admin) removidas e substituídas por `suspendTour`/`unsuspendTour`. `/admin/passeios` deixa de ser fila obrigatória de aprovação (`marketplace_status='review'`) e passa a listar passeios **publicados** com controle de suspender/reativar (`suspend-controls.tsx`, substitui `moderation-controls.tsx`, removido).

**API pública + booking — regra de visibilidade completa** (as 4 rotas: `/api/public/tours`, `/tours/[slug]`, `/tours/[slug]/departures`, `/destinations`, mais o pré-check em `POST /api/marketplace/bookings`): `tour.active=true AND marketplace_status='published' AND marketplace_suspended_at IS NULL AND company.suspended_at IS NULL`. Implementado com `companies!inner(...)` + `.is("companies.suspended_at", null)` (embed `!inner`, não o embed normal, porque o filtro precisa excluir a LINHA do tour inteira, não só o objeto aninhado) — técnica nova neste projeto, **testada de verdade contra produção antes de aplicar aos 4 arquivos**: com dado isolado descartável (company+tour criados só pra este teste, removidos em seguida), confirmado que a linha aparece com `suspended_at=null` e desaparece assim que a company é suspensa. Nenhuma coluna sensível vaza — DTO sempre montado campo a campo, nunca `...company`.

**Pendência explícita, não resolvida aqui**: assinatura vencida (`requireActiveSubscription`) continua sem bloquear o marketplace — decisão consciente, já registrada na seção 66. Próxima etapa (não iniciada, deliberadamente fora de escopo): `validateTourForPublishing()` com validação automática de conteúdo/fotos.

**Testes**: `tsc --noEmit`/`eslint`/`next build` limpos. Testes funcionais completos (A–P do pedido: operador publica/despublica/republica, tenta publicar tour de outra empresa, super admin suspende/reativa, company suspensa bloqueia vitrine+booking, `tours.active=false`) **não executados de ponta a ponta** — dependem das colunas/trigger da migration 0044, ainda não aplicada. O que pôde ser validado sem a migration: a técnica de filtro `companies!inner` (testada com dado isolado, ver acima) e todo o resto por revisão de código linha a linha, seguindo os mesmos padrões já comprovados nas sessões anteriores (advisory lock, função atômica, trigger de capacidade).

## 68. Validação automática de publicação (qualidade + segurança) (sessão de 2026-08-27)

Item pendente da seção 67 implementado: nenhuma aprovação manual, mas o passeio passa por validação automática antes de `published`. Migration `0044` **estendida** (ainda não aplicada) — sem criar `0045`, porque tudo faz parte atomicamente da mesma arquitetura de publicação da seção 67.

**Arquitetura — fonte única de verdade em SQL**: `validate_tour_for_publishing(tour_id)` (nova função, `stable`, `SECURITY INVOKER` de propósito — roda com o RLS de quem chama, nunca vê passeio de outra empresa) devolve TODOS os problemas de uma vez (`code`, `field`, `message`, `severity: error|warning`). Chamada em **três lugares diferentes, nunca reimplementada**: (1) `getPublicationChecklist`/página do passeio, pra mostrar "Pronto para publicar?" antes do clique; (2) `publishTour`, pra devolver a lista de erros de forma amigável se a publicação falhar; (3) de dentro do próprio gatilho `check_tour_marketplace_transition` — **esta é a garantia real contra bypass**: mesmo um `UPDATE tours SET marketplace_status='published'` direto via API do Supabase, ignorando toda a Server Action e a UI, é recusado pelo banco (`PUBLISH_VALIDATION_FAILED`) se houver qualquer `error`. `warning` nunca bloqueia.

**Checklist (ERROR)**: `tour.active`, título (5-120 caracteres), descrição curta, descrição completa (mín. 40 caracteres), destino, categoria, duração, `price_type`, local de embarque completo, latitude/longitude dentro da faixa válida (se informadas), pelo menos 1 foto aprovada, foto de capa definida e aprovada, resolução mínima da capa (800×600, só quando a resolução é conhecida — ver fotos abaixo), não suspenso administrativamente (tour nem empresa), e ausência de contato externo/link no conteúdo público (ver conteúdo textual abaixo). **WARNING (nunca bloqueia)**: nenhuma saída futura cadastrada (`NO_FUTURE_DEPARTURES`), provável duplicata na mesma empresa por título+destino+categoria normalizados (`POSSIBLE_DUPLICATE_TOUR`).

**Conteúdo textual — determinístico, nunca "IA"**: `check_tour_public_content_violation()` (função pura, `immutable`, reaproveitada por `validate_tour_for_publishing` E pelo gatilho de edição abaixo — regex escrita uma vez só) bloqueia link/URL, e-mail, telefone (regex exige o agrupamento típico DDD+4-5+4 dígitos, testado para não confundir com número de endereço tipo "Rua X, nº 120" nem CEP), WhatsApp, Instagram, PIX, e frases tipo "reserve direto"/"reserve pelo". Escaneia `name` (título) e todos os campos de texto público: `description`, `short_description`, `itinerary`, `included`, `not_included`, `important_information`, **e também `boarding_instructions`/`boarding_reference`** (achado durante a implementação: são campos livres já expostos na API pública, `boarding.instructions`/`boarding.reference` — sem escaneá-los também, dava pra colar um telefone ali contornando a checagem que só olhava a descrição). Limitação conhecida e documentada: não detecta contato disfarçado dentro de uma IMAGEM (QR Code, texto sobreposto, handle de Instagram numa foto) — isso exigiria OCR/visão computacional, fica pro futuro provider de moderação (ver abaixo).

**Edição de passeio já publicado**: achado real — o gatilho de transição só dispara quando `marketplace_status` MUDA; editar o conteúdo de um passeio que CONTINUA `published` não passava por nenhuma checagem. Corrigido com um gatilho novo, `trg_tour_content_while_published` (`before update of` todos os campos de texto escaneados + `marketplace_status`, só age quando o passeio segue/vira `published`), chamando a MESMA função de conteúdo. Decisão adotada (das duas oferecidas): **bloquear a alteração inválida**, nunca despublicar silenciosamente — o operador mantém controle explícito sobre quando algo sai do ar.

**Fotos — estado de moderação, arquitetura pronta sem provider**: `tour_photos` ganha `moderation_status` (`pending`/`approved`/`rejected`/`moderation_unavailable`/`legacy_approved`), `moderation_provider`, `moderation_checked_at`, `moderation_reason_code`, `width`, `height` (todas aditivas). **Decisão explícita, não silenciosa**: como não existe nenhum provider de moderação de imagem integrado (auditoria da seção 66 confirmou, e nenhum é criado agora — proibido explicitamente), fotos existentes viram `legacy_approved` no backfill (nunca `rejected`/`pending` — isso derrubaria o marketplace real) e **uploads novos gravam `approved` diretamente** (`addTourPhoto`, não fica em `pending`) — porque não existe nenhum worker pra tirar uma foto de `pending`, e deixá-la lá travaria a publicação de qualquer passeio novo pra sempre. `pending`/`rejected`/`moderation_unavailable` existem no schema e são respeitados em TODA a validação e na API pública (nunca aparecem lá) — 100% prontos pra um provider futuro assumir, trocando só essa uma decisão (`approved` → `pending` no upload).

**Resolução de foto**: como `tour_photos` não guardava `width`/`height`, e baixar/reprocessar imagem no servidor a cada publicação custaria caro e escalaria mal, a captura passou a acontecer **no navegador**, no momento do upload (`readImageDimensions()`, `photo-manager.tsx` — grátis, o arquivo já está em memória lá). `NULL` nas fotos antigas (sem essa captura ainda existir) — tratado como "não dá pra checar", nunca como erro; só bloqueia (`LOW_RESOLUTION_COVER`) quando a capa tem resolução conhecida E abaixo de 800×600.

**Magic bytes / conteúdo real do arquivo — avaliado, não implementado**: o bucket confia no `Content-Type` declarado no upload (Storage + validação client-side), não no conteúdo real do arquivo. Verificar magic bytes de verdade exigiria baixar cada foto no servidor a cada publicação — mesmo trade-off de custo da resolução, mas sem uma captura barata equivalente no navegador (o navegador já valida o MIME real ao decodificar a imagem pra `readImageDimensions()`, o que dá uma proteção indireta — um arquivo que não é imagem de verdade falha ali com `width/height = null`, não é bloqueio de segurança forte, mas não é zero). Deixado como gap documentado, não implementado nesta etapa (instrução explícita: "não criar custo absurdo", "explicar trade-off").

**API pública**: `/api/public/tours` e `/api/public/tours/[slug]` passam a filtrar `moderation_status in (approved, legacy_approved)` nas fotos (capa e galeria) — hoje é um no-op (tudo é `approved`/`legacy_approved`), mas já é a regra certa pro dia em que `pending`/`rejected` existirem de verdade.

**Compatibilidade do passeio real**: `teste-integracao-toursflow-90f2bc` — suas 2 fotos existentes recebem `legacy_approved` no backfill (não tocadas de outra forma), continuam contando como aprovadas em tudo. Não foi lido nem verificado nesta etapa (nenhuma necessidade, a lógica de backfill é genérica pra toda a tabela).

**Testes**: `tsc --noEmit`/`eslint`/`next build` limpos. As 18 regras de conteúdo textual (telefone/link/e-mail/WhatsApp/Instagram/PIX, incluindo os casos de falso-positivo — endereço com número, CEP) foram testadas isoladamente em JS (padrões equivalentes ao regex SQL, mesma semântica de `\M`/`\b`) — todas passaram. Os testes que dependem de estado real de banco (A–U do pedido: publicar/despublicar de verdade, gatilho de bypass, fotos approved/pending/rejected, resolução, duplicata, edição de publicado) **não executados** — mesma limitação estrutural já documentada (migration `0044` não aplicada, sem Docker/Postgres local neste ambiente).

## 69. Moderação real de imagem — OpenAI Moderation API (sessão de 2026-08-27)

Fecha a lacuna deixada explícita na seção 68 ("não existe provider, uploads novos ficam `approved` direto"). Agora existe um provider real. Migration `0044` **ajustada de novo** (ainda local, não aplicada): `moderation_status` de foto nova passa a nascer `pending`, não mais `approved`.

**Dependências**: nenhuma nova. Sem `openai`/`@openai/*` no projeto — chamada feita com `fetch` nativo direto em `POST https://api.openai.com/v1/moderations` (SDK não seria necessário só pra uma chamada REST simples). Sem o pacote `server-only` também — o projeto nunca usou esse pacote em nenhum outro módulo já server-only (`marketplace-api.ts` etc.); a proteção real (env sem `NEXT_PUBLIC_` nunca entra no bundle) já é do próprio Next.js, então adicionar a dependência só por reforço simbólico não pareceu necessário.

**Acesso à foto privada — terceira opção, mais segura que as duas oferecidas**: em vez de signed URL (opção A) ou baixar bytes com service_role (opção B), o módulo usa `supabase.storage.from("tour-photos").download(path)` com o **client de sessão do próprio operador** — a mesma RLS de Storage que já protege a foto (`tour_photos_select_own_company`) autoriza o download diretamente, sem nunca gerar nenhuma URL (assinada ou não) que precise de TTL ou pudesse vazar. Os bytes viram base64 e vão direto no corpo da requisição pra OpenAI (`data:image/...;base64,...`) — nunca uma URL pública nem semi-pública em nenhum momento.

**Fluxo**: `addTourPhoto` insere a foto com `moderation_status='pending'` e **aguarda** `runPhotoModeration()` antes de retornar (sem fila/job separado — a API da OpenAI responde em segundos, não precisa de infraestrutura extra) — quando a Server Action termina, o operador já vê o resultado real. `runPhotoModeration()` baixa os bytes, chama `POST /v1/moderations` (modelo `omni-moderation-latest`, timeout 10s via `AbortController`), interpreta o resultado e grava `moderation_status`/`moderation_provider='openai'`/`moderation_checked_at`/`moderation_reason_code`.

**Mapeamento de resultado — provider como autoridade, sem threshold próprio** (decisão explícita, seguindo a preferência do pedido): `flagged=false` → `approved`. `flagged=true` → `rejected`, com `moderation_reason_code` = a primeira categoria marcada `true` na resposta, normalizada de `sexual/minors`/`self-harm/intent` etc. (formato da OpenAI) para `sexual_minors`/`self_harm_intent` (convenção do projeto) — nunca a resposta completa, nunca score numérico. Qualquer falha técnica — sem `OPENAI_API_KEY` configurada, timeout, `429`/`5xx`, erro de rede, JSON que não bate com o formato esperado — vira `moderation_unavailable`. **Nunca existe um caminho que resulte em `approved` por fallback.**

**Retry**: `retryPhotoModeration(photoId, tourId)` — só para `pending`/`moderation_unavailable`. `rejected` nunca pode ser reprocessada pelo operador (decisão de produto explícita — só remover/substituir a foto). Concorrência: guarda simples via `UPDATE ... WHERE moderation_status IN (...) AND (moderation_checked_at IS NULL OR moderation_checked_at < now() - 30s)` — atômico por natureza do `UPDATE` do Postgres, sem fila/lock separado.

**Capa e exclusão**: `setCoverPhoto` agora recusa (`"Só uma imagem aprovada pode ser definida como capa."`) qualquer foto que não seja `approved`/`legacy_approved`. `deleteTourPhoto`, ao promover automaticamente uma nova capa após apagar a atual, só considera fotos aprovadas (antes considerava a próxima por posição, aprovada ou não) — evita um passeio publicado com `is_cover=true` apontando pra uma foto que a API pública nunca devolveria mesmo assim.

**Tour já publicado**: sem mudança de comportamento adicional — o tour continua público usando as fotos `approved`/`legacy_approved` que já tinha; uma foto nova fica `pending` e simplesmente não entra na API pública (filtro já existente da seção 68) até `approved`.

**Fotos antigas**: continuam intocadas, `legacy_approved` no backfill, **nenhuma reenviada pra OpenAI automaticamente** (evita custo inesperado e mudança de catálogo, conforme instruído) — remoderação histórica, se algum dia for necessária, fica como processo opcional separado, não implementado aqui. `teste-integracao-toursflow-90f2bc` não foi tocado.

**Segurança/privacidade**: `retryPhotoModeration` e `addTourPhoto` validam `company_id`+`tour_id` antes de tocar a foto (mesmo padrão já usado em todas as outras actions de foto). Nada além dos bytes da imagem é enviado à OpenAI — sem nome/CPF/telefone/e-mail/dados de reserva. Logs: nunca a chave, nunca a resposta completa do provider, nunca os bytes/base64 — só o que já existe nas colunas (`photo_id`, status final, provider, código de categoria genérico).

**`.env.example` criado** (não existia): só `OPENAI_API_KEY=`, comentário explicando server-only e fail-closed. **Achado à parte**: o `.gitignore` tinha uma regra `.env*` que também bloqueava `.env.example` de ser versionado — corrigido com `!.env.example` (senão o arquivo nunca chegaria ao repositório mesmo depois de commitado).

**Testes — sem chamar a OpenAI real**: 13 casos executados de verdade contra o **código de produção** (`npx tsx`, importando `src/lib/image-moderation.ts` diretamente, não uma reimplementação) — resposta segura → `approved`; `flagged` com categoria `violence/graphic`, `self-harm/intent` e sem categoria nenhuma marcada (→ `other_policy`) → `rejected` com o código certo; JSON nulo/vazio/malformado/`flagged` não-booleano/string crua → `moderation_unavailable`; `fetch` mockado simulando timeout (`AbortError`), `429` e `500` → `moderation_unavailable` nos três; sem `OPENAI_API_KEY` → `moderation_unavailable`, nunca `approved`. **Todos os 13 passaram.** Nenhuma chamada real à rede da OpenAI foi feita, nenhuma chave configurada.

## 70. Teste real (rede) contra a OpenAI Moderation API — chave configurada em ambiente controlado (sessão de 2026-08-27)

Com `OPENAI_API_KEY` configurada manualmente pelo usuário em `.env.local` (nunca lida/impressa por mim — só checagem booleana), chamado `callOpenAiModeration()` isolado (sem tocar banco) com um PNG 64×64 sintético gerado localmente (gradiente azul/verde, sem pessoas, sem conteúdo sensível — nada baixado da internet).

**Resultado**: a chave é aceita pela rede (`x-request-id` presente, chegou até a OpenAI de verdade — não é erro de rede/DNS/formato), mas toda chamada — inclusive uma sem imagem nenhuma, só texto — voltou `HTTP 429` com corpo `{"type":"invalid_request_error","message":"Too Many Requests","code":null}`, consistente em 3 tentativas. Isso indica billing/quota da conta OpenAI, não um bug de código: o fail-closed funcionou exatamente como projetado (`429` → `moderation_unavailable`, nunca `approved`). O caminho de sucesso (`flagged=false` → `approved`) continua validado só pelos mocks — não foi possível confirmá-lo contra a rede real nesta sessão. Nenhum dado de produção foi tocado, nenhuma migration aplicada, nenhum segredo apareceu em log/diff/bundle (confirmado por grep dedicado).

## 71. Moderação manual no lançamento inicial — provider OpenAI vira opcional (sessão de 2026-08-27)

Decisão de produto: no lançamento inicial **não há provider pago ligado**. O operador publica normalmente; o super_admin faz moderação manual/monitoramento via o mecanismo de suspensão já existente (`/admin/passeios`, seção 67) se identificar algo inadequado. Antes desta mudança, sem chave configurada toda foto nova ficaria presa em `moderation_unavailable` (achado do teste real, seção 70) — bloquearia a publicação de qualquer passeio novo. Corrigido com uma política **explícita**, nunca inferida pela ausência de chave.

**`IMAGE_MODERATION_MODE`** (`src/lib/image-moderation.ts`, `getImageModerationMode()`): env var server-only, nunca `NEXT_PUBLIC_`. `"openai"` liga o fluxo real (pending → provider); qualquer outro valor — ausente, vazio, erro de digitação, `"OPENAI"` maiúsculo — cai em `"manual"`, o modo seguro que nunca chama rede nem bloqueia upload. `.env.example` documenta os dois valores e vem com `IMAGE_MODERATION_MODE=manual` (o default esperado de produção inicial).

**Novo status `manual_approved`** (migration `0044`, ainda local): adicionado ao `CHECK` de `tour_photos.moderation_status` junto dos 5 já existentes. Conta como aprovada em tudo — `validate_tour_for_publishing` (contagem de fotos + capa), API pública (`tours/route.ts`, `tours/[slug]/route.ts`), `setCoverPhoto`, promoção automática de capa em `deleteTourPhoto` — mesmo padrão de `APPROVED_STATUSES` já usado pra `approved`/`legacy_approved`, só que agora com 3 valores. Nunca ganha badge de "aprovada pela IA" na UI do operador (`photo-manager.tsx`) — de propósito, pra não passar a impressão de uma análise automática que não aconteceu.

**Decisão de default**: em vez de depender do `DEFAULT` da coluna pra decidir o status de foto nova, `addTourPhoto` e `runPhotoModeration` **leem `IMAGE_MODERATION_MODE` e setam o campo explicitamente** — modo `"manual"` insere `moderation_status='manual_approved'` direto (nem chama `runPhotoModeration`); modo `"openai"` insere `'pending'` e segue o fluxo real de antes. `runPhotoModeration()` ganhou a mesma checagem internamente (defesa em profundidade: mesmo que um chamador futuro esqueça de checar o modo antes de invocar, a função nunca liga pra OpenAI fora do modo `"openai"`). O `DEFAULT 'pending'` da coluna continua existindo só como rede de segurança pra um insert que esqueça de setar o campo — nesse caso a foto fica de fora da publicação (fail-closed) até o operador usar "Tentar novamente", nunca aprovada por omissão.

**Retry em modo manual**: `retryPhotoModeration` — fotos que ficaram `pending`/`moderation_unavailable` de antes da mudança de modo (ou de uma falha técnica) são liberadas direto pra `manual_approved` quando a política ativa é `"manual"`, sem round-trip nenhum pro Storage/OpenAI. `rejected` continua definitivamente bloqueada (checagem roda antes da checagem de modo).

**Ativação futura**: bastar configurar `IMAGE_MODERATION_MODE=openai` + `OPENAI_API_KEY=<secret>` real. Fotos `manual_approved` existentes **não são reprocessadas automaticamente** (decisão de produto explícita, mesmo espírito de `legacy_approved` nunca ser remoderada) — remoderação histórica, se um dia for necessária, fica como processo separado e opcional, não implementado.

**Testes**: 8 casos mockados executados contra o código real (`npx tsx`) — `getImageModerationMode()` sem env var/`"manual"`/`"openai"`/valor inválido (`"OPENAI"`); `runPhotoModeration` em modo manual grava `manual_approved` sem baixar arquivo nem chamar `fetch` nenhuma vez; em modo `"openai"` sem chave e com falha de download, ambos resolvem `moderation_unavailable` (fluxo antigo intacto); confirmado por introspecção dos exports do módulo que não existe nenhuma função de reprocessamento em lote. **8/8 passaram.** Os itens que dependem de SQL (contagem de fotos aprovadas, filtro da API pública, cover) foram só revisados por leitura de código — migration `0044` continua não aplicada em produção, mesma lacuna já documentada nas seções 67-69.

## 72. Trial de 7 dias — anti-abuso por identidade (CPF/CNPJ + e-mail), não mais só documento (sessão de 2026-08-27)

Auditoria anterior (fora desta sessão) mostrou a lacuna: `trial_history` (migration 0031) só travava por CPF/CNPJ -- trocar de e-mail com o MESMO documento já bloqueava (bom), mas o inverso -- mesmo e-mail, documento novo -- não tinha proteção nenhuma. Nova regra de produto: **uma identidade só ganha o trial uma vez**, e "identidade" agora é documento **e** e-mail, cada um bloqueando sozinho (reusar QUALQUER um dos dois nega o trial, mesmo que o outro seja inédito). Migration nova, `0045` (não aplicada) -- 0044 (publicação/moderação) não foi tocada, são features independentes.

**Evolui `trial_history` em vez de criar tabela nova** (preferência do pedido, "menor complexidade, uma fonte de verdade só"): confirmado antes de mexer que a tabela está vazia em produção (auditoria da sessão anterior) -- mesmo assim a migration tem uma guarda (`do $$ ... raise exception se existir qualquer linha $$`) que recusa rodar se essa premissa não for mais verdade no momento em que for de fato aplicada, em vez de confiar cegamente numa informação que pode ter ficado desatualizada. A tabela é recriada com `document_fingerprint`/`email_fingerprint` (HMAC-SHA256 hex, nunca o CPF/e-mail em texto puro -- melhoria de privacidade pedida) e **dois unique index independentes** (não um composto) -- é essa a peça que resolve as 4 combinações da regra de produto com uma constraint só, sem `if` nenhum: reusar o documento (com e-mail novo) bate no unique de `document_fingerprint`; reusar o e-mail (com documento novo) bate no de `email_fingerprint`; qualquer um dos dois já usado nega o trial.

**Decisão de arquitetura mais importante desta etapa -- onde o fingerprint é calculado**: o pedido original sugeria computar o HMAC em TypeScript (Node, com `TRIAL_IDENTITY_PEPPER` de `.env`) e mandar o valor pronto pro gatilho via metadata do `auth.signUp()`. **Isso foi deliberadamente NÃO feito assim** -- o endpoint de signup do Supabase é público (a mesma chave anon que já fica exposta no bundle do navegador dá acesso a ele), then pode ser chamado DIRETO, sem passar pelo Server Action `signUp()` nenhuma vez. Se o gatilho confiasse num `document_fingerprint`/`email_fingerprint` pronto vindo de fora, um atacante batendo direto no endpoint do Supabase podia mandar qualquer valor aleatório ali e SEMPRE "parecer" uma identidade nova -- destruindo o anti-abuso por completo, pior que o comportamento atual (que já recalcula o CPF a partir do dado bruto dentro do próprio gatilho). Mesmo raciocínio já aplicado o projeto inteiro pra `create_marketplace_booking`/`validate_tour_for_publishing`: a fonte de verdade de segurança mora sempre no banco, nunca confia na camada de cima. Por isso: **o fingerprint que decide o trial é calculado dentro do próprio `handle_new_user()`, em PL/pgSQL**, a partir do documento bruto (recalculado da metadata, como já era) e do e-mail bruto (`new.email`, de `auth.users` -- nunca da metadata, que quem chama o signup escolhe livremente).

**`TRIAL_IDENTITY_PEPPER` em `.env.example` existe mesmo assim**, mas hoje só alimenta funções auxiliares em `src/lib/trial-identity.ts` (validação antecipada de CPF/CNPJ pro Server Action `signUp()`, com mensagem melhor -- "Informe um CPF ou CNPJ válido." -- em vez de só checar quantidade de dígitos como antes; e as funções de fingerprint, testáveis isoladamente, item pedido explicitamente). O pepper que de fato importa pra segurança mora **só no banco**, numa tabela travada nova (`public.trial_identity_secret`, RLS habilitada sem nenhuma policy -- mesmo padrão de `trial_history`), configurada manualmente via SQL direto em produção quando chegar a hora (nunca por migration, nunca commitado). Enquanto essa tabela estiver vazia, `handle_new_user()` trata como "pepper não configurado" e **não concede trial** (fail-closed no benefício, nunca na criação da conta -- o signup continua funcionando normalmente, só sem o bônus de 7 dias, até alguém configurar isto).

**CPF/CNPJ -- validação real, não só contagem de dígitos**: `src/lib/trial-identity.ts` (`isValidCpf`/`isValidCnpj`, dígito verificador padrão + rejeita sequência repetida tipo `11111111111`, que passaria no cálculo ingênuo por coincidência matemática) e o equivalente em PL/pgSQL na própria migration (`trial_validate_cpf`/`trial_validate_cnpj`) -- **as duas implementações precisam continuar idênticas**, documentado nos dois arquivos; algoritmo verificado por geração cruzada nos testes (gera um CPF/CNPJ válido com uma implementação independente do algoritmo, escrita só pro teste, e confirma que `isValidCpf`/`isValidCnpj` do módulo real aceitam). A do TypeScript é só UX (early-exit com mensagem melhor no formulário); a autoridade de verdade é sempre a do banco.

**Concorrência**: sem `SELECT EXISTS` antes do `INSERT` (a versão da migration 0031 tinha exatamente essa corrida -- duas requisições simultâneas com o mesmo CPF podiam ler "documento livre" antes de qualquer uma das duas inserir). Agora é `INSERT` direto em `trial_history` dentro de um bloco `exception when unique_violation` -- a garantia vem do unique index em si (atômico por natureza no Postgres), não de timing da aplicação. Duas ativações simultâneas com o mesmo documento (e-mails diferentes), o mesmo e-mail (documentos diferentes), ou os dois iguais: só a que gravar primeiro ganha o trial, sempre, não importa a ordem de leitura.

**Trial já usado / troca posterior**: comportamento preservado -- `paid_until = now()` (mesmo efeito de "vencido" que `getSubscriptionStatus()` já tratava), sem inventar cobrança nova. Claim nunca é atualizado/apagado por nenhum fluxo do app -- trocar CPF ou e-mail depois de usar o trial não libera o identificador antigo nem começa um trial novo pro identificador novo automaticamente (a checagem só acontece uma vez, no `handle_new_user()`, nunca em login/edição de perfil/refresh).

**Nova company pelo mesmo usuário**: auditado -- não existe nenhum fluxo em `src/` que crie uma `company` fora do gatilho `handle_new_user()` (só migrations antigas, todas versões passadas da mesma função, tocam `insert into companies`). Como `auth.users.email` já é único por natureza do próprio Supabase Auth, "criar outra company" exige um e-mail genuinamente novo -- e se o documento for reaproveitado, o unique de `document_fingerprint` já pega, sem precisar de proteção extra.

**Asaas**: não tocado -- nenhuma linha de `asaas_customer_id`/webhook/checkout foi alterada.

**Backfill dos 3 companies existentes**: **NÃO feito nesta etapa** (instrução explícita) -- sem jeito confiável de distinguir "trial histórico" de "já pago" automaticamente a partir do estado atual. Ver seção de backfill no relatório desta etapa (fica só como recomendação, não implementado): a estratégia sugerida é manual/explícita, empresa por empresa, quando/se fizer sentido.

**Testes**: 22 casos mockados (`npx tsx`, código real do módulo `trial-identity.ts`) -- CPF/CNPJ válido/checksum inválido/sequência repetida/formatado-normaliza/fingerprint determinística; e-mail case-insensitive/espaços/fingerprint independente de `companies.email`; prefixo `trial:document:v1:`/`trial:email:v1:` nunca colide pro mesmo valor bruto. Mais 10 casos simulando em memória a MESMA política do gatilho (dois unique index independentes, insert-primeiro-catch-conflito) pras 4 combinações de abuso (M-Q) e 3 cenários de concorrência (R-T) -- **simulação da lógica, não teste contra o Postgres de verdade** (migration 0045 não aplicada nesta etapa, mesma lacuna já documentada pra 0044). **32/32 passaram.**

## 73. Aplicação em produção de 0044-0045 + dois incidentes de `hmac()` corrigidos ao vivo (sessão de 2026-08-27/28)

Migrations `0044` e `0045` aplicadas em produção via `supabase db push --linked` (dry-run limpo antes, `migration list` confirmando `remote` igual a `local` depois). ACL revisada nas duas de novo antes de aplicar -- achado real corrigido: nenhuma função nova tinha `REVOKE` explícito (o mesmo achado da `0043`, EXECUTE concedido por padrão a `anon`/`authenticated` em toda função nova do schema `public`) -- corrigido em ambas antes do `push`.

**Incidente real, encontrado durante o teste pós-deploy, não antes**: `trial_fingerprint()` quebrava TODO signup novo em produção (`POST /auth/v1/signup` → 500 "Database error saving new user") -- `hmac()` do pgcrypto exige `bytea`, não `text`, e a função original passava `text` direto. Corrigido com dois hotfixes sucessivos, cada um autorizado e aplicado separadamente:

- **`0046`** -- adicionou o cast `::bytea` nos dois primeiros argumentos. Corrigiu o tipo, mas revelou a causa raiz real por trás do mesmo erro: `hmac()` está instalado no schema `extensions` neste projeto (convenção do Supabase Cloud), não em `public` -- e `trial_fingerprint()` tem `set search_path = public` (deliberado, é `SECURITY DEFINER`), então a chamada não-qualificada nunca resolvia, com ou sem os casts certos. Signup continuou quebrado depois deste hotfix sozinho.
- **`0047`** -- qualificou a chamada como `extensions.hmac(...)` (em vez de ampliar o `search_path` da função, mantendo a superfície de shadowing no mínimo necessário). Confirmado via `pg_proc` que `hmac(bytea,bytea,text)` e `hmac(text,text,text)` existem os dois, ambos só em `extensions`. Este resolveu de verdade.

Achado colateral, também real e também não-relacionado a estas migrations: durante o teste do fluxo completo via `POST /auth/v1/signup` (chave anon pública, mesmo caminho que um usuário real usa), a API passou a devolver 500 "Error sending confirmation email" -- rate limit do mailer padrão do Supabase (sem SMTP customizado configurado), provavelmente por causa do volume de tentativas de teste em sequência curta. Contornado pra fins de teste com `admin.auth.admin.createUser({ email_confirm: true })` -- dispara o mesmo gatilho `handle_new_user()` (reage a qualquer `INSERT` em `auth.users`, não importa a origem), sem depender do envio de e-mail. Confirmado que a transação inteira sempre reverte em qualquer uma dessas falhas -- nenhum usuário/company/profile órfão ficou de nenhuma tentativa que retornou erro, em nenhum dos dois incidentes.

**Teste completo pós-hotfix, com dados sintéticos temporários (limpos depois)**: identidade nova → trial de 7 dias exatos; mesmo documento + e-mail novo → sem trial (`paid_until ≈ now()`); mesmo e-mail + documento novo → rejeitado pelo próprio Supabase Auth antes de chegar no gatilho (unicidade de `auth.users.email`, uma camada de proteção a mais além do `unique(email_fingerprint)`); CPF `11111111111` e signup sem documento → sem trial nos dois; duas ativações simultâneas com o mesmo documento (e-mails diferentes) → exatamente uma ganhou trial, confirmado por contagem de `trial_history` (2 claims no total: identidade nova + a vencedora da concorrência -- nenhuma das outras 4 tentativas criou claim extra). **Todos os resultados bateram exatamente com o esperado.**

**Pepper configurado em produção**: gerado inteiramente DENTRO do Postgres (`encode(gen_random_bytes(32),'hex')`, `pgcrypto`) via `supabase db query --linked --file`, nunca passou pelo shell/Node/transcript em nenhum momento -- a alternativa mais segura das duas oferecidas. `trial_identity_secret` confirmada com exatamente 1 linha antes e depois de todos os testes (nunca lida, só `count(*)`).

**ACL confirmada ao vivo, não só por leitura de código**: `anon` tentando `SELECT` em `trial_identity_secret`/`trial_history` e RPC em `trial_fingerprint`/`trial_normalize_document`/`trial_normalize_email`/`trial_validate_cpf`/`trial_validate_cnpj`/`trial_validate_document` → `401` em todos. `create_marketplace_booking` com payload completo e válido → `401`, `code 42501 permission denied for function create_marketplace_booking` (o teste inicial com corpo vazio tinha dado `404`, um falso sinal por falta de overload correspondente, não por permissão -- corrigido testando com o payload real).

**Dados reais confirmados intocados ao final**: Admin Equipe Castro (`suspended_at: null`), Companies B/C (não tocadas, conforme instrução), passeio real `teste-integracao-toursflow-90f2bc` (`published`, `active`, não suspenso, 2 fotos `legacy_approved`, 2 saídas).

## 74. Rodada completa de hardening de segurança — 8 etapas, deploy em produção, pendências registradas (sessão de 2026-08-28)

Pedido do dono: auditoria de segurança formal (10 itens + isolamento multiempresa), seguida de correção controlada etapa por etapa (só uma etapa por vez, sempre com análise antes, testes depois, e parada explícita entre etapas), reauditoria final, mini-reauditoria pré-deploy, e só então commit → push → deploy.

**Auditoria original** encontrou 4 de 10 itens reprovados (Rate Limiting, Storage, Exposição de erros, Logging/alertas — todos ALTO/MÉDIO/BAIXO, nenhum CRÍTICO) mais achados adicionais (RPC legada `bootstrap_company` ainda com EXECUTE liberado, grants excessivos em `api_rate_limits`, script `scratchpad_test_new_link.mjs` rastreado com dado real hardcoded, `.env.example` incompleto). Isolamento multiempresa: **passou** já na auditoria original.

**Etapas de correção** (cada uma com análise prévia, teste dedicado e escopo estritamente isolado das demais):

- **Etapa 1 — Rate Limiting**: `src/lib/rate-limit.ts` (novo), reaproveitando `public.check_rate_limit`/`public.api_rate_limits` (migration `0042`). `signIn` 10/5min por IP, `signUp` 5/1h por IP, `forgotPassword` 5/1h por IP **e** 3/1h por hash de e-mail (sempre a mesma mensagem genérica, pra não vazar se o e-mail existe), API pública (`/api/public/*`) 600/60s **global** (não por IP — pode ser o próprio servidor do ToursFlow chamando). Fail-open nesses fluxos (diferente do marketplace, que é fail-closed) — proteção secundária não pode derrubar login pra todo mundo se a RPC falhar.
- **Etapa 2 — `bootstrap_company`**: RPC de cadastro antiga (pré-gatilho), sem uso desde a migration `0002`, mas com `EXECUTE` ainda liberado pra `PUBLIC`/`anon`/`authenticated` desde a `0000`. Migration `0049` revoga (função não foi apagada, só o acesso).
- **Etapa 3 — Exposição de erros**: eliminado o fallback cru `error.message` retornado ao cliente em ~30 pontos de Server Actions (admin, billing, clientes, configurações, embarcações, equipe, parceiros, passeios, reservas, saídas, redefinir-senha, login), trocado por `console.error` + mensagem genérica contextual. Toda mensagem de negócio específica (CPF duplicado, capacidade excedida, limite de passageiros, e-mail já cadastrado, `PUBLISH_VALIDATION_FAILED`) foi preservada intacta. Route Handlers já estavam seguros, nenhuma mudança lá.
- **Etapa 4 — Logging de segurança**: `src/lib/security-log.ts` (novo, `logSecurityEvent()`), best-effort sobre o Sentry já configurado (nunca deixa uma falha do Sentry derrubar autorização/rate limit). Três eventos: `admin_access_denied` (`src/lib/admin-auth.ts`), `rate_limited` (`src/lib/rate-limit.ts`), `marketplace_unauthorized` (`src/app/api/marketplace/bookings/route.ts`). Decisão explícita de **não** usar `admin_audit_log` pra isso — a RLS daquela tabela (migration `0016`) só deixa um `super_admin` inserir em nome de si mesmo, então estruturalmente não serve pra registrar tentativa de quem *não* é admin.
- **Etapa 5 — Bucket `assets` do Storage**: a auditoria original achou o bucket "vazio" — na hora de executar a remoção, uma nova checagem ao vivo achou 1 arquivo real (`icone_naiticflow.png`, provável sobra de teste do favicon, sem nenhuma referência em código/histórico). Etapa ficou **bloqueada** numa primeira passada até o dono confirmar que podia apagar; depois de confirmado, bucket e objetos removidos via Storage API. `tour-photos` não foi tocado.
- **Etapa 6 — Grants de `api_rate_limits`**: RLS sem policy já bloqueava `anon`/`authenticated` na prática, mas a tabela ainda tinha os grants padrão do Supabase pra essas roles. Migration `0050` revoga (`check_rate_limit` é `security definer`, roda como dono — revogar grant direto da tabela não afeta a RPC).
- **Etapa 7 — Limpeza técnica**: `scratchpad_test_new_link.mjs` removido (tinha `company_id` real e padrão de e-mail do dono hardcoded, sem uso em nenhum lugar). `.env.example` reescrito com todas as variáveis reais usadas no código, organizadas por bloco (Supabase, Aplicação, Asaas, Sentry, Marketplace/ToursFlow, Rate limiting), nenhum valor real.
- **Etapa 8 — achados da reauditoria final**: a reauditoria (ver abaixo) achou 3 problemas novos, corrigidos nesta etapa — open redirect em `/auth/callback` (allowlist explícita, `ALLOWED_NEXT_PATHS`), grants excessivos em `payments`/`processed_webhook_events` (migration `0051`, mesmo raciocínio da Etapa 6), e o campo `scope` do logging de rate limit indo em `extra` do Sentry em vez de `tags` (corrigido — agora é tag de verdade, filtro `scope:login:ip` funciona no painel).

**Reauditoria final** (antes da Etapa 8) revalidou os 10 itens do zero (não assumiu nada como certo só por já ter sido "marcado" corrigido), reconfirmou isolamento multiempresa (**passou**), e achou os 3 problemas da Etapa 8 acima — nenhum CRÍTICO ou ALTO, o mais sério (open redirect) era MÉDIO.

**Deploy**: um commit único (`e1d90ae`, `security: harden auth, rate limits and tenant protections`), push direto pra `main` (sem force), deploy automático confirmado em produção (`nauticflow.com.br`) e validado com smoke tests não-destrutivos (site no ar, open redirect corrigido de verdade em produção, API pública respondendo, erro genérico sem detalhe interno, `/admin` continua fechado). As migrations `0049`/`0050`/`0051` já estavam aplicadas em produção **antes** do commit (ações diretas contra o Supabase vinculado, independentes de deploy de código) — só as mudanças de código (rate limiting, mensagens de erro, logging, open redirect) dependiam do deploy pra valer.

**Monitores configurados manualmente no Sentry** (dashboard, feito pelo dono depois do deploy):

| Evento | Threshold | Environment | Notificação |
|---|---|---|---|
| `admin_access_denied` | 3+ em 10 minutos | `production` | E-mail |
| `rate_limited` (tag `scope` disponível pra filtrar por tipo) | 5+ em 15 minutos | `production` | E-mail |
| `marketplace_unauthorized` | 3+ em 5 minutos | `production` | E-mail |

### Pendências técnicas registradas (não bloqueantes — sistema em produção, `DEPLOY CONCLUÍDO — GO`)

Nenhum destes itens é uma vulnerabilidade em aberto nem impede o sistema de operar normalmente. São itens de manutenção/confiabilidade/observabilidade pra retomar numa rodada futura, quando fizer sentido.

**1. Limpeza/TTL de `api_rate_limits`** — a tabela não tem nenhuma política automática de retenção; cresce indefinidamente enquanto o rate limiting funcionar (o que é o esperado). Dívida técnica de manutenção, não vulnerabilidade. Revisão futura: definir retenção, TTL, job/cron de limpeza segura, e confirmar que isso não interfere no `check_rate_limit`.

**2. Rate limit global da API pública** (`/api/public/*`, ~600 req/60s) — decisão deliberada de ser global em vez de por-IP, porque não há garantia de que quem chama é sempre o navegador do visitante final (pode ser o próprio servidor do ToursFlow). Risco residual aceito: um único cliente malicioso pode consumir uma fatia grande (ou todo) do limite global temporariamente. Revisão futura, só se houver sinal de abuso real: granularidade por API key/client ID/tenant, ou combinação de identificadores.

**3. Rate limit de autenticação não cobre botnet distribuída** — `signIn`/`signUp` são limitados por IP; reduz abuso de uma única origem, mas não impede um ataque distribuído por muitos IPs diferentes. Limitação arquitetural conhecida, não bug. Revisão futura, só se necessário: proteção adicional por conta/e-mail, CAPTCHA/challenge adaptativo, detecção de comportamento, proteção upstream/CDN.

**4. Webhook Asaas — caminho de falha inesperada na deduplicação** (`src/app/api/webhooks/asaas/route.ts`, tabela `processed_webhook_events`) — **não é falha de segurança, é risco operacional/confiabilidade**, e por isso merece atenção redobrada quando for revisado. O fluxo hoje: insere `(provider, event_type, event_key)` em `processed_webhook_events` ANTES de renovar a assinatura; se o `INSERT` bate um evento já processado (`23505`, duplicidade esperada — o Asaas reenviando a mesma notificação), responde `{ok:true, duplicate:true}` sem reprocessar, corretamente. **O ponto em aberto**: se esse `INSERT` falhar por qualquer outro motivo — um erro de banco inesperado, não uma duplicidade —, o código também responde `{ok:true}` (pra não fazer o Asaas reenviar em loop), mas **sem renovar a assinatura**. Ou seja, existe um caminho onde um evento legítimo de pagamento confirmado pode não produzir a renovação esperada, sem gerar nenhum log/alerta hoje. Quando for retomado, revisar: o que fazer quando o erro não é `23505` (status HTTP retornado, se vale permitir retry seguro do lado do Asaas), logging/alerta desse caminho específico no Sentry, e garantir nos dois sentidos — nunca processar a mesma cobrança duas vezes, nunca perder um evento legítimo. Pagamento é área sensível; essa correção pede uma rodada própria, com análise e testes dedicados — **não mexida nesta rodada**.

**5. Migrations históricas (observação, não tarefa)** — `0000b_bootstrap_existing_signup.sql` e `0000c_confirm_existing_email.sql` são puladas pelo `supabase db push` toda vez (nome de arquivo fora do padrão `<timestamp>_name.sql`); os efeitos já estão nos dados de produção desde o início do projeto (conta do dono), sem nenhum drift funcional. A numeração das migrations também pula `0032`/`0033` — local e remoto concordam nisso, não é problema, só uma lacuna histórica na sequência.

### Estado de segurança

**Estas pendências não significam que o NauticFlow esteja aguardando correção pra operar.** A rodada de hardening foi concluída de ponta a ponta e o sistema recebeu `DEPLOY CONCLUÍDO — GO`. Os 5 itens acima são candidatos pra futuras rodadas de manutenção, confiabilidade, observabilidade e evolução arquitetural — nenhum é bloqueante.

### Como retomar esta revisão

Quando alguém pedir algo como "revise as pendências técnicas de segurança do NauticFlow" ou "veja o que ficou pendente da última auditoria": **primeiro consulte esta seção e confirme o estado atual do código e da produção antes de propor qualquer alteração**. Não assuma que as pendências acima continuam exatamente iguais — qualquer uma delas pode já ter sido resolvida numa sessão posterior (confira se existe uma seção mais recente que a mencione).

## 75. Fase 4A — fundação segura de pagamento do marketplace (sem movimentar dinheiro) (sessão de 2026-08-28)

Depois da auditoria de pagamentos (que confirmou: `payments` existe mas vazia/não usada, webhook Asaas é só do SaaS, split/PIX/cartão/confirmação/status API/voucher todos `NÃO IMPLEMENTADO`), esta etapa constrói a fundação **sem nenhuma chamada real ao Asaas**. Migration `0049` (local, **não aplicada** ainda -- aguardando autorização).

**Guard da wallet Asaas** (achado real da auditoria, corrigido aqui): `companies.asaas_wallet_id`/`asaas_receiver_status` podiam ser alterados por qualquer `company_admin`/`staff` via `UPDATE` comum -- inofensivo hoje (nada lê essas colunas ainda), mas vira risco assim que o Split existir. Trigger novo (`trg_company_asaas_receiver_guard`, mesmo padrão de `trg_tour_suspension_guard`) aceita `auth.role() = 'service_role'` OU `is_super_admin()` -- nunca o operador comum. Diferente da suspensão administrativa (que é ação humana via painel), a config de wallet é técnica (resultado de onboarding/OAuth do Asaas, processado só no backend), por isso o guard prioriza `service_role`, com `super_admin` como via de suporte manual.

**`payments` ganhou só o mínimo necessário PARA ESTA FASE**: `idempotency_key`, `request_fingerprint`, `payment_method` (`CHECK` só aceita `'pix'` -- único método planejado). Deliberadamente **não adicionados** (sem uso concreto ainda): `expires_at`, `provider_status`, `paid_at`, `failure_code` -- ficam para quando a Fase 4B/4C realmente escrever neles, evitando campo "pode ser útil".

**`create_marketplace_payment_attempt`** (RPC nova, `SECURITY DEFINER`, `service_role`-only): registra uma TENTATIVA de pagamento de forma idempotente (insert direto + catch de `unique_violation` no índice único de `idempotency_key` -- **sem** `pg_advisory_xact_lock`, diferente de `create_marketplace_booking`: aqui não há recurso finito compartilhado entre chamadas concorrentes DIFERENTES, o unique index já basta). Valida: booking existe e é `source='marketplace'`, `status='pendente'`, hold ainda válido (recusa se vencido -- ver ADR), tour ainda publicado/não suspenso, company não suspensa. **`amount_cents` é sempre `reservations.total_cents`** -- nunca um valor vindo do request (amount tampering estruturalmente impossível, o campo nem existe no payload aceito pela rota).

**Endpoints novos** (`POST /api/marketplace/bookings/[id]/payment`, `GET /api/marketplace/bookings/[id]`): mesma autenticação server-to-server de sempre (`Bearer` + `X-ToursFlow-Client-Key`, extraída para `isAuthorizedToursFlowRequest()` em `marketplace-api.ts` -- reaproveitada agora em 3 rotas, nunca duplicada). Rate limit próprio (`consumer_key: "toursflow:payment"`, isolado do de criação de reserva). O endpoint de pagamento valida e persiste a tentativa de verdade (idempotência real, testável de verdade), mas sempre termina em `PAYMENT_PROVIDER_NOT_ENABLED` (`501`) -- `isMarketplacePaymentsEnabled()` (env `MARKETPLACE_PAYMENTS_ENABLED`, mesmo padrão de `IMAGE_MODERATION_MODE`: flag explícita, nunca inferida pela ausência de chave) está sempre `false` nesta fase. `GET .../[id]` devolve só `bookingId`/`bookingStatus`/`holdExpiresAt`/`quantity`/`priceCents`/`totalCents`/`payment.{status,method}` -- nunca `client_id`, CPF, e-mail/telefone, nem nada do Asaas (chave, payload bruto, wallet).

**`createMarketplacePayment()`** (`src/lib/asaas.ts`): adapter pronto para a Fase 4B, com guard interno redundante (`isMarketplacePaymentsEnabled()` checado de novo por dentro, mesmo espírito de `runPhotoModeration` -- nunca confia só no chamador ter checado antes). **Nenhum caminho de produção a invoca nesta fase** -- só testada com `fetch` mockado.

**Política de hold expirado formalizada em ADR** (`docs/adr/0001-hold-expirado-vs-pagamento-confirmado.md`): duas regras deliberadamente diferentes -- iniciar pagamento novo com hold vencido → **recusa** (`HOLD_EXPIRED`, já implementado); confirmação de pagamento chegando depois do hold vencer (Fase 4C, **ainda não implementada**) → revalidar capacidade atomicamente antes de confirmar, nunca confirmar se a vaga já foi ocupada por outra pessoa nesse meio tempo (overbooking é pior que perder uma venda), nunca fazer refund automático sem decisão explícita futura.

**Split**: confirmado de novo, ao vivo, que nenhuma company (nem Admin Equipe Castro) tem `asaas_wallet_id` configurado -- bloqueador registrado, não implementado, nenhum percentual/wallet inventado.

**Testes**: suíte mockada cobrindo guard de wallet (simulação de `auth.role()`), idempotência/fingerprint da RPC de pagamento (mesma técnica de simulação em memória já usada para `trial_history`), validação do endpoint (IDOR entre bookings, hold vencido, booking não-pendente, company/tour suspensos, amount nunca aceito do body, `createMarketplacePayment()` mockado nunca chamando rede de verdade). Migration revisada estaticamente e via `dry-run` -- **não aplicada em produção** nesta etapa.

## 76. Revisão final da Fase 4A — duas correções reais antes de aprovar + incidente no histórico de migrations (sessão de 2026-08-28)

Revisão pré-commit da Fase 4A encontrou dois problemas reais, os dois corrigidos ainda dentro da migration `0049` (local, segue não aplicada):

**1) Uma reserva podia gerar duas cobranças ativas.** `idempotency_key` sozinha só protege contra replay da MESMA tentativa -- nada impedia `reservation_id=X` + `idempotency_key=A` criar um `payment pending`, e depois `reservation_id=X` + `idempotency_key=B` (diferente) criar um SEGUNDO `payment pending` pra mesma reserva. Corrigido com `payments_one_active_per_reservation` -- unique index parcial em `reservation_id` `where status in ('pending','paid')`. Regra de quando uma nova tentativa é permitida: só depois que a anterior sair de `pending`/`paid` -- `failed` libera retry (cobrança recusada/expirada, legítimo tentar de novo); `refunded`/`partially_refunded` também liberam (a constraint não julga se uma nova cobrança faz sentido de negócio depois de um estorno, só não impede estruturalmente); `paid` sozinho bloqueia pra sempre até virar refund -- nunca duas cobranças pagas pra mesma reserva. RPC ganhou um segundo `unique_violation` tratado (`PAYMENT_ALREADY_ACTIVE`, `409`), distinto do de idempotência.

**2) Provider desabilitado criava um "payment fantasma".** A ordem original chamava a RPC (que persiste um `payment pending`) e só DEPOIS checava `isMarketplacePaymentsEnabled()`, retornando `501` -- ou seja, mesmo desligado, uma linha `pending` real ficava gravada, sem nunca virar cobrança de verdade. Combinado com a correção 1 acima, isso seria pior: essa linha fantasma ocuparia o único slot `pending`/`paid` permitido por reserva e bloquearia pra sempre a tentativa de verdade quando a Fase 4B ligasse o provider. Corrigido movendo a checagem da flag pra ANTES de qualquer chamada à RPC/escrita em `payments` -- confirmado por leitura de código E por checagem de posição de string no arquivo real (não só inspeção visual). Efeito colateral aceito, deliberado: com o provider desligado, o endpoint sempre devolve `501` primeiro, mesmo que a reserva também tivesse outro problema (ex: hold vencido) -- escolhido como a opção mais simples e consistente.

**Wallet guard reconfirmado**: o trigger dispara sempre que `asaas_wallet_id`/`asaas_receiver_status` fazem parte do `UPDATE` (mesmo que o valor não mude de verdade) -- comportamento intencional, mesmo padrão já em produção pra `trg_tour_suspension_guard`, mais seguro que só reagir quando o valor muda de fato (fecha até um caminho de "update sem efeito" como vetor). `UPDATE` de outras colunas de `companies` nunca dispara este gatilho (é `BEFORE UPDATE OF <colunas específicas>`). Nenhum bypass por incluir várias colunas no mesmo `UPDATE` -- o gatilho roda por linha, independente de quantas outras colunas também estão sendo alteradas na mesma instrução, e a exceção aborta a transação inteira.

**RPC ACL reconfirmada, desta vez sem repetir o erro da `0044`/`0048`**: `create_marketplace_payment_attempt` não chama nenhuma outra função por dentro (só `SELECT`/`INSERT` direto nas tabelas) -- não há risco de uma função interna com ACL incompatível (o problema que gerou a `0048`). `authenticated` sem `EXECUTE` (confirmado correto desta vez -- a rota só é chamada `server-to-server` via `service_role`, nunca por uma sessão de operador).

**Incidente real, não relacionado ao código**: um `db push --linked --dry-run` anterior deixou `supabase_migrations.schema_migrations` (tabela de controle do próprio Supabase CLI) registrando `0049` como aplicada -- **sem nenhuma mudança real existir no banco**, confirmado (`0` colunas/função/trigger). Corrigido, com autorização, via `supabase migration repair --status reverted 0049` -- comando oficial que só toca a tabela de controle, nunca schema/dado do produto. Sem essa correção, uma aplicação real futura da `0049` teria sido silenciosamente pulada pelo CLI (achando que já tinha rodado).

**Testes**: 8 casos novos (mesma técnica de simulação em memória, migration ainda não aplicada) cobrindo exatamente os 5 cenários pedidos na revisão -- mesma key duas vezes → replay; key diferente na mesma reserva → bloqueado; `failed` libera retry; `paid` bloqueia; `refunded` libera; corrida com keys diferentes → só uma vence. **8/8 passaram.**

## 77. Reconciliação da Fase 4A/4B com o hardening de segurança de `main` — rebase local (sessão de 2026-08-29)

`feature/marketplace-payments` (criada a partir de `453e079`) e o hardening de segurança (seção 74, commits `e1d90ae`/`571f57a`, pushados direto pra `main`) avançaram em paralelo, sem saber um do outro -- a colisão de numeração de migrations tratada na seção 79 abaixo foi um sintoma disso. Depois de fechar a revisão financeira da Fase 4B, esta sessão reconciliou a branch com o `main` atualizado antes de qualquer commit novo.

**Levantamento (sem merge/rebase até confirmar)**: `git diff --stat` nos dois sentidos (`main...HEAD` e `origin/main...HEAD`) mostrou que o hardening tocou 32 arquivos; desses, só **dois** se sobrepunham a arquivos desta branch -- `DOCUMENTACAO.md` (esta seção) e `src/app/api/marketplace/bookings/route.ts` (conflito de conteúdo real). `tsconfig.tsbuildinfo` também aparecia nas duas listas, mas é artefato de build gerado, sem conteúdo pra reconciliar manualmente. Nenhuma migration nova colidia (`0052`/`0053` seguiam livres).

**Conflito em `bookings/route.ts`, resolvido com autorização explícita**: esta branch tinha extraído a autenticação server-to-server (`isAuthorized`/`safeEqual` locais) pra um helper compartilhado, `isAuthorizedToursFlowRequest()` (`src/lib/marketplace-api.ts`), reaproveitado em 3 rotas. O hardening, sem saber disso, tinha mantido a implementação local duplicada e envolvido a falha de autorização com `logSecurityEvent("marketplace_unauthorized")` (`src/lib/security-log.ts`, novo). Resolução escolhida (autorizada explicitamente, sem decisão unilateral): manter o helper compartilhado (`isAuthorizedToursFlowRequest`) -- que já encapsula a MESMA comparação em tempo constante (`timingSafeEqual`) que a versão local do hardening, confirmado por leitura de código antes de resolver -- e adicionar `logSecurityEvent(...)` por cima dele na rota, preservando a separação de responsabilidade (autenticação no helper, decisão de resposta HTTP + logging na rota). Nenhuma implementação duplicada de `isAuthorized`/`safeEqual` foi recriada.

**Conflito em `DOCUMENTACAO.md`, resolvido preservando os dois lados**: ambos os trabalhos anexavam seções novas no mesmo ponto do arquivo (fim do documento) -- resolvido mantendo TODO o conteúdo dos dois lados, sem apagar nenhuma seção, renumerando a sequência pra ficar coerente: a seção 74 (hardening) ficou como estava; as seções que eram 74/75 nesta branch (Fase 4A e sua revisão) viraram 75/76; a Fase 4B, o incidente de renumeração de migrations e a revisão final da Fase 4B (que já usavam 76/77/78 antes desta reconciliação) foram renumeradas pra 78/79/80 depois do `git stash pop` que trouxe esse conteúdo de volta.

**`tsconfig.tsbuildinfo`**: conflito resolvido regenerando o arquivo (`npx tsc --noEmit`) em vez de reconciliar manualmente um artefato de build.

**Resultado**: `git diff main...HEAD` depois do rebase mostra só a Fase 4A + Fase 4B por cima do `main` já atualizado com o hardening -- nenhuma proteção do hardening foi revertida, nenhum trabalho desta branch foi perdido. `main`/`origin/main` continuam intocados (só a branch local foi rebaseada; nada commitado além do que já existia, nada pushado).

## 78. Fase 4B — ledger financeiro, retenção D+1, saque e motor de reembolso (sem movimentar dinheiro) (sessão de 2026-08-29)

Migration `0050` (local, **não aplicada**) + `src/lib/marketplace-ledger.ts` (funções puras). Decisão de arquitetura completa em `docs/adr/0002-marketplace-ledger-payout-refund.md`. Nenhuma chamada real ao Asaas, nenhum PIX, nenhuma transferência, nenhum refund real -- só schema + RPCs `service_role`-only, testadas isoladamente.

**Por que não Split imediato**: repassaria o dinheiro do operador antes de saber se o passeio vai acontecer de verdade -- modelo escolhido retém internamente (ledger) e só libera depois do serviço prestado + D+1, como marketplaces de reserva que retêm repasse até a experiência acontecer.

**Ledger**: modelo B (eventos semânticos com `bucket` explícito), não saldo por conta com +/-. Cada linha é um fato imutável (append-only de verdade -- nem `service_role` tem `INSERT`/`UPDATE`/`DELETE` direto via `GRANT`, só as RPCs `SECURITY DEFINER`, que escrevem como dono da tabela). Reclassificar dinheiro entre buckets (liberar, sacar) nunca edita uma linha -- sempre insere um PAR balanceado novo. `payments`/`marketplace_withdrawals` são ENTIDADES com ciclo de vida (podem mudar de status) -- só o ledger é append-only, distinção documentada explicitamente pra nunca confundir os dois conceitos.

**Saldos**: `get_marketplace_operator_balances()` -- 4 valores (`blocked`/`available`/`pending_withdrawal`/`transferred`), sempre `SUM` ao vivo, nunca armazenados/cacheados.

**D+1**: 24h corridas depois de `departures.departs_at` (a hora AGENDADA, nunca "quando o operador clicou em algo" -- reduz manipulação). Critério de liberação combina DOIS sinais independentes: `departures.status='encerrada'` (já existia no schema desde a `0000`, não inventado) + o relógio real já ter passado -- mesmo que o operador marque `'encerrada'` cedo demais, o relógio ainda bloqueia. Limitação conhecida e aceita: editar `departs_at` pra uma data passada continua sendo um vetor de fraude mais sofisticado, fora do escopo de "impedir o bypass óbvio" desta fase.

**Comissão**: `marketplace_fee_config`, versionada (nunca `UPDATE`), vazia por padrão -- nenhum percentual inventado. Enquanto vazia, `MARKETPLACE_FEE_NOT_CONFIGURED` (pagamento permanece desabilitado). `calculateMarketplaceAmounts()` arredonda a comissão sempre pra baixo, operador fica com o resto -- `fee + operator = gross` garantido por construção, nunca por checagem depois.

**Snapshot financeiro**: `payments.gross_amount_cents`/`platform_fee_cents`/`operator_amount_cents` congelados uma única vez, na CONFIRMAÇÃO (`record_marketplace_payment_confirmed`) -- uma mudança futura na comissão global nunca afeta vendas já confirmadas. `CHECK` garante que os três estão todos `NULL` ou todos preenchidos e balanceados.

**Motor de reembolso**: `calculateRefund()`, função pura, aceita um **snapshot** da política (nunca a política "atual" -- ainda não existe fonte real de política por passeio no produto, formato definido mas sem implementação, percentuais de teste são sintéticos, nunca oficiais). `legalOverride` sempre vence a política comercial, inclusive com `reservationOutcome='completed'`. No-show usa a mesma tabela de faixas da política (decisão explícita: não é "operador fica com 100%" automaticamente).

**Achados reais da própria revisão desta fase, corrigidos antes de fechar**:
- `record_marketplace_refund` tinha uma variável reaproveitada com tipo errado (bucket vs. amount) -- corrigido antes de qualquer teste.
- `create_marketplace_withdrawal` **não tinha idempotência** -- um retry de rede criaria um segundo saque, debitando `available` duas vezes. Corrigido com `idempotency_key` própria + `unique index`, mesmo padrão de toda escrita do projeto.

**Saque**: concorrência real (dois pedidos distintos da mesma empresa que juntos excederiam o disponível) protegida por `pg_advisory_xact_lock` por `company_id` -- serializa todas as tentativas da mesma empresa, mesmo padrão/motivo de `create_marketplace_booking` (0042): checagem de saldo suficiente não é resolvível só com um unique index, precisa de lock de verdade.

**Reembolso após liberação/saque**: dedução automática de `blocked` ou `available` (detecta sozinho onde o dinheiro está, checando se já existe o par de liberação) -- reembolso de saldo já `transferred` (sacado) **não implementado**, documentado como pendência explícita (cenário de dívida do operador).

**Segundo incidente de histórico de migrations, mesmo padrão do anterior**: `db push --linked --dry-run` deixou o histórico remoto com `0049`, `0050` **e uma `0051` fantasma sem arquivo local correspondente** -- confirmado de novo que nada foi de fato aplicado (0 tabelas/colunas/funções). Corrigido com `migration repair --status reverted 0049 0050 0051`. Causa raiz **não determinada com certeza** -- indício circunstancial real: o CLI avisa em toda chamada que os nomes de migration deste projeto (`NNNN_nome.sql`, 4 dígitos) não batem com o padrão de timestamp completo que ele espera, o que é plausível como superfície do bug, mas não uma prova do mecanismo exato. Mitigação adotada: minimizar chamadas a `db push --dry-run` pelo resto da sessão, preferir `migration list`/`db query` pra inspeção.

**Testes**: 25/25 passaram -- matemática de comissão e reembolso balanceada em todos os casos (incluindo arredondamento, 100%/0%/parcial, legal override sobrepondo `completed`, imutabilidade do snapshot), ledger simulado (pagamento confirmado cria saldo bloqueado uma vez, replay não duplica, comissão de outra company isolada, liberação respeita D+1 e status de departure, release replay não duplica, saque respeita saldo disponível e concorrência via idempotency key, refund reduz o bucket certo e não duplica).

## 79. Colisão real de numeração de migrations com trabalho paralelo + renumeração 0049/0050 → 0052/0053 (sessão de 2026-08-29)

**O "segundo incidente" descrito na seção 78 não era um bug do CLI -- era uma colisão real com outro trabalho.** Enquanto esta sessão trabalhava isolada na branch `feature/marketplace-payments`, outro trabalho de hardening de segurança (achados de RPC/GRANT legados -- `bootstrap_company`, `api_rate_limits`, `payments`/`processed_webhook_events`) foi commitado e pushado direto para `main` (commits `e1d90ae`/`571f57a`), usando exatamente os números `0049`, `0050` e `0051` para suas próprias migrations -- os MESMOS números que esta sessão já tinha usado (sem saber da colisão, por estar isolada numa branch) para "fundação de pagamento" e "ledger financeiro".

Quando o `db push --dry-run` da seção 78 acusou uma "0051" desconhecida, o diagnóstico foi interpretado como bug do CLI -- **estava errado**. Era uma migration real, de outro trabalho, de fato aplicada em produção. O `migration repair --status reverted 0049 0050 0051` da seção 78 marcou incorretamente essas 3 migrations de hardening (reais, aplicadas) como "não aplicadas" no histórico -- corrigido nesta etapa:

1. Confirmado ao vivo (antes de qualquer correção) que as 3 migrations de hardening realmente produziram efeito em produção: `bootstrap_company` sem `EXECUTE` para `anon`/`authenticated`; `api_rate_limits`/`payments`/`processed_webhook_events` sem `GRANT` de tabela para os mesmos papéis.
2. `git checkout origin/main -- <os 3 arquivos de hardening>` -- trazidos para esta branch, sem misturar o resto do commit de hardening.
3. **Minhas próprias migrations renumeradas** para os próximos números livres: `0049_fundacao_pagamento_marketplace.sql` → `0052_...`, `0050_marketplace_financial_ledger.sql` → `0053_...` -- todas as referências internas (comentários, ADRs `0001`/`0002`) atualizadas para os novos números.
4. `migration repair --status applied 0049 0050 0051` -- restaura a verdade (essas 3 são do hardening, estão aplicadas de verdade).
5. Confirmado ao final: `migration list --linked` mostra `0049`/`0050`/`0051` com `remote` preenchido (hardening, aplicadas) e `0052`/`0053` com `remote` vazio (minhas, não aplicadas) -- histórico sincronizado com a realidade dos dois trabalhos.

## 80. Revisão final da Fase 4B — hardening da liberação financeira (service_at_snapshot imutável, remanescente por reserva, concorrência saque×reembolso) (sessão de 2026-08-29)

Revisão pré-commit da Fase 4B, focada num único ponto: `departures.departs_at` é **mutável** e a versão anterior do ledger usava esse valor ao vivo pra decidir liberação (D+1) -- um operador reagendando/backdatando a saída DEPOIS de um pagamento confirmado alteraria retroativamente a data de liberação daquele dinheiro. Migration `0053` (ainda local, não aplicada) ganhou 4 correções reais:

**1) `payments.service_at_snapshot`, capturado uma única vez.** Coluna nova, preenchida exclusivamente dentro de `record_marketplace_payment_confirmed`, lida direto de `departures.departs_at` NAQUELE INSTANTE -- nenhuma API/RPC aceita isso como parâmetro externo (nenhum `serviceAt`/`departureAt` de fora tem autoridade). `release_marketplace_reservation_balance` passou a usar exclusivamente este snapshot pro cálculo de D+1, nunca mais `departs_at` ao vivo. Testado: pagamento confirmado com snapshot=A, depois `departs_at` "alterado" pra B -- liberação continua usando A. Testado também o caso backdate (saída original no futuro, "backdatada" pro passado) -- não acelera a liberação, porque o snapshot real já estava fixado no futuro.

**2) Imutabilidade como invariante de banco, não só disciplina de código.** Trigger novo `trg_payments_financial_snapshot_immutable` (`BEFORE UPDATE` em `payments`): uma vez que o conjunto de snapshots financeiros (`gross_amount_cents`/`platform_fee_cents`/`operator_amount_cents`/`cancellation_policy_snapshot`/`service_at_snapshot`) é gravado, qualquer `UPDATE` que tente alterar qualquer um deles é barrado com `FINANCIAL_SNAPSHOT_IMMUTABLE` -- mesmo um bug futuro em outra RPC. `CHECK` `payments_amounts_balance_check` passou a exigir `service_at_snapshot IS NOT NULL` como parte do "conjunto completo ou nada".

**3) Liberação usa o saldo bloqueado REMANESCENTE da reserva, nunca o valor original da venda.** Achado real: a versão anterior de `release_marketplace_reservation_balance` sempre liberava `payments.operator_amount_cents` (o valor ORIGINAL, cego a reembolsos já ocorridos) -- se um reembolso parcial já tivesse reduzido o `blocked` daquela reserva, a liberação teria sobrecreditado `available` (ou deixado `blocked` negativo). Corrigido: nova coluna `marketplace_ledger_entries.reservation_id` (normaliza a reserva de origem de cada entrada, já que `reference_id` aponta pra ids diferentes conforme `entry_type`) permite somar exatamente "quanto ainda está bloqueado para ESTA reserva" e liberar só esse remanescente. Testado: reembolso parcial de 3000 sobre um blocked de 9000, liberação subsequente move exatamente os 6000 remanescentes (não 9000).

**4) Reembolso nunca deixa `blocked`/`available` negativos, e ganhou proteção de concorrência real contra saque.** Achados: (a) `record_marketplace_refund` não validava se a dedução pedida cabia no saldo real do bucket de destino -- corrigido com uma checagem de saldo suficiente antes do insert (`REFUND_EXCEEDS_BLOCKED_BALANCE`/`REFUND_EXCEEDS_AVAILABLE_BALANCE`, fail-closed, sem modelo de dívida nesta fase); (b) nenhuma trava protegia um reembolso deduzindo de `available` contra um saque concorrente da mesma empresa disputando o mesmo saldo -- cenário testado explicitamente (available=100000, saque de 80000 processado primeiro, reembolso de 50000 em seguida corretamente recusado, pois só sobravam 20000) -- corrigido com a MESMA chave de `pg_advisory_xact_lock` já usada por `create_marketplace_withdrawal` (preferência explícita: uma trava por company cobrindo toda operação que consome `available`, não uma trava por tipo de operação); (c) adicionada uma segunda trava por RESERVA (`marketplace_reservation_balance`), usada tanto por `release_marketplace_reservation_balance` quanto por `record_marketplace_refund` quando ainda em `blocked`, prevenindo uma corrida entre liberação e reembolso da MESMA reserva. Ordem fixa de aquisição (company antes de reserva) evita qualquer caminho de deadlock entre as funções.

**`departures.status = 'encerrada'`**: confirmado que qualquer membro autenticado da company pode marcar via a RLS "própria empresa" já existente desde a `0000` -- não restringido nesta revisão, e não precisa ser: o status sozinho nunca libera dinheiro (é só um dos dois sinais exigidos, o outro é o relógio imutável do snapshot).

**Comissão**: reconfirmado que `marketplace_fee_config` continua vazia (nenhuma linha inserida nesta revisão, nenhum percentual assumido) -- `MARKETPLACE_FEE_NOT_CONFIGURED` continua bloqueando qualquer confirmação de pagamento.

**Ledger append-only reconfirmado**: `REVOKE ALL ... FROM public, anon, authenticated, service_role` na tabela continua intacto (nem `service_role` grava direto); todas as RPCs continuam `SECURITY DEFINER`, `service_role`-only, `search_path = public` explícito.

**Migrations 0052/0053 reconfirmadas**: `0052` = fundação de pagamento (Fase 4A), `0053` = ledger financeiro (Fase 4B) -- únicas migrations desta fase, ambas ainda não aplicadas. `0049`/`0050`/`0051` no branch são as migrations REAIS de hardening trazidas de `origin/main` (ver seção 79) -- não tocadas.

**Reconciliação com `main`**: `origin/main` tinha avançado 2 commits (`e1d90ae`, `571f57a`) desde o ponto onde `feature/marketplace-payments` foi criada -- levantamento completo, conflito identificado em `bookings/route.ts` e resolução (com autorização explícita do usuário) documentados na seção 77. Esta seção registra só os achados FINANCEIROS da revisão; a reconciliação de git em si tem seção própria.

**Testes**: 22 cenários (simulação em memória, mesma técnica das fases anteriores, RPCs em SQL ainda não aplicadas) -- snapshot imutável ignora `departs_at` alterado depois; backdate não acelera liberação; reembolso parcial antes da liberação move só o remanescente; reembolso após liberação deduz de `available` e recusa exceder o saldo; concorrência saque×reembolso (cenário exato do pedido: 100000/80000/50000) recusa corretamente o segundo; replay de release/refund/withdrawal não duplica efeito em nenhum dos três; sanidade de `calculateMarketplaceAmounts`/`calculateRefund` (não alteradas nesta revisão). **22/22 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, só 4 warnings pré-existentes de `<img>`) e `npx next build` -- todos limpos.

**Lição registrada**: numerar uma migration nova sem primeiro conferir `origin/main` (não só a branch local de trabalho) é arriscado quando existe qualquer possibilidade de trabalho concorrente em outra sessão/branch. Nenhum schema ou dado do produto foi afetado por nenhum dos dois incidentes de histórico (nem o desta seção, nem o da seção 78) -- só a tabela de controle do Supabase CLI, sempre corrigida via o comando oficial (`migration repair`), nunca por acesso direto à tabela.

## 81. Bloqueio de rede deste ambiente impede validação remota de migrations (não é problema da Fase 4B) (sessão de 2026-08-31)

Depois de fechar a revisão financeira e a reconciliação de git da Fase 4B (seções 77-80), a etapa final pendente era rodar `supabase migration list --linked` e `supabase db push --linked --dry-run` (somente leitura) pra confirmar que `0049`/`0050`/`0051` (hardening, de `main`) aparecem aplicadas e só `0052`/`0053` (Fase 4A/4B, locais) aparecem pendentes -- **nunca aplicar nada**. As 3 tentativas falharam com o mesmo erro: `LegacyDbConfigConnectTempRoleError`, `failed to connect to postgres ... Connection timed out`.

**Diagnóstico completo (somente leitura, nenhum banco/schema/dado tocado)** determinou que isso é um **bloqueio de rede de saída deste ambiente específico de execução**, não um problema da Fase 4B, do projeto Supabase, do CLI ou de configuração:

- `supabase projects list` (só Management API via HTTPS, nunca abre conexão Postgres) funciona perfeitamente -- projeto `NauticFlow` (`gggpihphjjxndpfntnvm`) confirmado `ACTIVE_HEALTHY`, `linked: true`, ref local bate com o remoto. Isso descarta problema de sessão/token do CLI, de link desatualizado ou de configuração de projeto.
- `config.toml` coerente (major_version 17, bate com o remoto), CLI na versão `2.114.0`, nenhuma variável de pooler/DB/senha sobrescrita localmente.
- TCP conecta normalmente em `aws-1-us-east-2.pooler.supabase.com:5432` (`nc` bem-sucedido), mas um teste direto de protocolo (socket cru enviando o pacote `SSLRequest` real do wire protocol do Postgres) não recebeu NENHUMA resposta em 15s -- o TCP "conecta", mas nenhum dado de protocolo Postgres de verdade trafega. Padrão típico de um proxy/firewall de saída que só libera tráfego HTTP(S) de verdade e descarta o resto silenciosamente.
- O host de conexão direta (`db.gggpihphjjxndpfntnvm.supabase.co`, obtido da própria `projects list`) nem resolve por DNS a partir daqui (`ENOTFOUND`), enquanto o hostname do pooler resolve normalmente -- indício de um allowlist de DNS de saída restrito a hosts específicos deste ambiente, não do projeto.

**Conclusão**: qualquer ferramenta que precise de uma conexão Postgres direta (CLI, `psql`, um script com driver `pg`) falharia do mesmo jeito nesta rede -- o problema é de transporte, não da ferramenta. `supabase_migrations.schema_migrations` também não é alcançável via PostgREST/Data API (schema não exposto em `config.toml`), então não existe um caminho somente-leitura alternativo genuinamente equivalente disponível de dentro deste ambiente. **A validação remota de `migration list`/`db push --dry-run` precisa ser executada fora deste sandbox** (terminal local do usuário, ou um ambiente de CI/CD com saída de rede liberada para Postgres) antes de qualquer aplicação real das migrations `0052`/`0053`.

**Nada foi alterado**: `SUPABASE_DB_PASSWORD` não tocado, nenhum `migration repair`/`db push`/`db reset` executado, nenhuma migration editada, nenhum schema/dado de produto alterado -- só comandos de diagnóstico somente-leitura (Management API, `nc`, socket TCP cru sem autenticação).

**Status da Fase 4B**: tecnicamente pronta (correções financeiras da revisão final + reconciliação de git com o hardening de `main`, ambas completas e testadas -- ver seções 77-80) -- mas o fechamento formal continua **pendente** de uma validação remota de migrations feita fora deste ambiente, por bloqueio operacional de rede, não por qualquer problema técnico da fase em si. Nenhum commit novo foi feito por causa disso.

## 82. Chave Pix do operador + reconfirmação da regra de liberação (sem transferência real) (sessão de 2026-08-31)

Depois do commit local da Fase 4B (`de81def`), próxima etapa financeira: fechar PARA ONDE um saque real transferiria o saldo `available` do operador, e reconfirmar a regra de liberação contra cenários levantados nesta revisão (check-in, cancelamento, no-show). Migration `0054` (local, **não aplicada**) + `src/lib/payout-accounts.ts` (funções puras). Decisão de arquitetura completa em `docs/adr/0003-marketplace-payout-destination-and-release-policy.md`. Nenhuma transferência real, nenhum saque real, nenhuma validação de titularidade no provider, nenhuma chamada ao Asaas.

**Chave Pix, nunca credencial bancária**: `marketplace_payout_accounts` guarda só tipo (`cpf`/`cnpj`/`email`/`telefone`/`evp`) + valor normalizado -- nunca senha, nunca dado de acesso a banco (nem pedido no formulário). CPF/CNPJ validados por checksum REAL (dois dígitos verificadores, `src/lib/payout-accounts.ts` espelhando `trial_validate_cpf`/`trial_validate_cnpj` da migration `0045` em TypeScript; a RPC em SQL reaproveita as funções originais diretamente, nunca duplica o algoritmo em SQL). E-mail/telefone/EVP validados estruturalmente. **Validar formato não confirma titularidade** -- toda conta nasce `unverified`, único status possível nesta fase (nenhum "verified" inventado sem confirmação real do provider).

**Uma conta corrente por empresa, histórico nunca apagado**: `unique index ... where status <> 'superseded'`. Trocar a chave nunca faz `UPDATE`/`DELETE` na linha existente -- marca a antiga `superseded` e insere uma nova `unverified`. Testado: segunda chave substitui a primeira como única corrente, a anterior vira `superseded` (nunca desaparece), total de linhas só cresce.

**Mascaramento -- chave completa nunca exposta**: `mask_pix_key()` (SQL) espelha `maskPixKey()` (TS), mesmo contrato de manutenção das duplicações anteriores deste projeto. Nenhuma RPC devolve a coluna crua. A tabela é a mais restrita do projeto -- `REVOKE ALL` inclui até `service_role` (nenhuma leitura crua existe hoje, nem pelo backend, porque não existe necessidade legítima ainda -- nenhum payout real). Testado: as 5 máscaras batem exatamente com os formatos pedidos (`***.***.***-42`, `**.***.***/****-NN`, `jo***@gmail.com`, `(**) *****-NNNN`, `prefixo...sufixo`) e nenhuma contém a chave completa.

**Modelo de confiança invertido em relação à Fase 4A/4B**: as RPCs de `0052`/`0053` são server-to-server (`service_role`, ToursFlow). As desta migration são self-service do PRÓPRIO operador (`authenticated`, sessão normal do NauticFlow) -- ACL invertida (`grant` só pra `authenticated`), e `company_id`/`role` sempre derivados de `auth.uid()` dentro da RPC, nunca de um parâmetro. **IDOR estruturalmente impossível**: nenhuma das 3 RPCs (`set_marketplace_payout_account`, `get_marketplace_payout_account`, `get_marketplace_financial_summary`) tem um parâmetro de `company_id`/id de destino -- não existe valor que um chamador possa passar pra tentar ler/alterar a conta de outra empresa. Restrito a `role in ('company_admin', 'super_admin')` -- mesmo corte já usado na página Financeiro (staff redirecionado), reforçado no banco também.

**Alteração de chave**: sessão autenticada + checagem de role + validação server-side (nunca confia só na UI, revalida formato dentro da própria RPC) + `logSecurityEvent("marketplace_payout_account_changed", { companyId, pixKeyType })` -- nunca a chave em si -- + `created_at` de cada linha. 2FA **não implementado** (sem infraestrutura no projeto ainda), registrado como hardening futuro explícito.

**Regra de liberação -- reconfirmada, não alterada**: as condições da revisão final da Fase 4B (seção 80) continuam intactas. Reconfirmado com teste explícito (não eram bugs, eram invariantes que já existiam implicitamente): reserva `cancelada` nunca libera (`BOOKING_NOT_CONFIRMED`, `reservations.status <> 'confirmada'`); saída `cancelada` nunca libera (`DEPARTURE_NOT_CONCLUDED`, `departures.status <> 'encerrada'`).

**Check-in auditado antes de inventar qualquer modelo novo**: existe, sim -- `passengers.status` (`'confirmado'|'embarcado'|'ausente'`, migration `0000`), alternável por qualquer `company_admin`/`staff` autenticado via `/reservas/[id]` (`setPassengerStatus`), sem timestamp dedicado (só `created_at` do cadastro do passageiro, não de quando foi marcado embarcado). **Decisão: check-in NÃO libera saldo** -- é prova de presença de UM passageiro, não do passeio inteiro; critério financeiro continua sendo `departures.status`+relógio, no nível da SAÍDA. Saída encerrada sem nenhum check-in registrado: não muda a regra automaticamente, registrado como possível sinal de auditoria futura (não implementado). No-show: reafirmado que NUNCA equivale a `completed` -- ainda sem persistência real de outcome por reserva (pendência já registrada no ADR `0002`).

**`available_at`**: avaliado e decidido NÃO persistir -- cálculo dinâmico (`service_at_snapshot + 24h <= now()`) já é barato e determinístico a partir de uma coluna imutável; persistir criaria uma segunda fonte de verdade sem necessidade real.

**Painel financeiro**: `get_marketplace_financial_summary()` combina `get_marketplace_operator_balances()` (`0053`, chamada internamente) com a conta de recebimento mascarada, numa RPC só, `authenticated`-scoped. Não expõe o ledger bruto. UI mínima adicionada em `/financeiro` (card "Marketplace ToursFlow — Recebimento": 4 saldos + chave mascarada + formulário de cadastro/troca) -- **sem botão de saque**, nem desabilitado (decisão de simplicidade).

**Testes**: 39 cenários (checksum real de CPF/CNPJ válido/inválido/sequência repetida, e-mail, telefone, EVP, normalização, as 5 máscaras batendo com os formatos pedidos e nunca contendo a chave completa, IDOR estrutural via inspeção das assinaturas das 3 RPCs -- nenhuma aceita `company_id`, todas restritas a `company_admin`/`super_admin`, log de segurança sem a chave, substituição de chave preservando histórico, reserva/saída cancelada nunca libera saldo). **39/39 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, 4 warnings pré-existentes) e `npx next build` -- todos limpos. **Não testado nesta sessão**: fluxo interativo real no navegador (login como `company_admin`, preencher e submeter o formulário) -- sem credenciais/browser interativo disponíveis neste ambiente; verificação limitada a build+typecheck+lint+revisão de código, mesma limitação já registrada para outras mudanças de UI desta sessão.

**Migration `0054`**: nova, não sobrescreve `0052`/`0053` (ainda não aplicadas). Não aplicada nesta etapa.

## 83. Cancelamento, no-show, outcome da reserva e motor de reembolso em duas fases (sem estorno real) (sessão de 2026-08-31)

Próxima etapa financeira depois do payout account (seção 82): fechar cancelamento/no-show/outcome/política real de reembolso. Migration `0055` (local, **não aplicada**), estende (via `create or replace function`, nunca editando os arquivos `0053`/`0054`) `record_marketplace_payment_confirmed` e `release_marketplace_reservation_balance`. Decisão de arquitetura completa em `docs/adr/0004-marketplace-cancellation-no-show-refund-policy.md`. Nenhum estorno real, nenhuma chamada ao Asaas, nenhuma alteração no ToursFlow.

**Achado importante antes de implementar**: `tours.cancellation_policy` **já existia** (migration `0039`) -- mas é texto livre de MARKETING (mesma família de `included`/`not_included`), não a estrutura de faixas que o motor de reembolso precisa. Auditado antes de inventar qualquer coisa -- coluna nova e deliberadamente batizada diferente: `tours.marketplace_refund_policy jsonb` (mesmo formato de `CancellationPolicy`, `src/lib/marketplace-ledger.ts`), validada por trigger espelhando `isValidCancellationPolicy`. Nenhum percentual oficial definido -- nasce `NULL` em todo passeio.

**Outcome da reserva**: `reservations.outcome` (nullable, `completed`/`no_show`) -- não duplica `status` (`cancelada` já cobre cancelamento). `derive_marketplace_reservation_outcome()` deriva: `status='cancelada'` → `cancelled`; senão `outcome` se preenchido; senão indeterminado (falha fechada pra qualquer cálculo de reembolso). `set_marketplace_reservation_outcome`: `company_admin`/`staff` registram (mesmo corte do check-in); mudar um outcome já definido pra outro valor exige `super_admin` (override sinalizado e logado). Nunca antes do horário real da saída -- usa `service_at_snapshot` quando existe pagamento confirmado (nunca `departs_at` ao vivo, mesmo motivo do release), senão `departs_at` direto. `OUTCOME_TOO_EARLY` fecha o vetor "marcar no-show cedo pra acelerar receita".

**Check-in continua só evidência**: `passengers.status='embarcado'` não alterado, nenhuma RPC nova lê/decide com base nele -- só exibido como contexto informativo (contagem embarcados/ausentes) ao lado dos botões de outcome na UI, decisão humana sempre.

**Snapshot da política**: `record_marketplace_payment_confirmed` (estendida) agora também congela `payments.cancellation_policy_snapshot` a partir de `tours.marketplace_refund_policy`, no mesmo instante em que já congela `service_at_snapshot` -- ambos protegidos pelo mesmo trigger de imutabilidade (`0053`). Política do tour mudando depois nunca afeta venda já confirmada.

**Legal override**: só `super_admin` pode acionar (`FORBIDDEN_LEGAL_OVERRIDE` pro operador), sempre com motivo não-vazio (`LEGAL_OVERRIDE_REASON_REQUIRED`), `authorized_by`/`created_at` registrados em `marketplace_refunds`.

**Motor de reembolso em DUAS FASES** (não síncrono como a primeira versão em `0053`): `create_marketplace_refund_request` reserva o impacto imediatamente (bucket de origem → novo bucket `refund_pending`, espelha `withdrawal_pending`) e cria uma linha `pending` em `marketplace_refunds` (nova tabela, ciclo de vida `pending/processing/completed/failed/manual_review`, mesmo padrão de `marketplace_withdrawals`). `complete_marketplace_refund_request` fecha (Fase futura, quando existir confirmação real do provider) -- sucesso remove de `refund_pending` sem destino (saiu do sistema); falha devolve pro bucket de origem. `record_marketplace_refund` (`0053`, síncrona) fica preservada no banco, **superada, não removida, não chamada por nenhum código novo** -- documentado explicitamente, não uma remoção silenciosa.

**Nunca saldo negativo**: se o valor não cabe no bucket calculado (incluindo o caso extremo de já ter sido `transferred`/sacado), o pedido nasce direto em `manual_review`, sem tocar o ledger -- mesma filosofia de "sem modelo de dívida ainda" do ADR `0002`.

**Concorrência**: reaproveita as MESMAS duas travas de `record_marketplace_refund` (0053) -- company (`marketplace_withdrawal`) sempre, reserva (`marketplace_reservation_balance`) sempre, mesma ordem fixa. Nenhuma trava nova inventada.

**`release_marketplace_reservation_balance` estendida**: recusa liberar (`REFUND_PENDING`) enquanto existir qualquer `marketplace_refunds` com status `pending`/`processing`/`manual_review` pra mesma reserva -- "não liberar cegamente" com reembolso em aberto, pedido explícito desta revisão.

**Origem do cancelamento**: `cancelled_by_type` (`customer`/`operator`/`system`/`admin`) **derivado** da role de quem chama, nunca aceito como parâmetro. `reason_code` restrito a vocabulário fechado de 6 valores (nunca string livre do browser) -- inclui `departure_cancelled` como razão distinta de cancelamento individual, sem gatilho automático implementado ainda.

**UI mínima**: `/reservas/[id]` ganhou botões "Marcar concluído"/"Marcar no-show" com contagem de embarque como contexto, badge do outcome, mensagens de erro claras. **Nenhum botão de cancelamento/reembolso** foi adicionado -- decisão explícita, RPCs prontas e testadas mas sem superfície de UI ainda. Exibição da política aplicável na UI foi deliberadamente adiada (registrada como pendência, não omissão).

**Segurança**: todas as RPCs novas `SECURITY DEFINER`, `company_id`/`role` sempre de `auth.uid()` (IDOR fechado por construção, mesmo modelo de `0054`). Mutações financeiras restritas a `company_admin`/`super_admin`; outcome (operacional) também permite `staff`.

**Testes**: 37 cenários (política: 100%/parcial/0%/boundary exata/inválida/overlap/snapshot antigo preservado/legal override; outcome: completed/no_show válidos, cedo demais, company errada, reserva cancelada, check-in não decide sozinho, replay, override por super_admin; financeiro: refund blocked/available/parcial/total, refund antes e depois do release, refund excede saldo → manual_review, saldo já transferred → manual_review, concorrência saque×refund, release×refund concorrente recusado, replay de create/complete não duplica). **37/37 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, 4 warnings pré-existentes) e `npx next build` -- todos limpos.

**Migration `0055`**: nova, não sobrescreve `0052`/`0053`/`0054` (nenhuma aplicada ainda). Não aplicada nesta etapa.

## 84. Saque Pix do operador -- adapter pronto pra Asaas, modo mock/sandbox controlado (sessão de 2026-08-31)

Próxima etapa financeira depois de cancelamento/no-show/refund (seção 83): fechar o fluxo de SAQUE do operador usando a chave Pix cadastrada (seção 82), com adapter pronto pra Asaas mas em modo mock/sandbox nesta fase. Migration `0056` (local, **não aplicada**). Decisão de arquitetura completa em `docs/adr/0005-marketplace-withdrawal-and-pix-payout.md`. Nenhuma transferência real, nenhum dinheiro real se move.

**Achado arquitetural**: `companies.asaas_wallet_id`/`asaas_receiver_status` (migration `0052`) foram provisionadas pro modelo de SPLIT do Asaas -- explicitamente REJEITADO no ADR `0002` em favor da retenção interna + payout Pix direto. `request_marketplace_withdrawal` (nova) não checa `asaas_receiver_status` -- checaria o campo do modelo errado (nenhuma company tem isso configurado, deixaria todo saque falhando pelo motivo errado). A checagem real é `marketplace_payout_accounts.verification_status`.

**Titularidade como dimensão separada**: `marketplace_payout_accounts` ganhou `verification_status` (`unverified`/`verified`/`rejected`), SEPARADO de `status` (que já representava "chave corrente ou substituída", seção 82 -- confundir os dois teria sido um erro). Só `service_role` escreve verification_status (`mark_marketplace_payout_account_verified`) -- titularidade nunca autodeclarada pelo operador. Produção sem integração real: toda chave fica `unverified` pra sempre, todo saque real falha fechado por construção.

**`create_marketplace_withdrawal`/`complete_marketplace_withdrawal` (0053) superadas**: mesmo padrão de `record_marketplace_refund` → `create_marketplace_refund_request` (seção 83) -- mudança de modelo de confiança (`service_role`+`company_id` parâmetro → `authenticated`+`auth.uid()` self-service) exige assinatura nova. `request_marketplace_withdrawal`/`finalize_marketplace_withdrawal` (novas) são as usadas de fato; as de `0053` continuam definidas, preservadas, não chamadas por nenhum código novo.

**Nunca aceita chave Pix do request**: `request_marketplace_withdrawal` recebe só `amountCents`+`Idempotency-Key` -- destino sempre resolvido server-side.

**Concorrência/idempotência**: mesma trava advisory por company de sempre (`0053`/`0055`), nenhuma nova. Idempotência por `idempotency_key` própria. Cenário do pedido (saldo 100000, duas requisições simultâneas de 80000) testado -- só uma passa.

**`blocked` nunca vira saque direto**: `request_marketplace_withdrawal` só lê `available_balance_cents` -- única porta de `blocked→available` continua sendo `release_marketplace_reservation_balance`.

**Refund pendente bloqueia saque**: `MANUAL_REVIEW_PENDING` recusa novo saque enquanto existir qualquer `marketplace_refunds` da empresa em `manual_review` -- fail closed até resolução administrativa (mesma pendência do ADR `0004`).

**Snapshot da conta**: `marketplace_withdrawals.payout_account_id` capturado uma única vez na criação -- trocar de chave Pix NUNCA redireciona uma transferência já em andamento. Testado: saque criado com chave A permanece com A mesmo após A virar `superseded`; um saque novo, criado depois da troca, já nasce com B.

**Adapter (`createMarketplacePixTransfer`, `src/lib/asaas.ts`)**: guard duplo -- `MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED` (default false) + `MARKETPLACE_WITHDRAWAL_MOCK_MODE` (simula sucesso sem nenhuma chamada de rede, sem `ASAAS_API_KEY`, zero risco). Revalida a chave (checksum) por conta própria. **Pendência explícita**: formato do payload `/transfers` e nomes de evento de webhook (`TRANSFER_DONE`/`TRANSFER_FAILED`) refletem entendimento geral da API do Asaas, NÃO confirmados contra documentação ao vivo nesta sessão (sem acesso a rede externa) -- registrado como pendência, não fato verificado.

**Leitura crua da chave -- exceção deliberada**: `get_marketplace_payout_account_raw_for_transfer` (service_role-only) é a ÚNICA exceção à decisão de `0054` ("nenhuma leitura crua, nem pro backend") -- necessidade legítima nova (repassar ao provider), escopo estreito, documentada.

**Taxas do provider**: `provider_fee_cents`/`net_transfer_cents` -- `NULL` até confirmação real, nunca assume Pix grátis nem inventa valor.

**Webhook estendido, fluxo SaaS intocado**: `src/app/api/webhooks/asaas/route.ts` distingue `payment` (existente) de `transfer` (novo) pelo corpo do evento -- mesma verificação de token, mesma tabela `processed_webhook_events` (0037) pra idempotência. `externalReference` da transferência é sempre `marketplace_withdrawals.id`, nunca a chave Pix.

**Segurança**: chave nunca completa em `list_marketplace_withdrawals` (sempre `mask_pix_key`) nem em `logSecurityEvent` (só companyId/withdrawalId/amountCents) -- testado.

**UI**: botão "Sacar" (desabilitado com motivo quando não há chave verificada), painel inline de confirmação (mesmo padrão de seção expansível de `PayoutAccountForm`, sem componente de modal no projeto), histórico de saques com estados traduzidos e motivo de falha seguro.

**Testes**: 28 cenários (saldo suficiente/insuficiente, amount zero/negativo, saque parcial/total, concorrência 100000/80000/80000, replay idempotente, key conflitante, payout account ausente/unverified, isolamento por company, refund pendente bloqueando saque, manual_review de outra empresa não bloqueia, provider success/failure, saldo volta em failure, webhook replay não duplica, troca de Pix não afeta saque em andamento, chave nunca em logs/respostas). **28/28 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, 4 warnings pré-existentes) e `npx next build` -- todos limpos.

**Migration `0056`**: nova, não sobrescreve `0052`-`0055` (nenhuma aplicada ainda). Não aplicada nesta etapa.

## 85. Revisão do saque Pix contra o contrato oficial do Asaas Transfer -- 3 correções reais (sessão de 2026-08-31)

Revisão pré-commit da seção 84, com o contrato oficial do `POST /v3/transfers` fornecido explicitamente (não mais "entendimento geral" -- especificação real desta vez). Migration `0056` **editada diretamente** (autorizado explicitamente pra esta revisão, já que ainda não foi aplicada -- diferente da regra padrão de nunca editar migration já entregue em revisão anterior). Encontrados e corrigidos 3 problemas reais antes do commit:

**1) Só 2 dos 7 eventos oficiais de transferência eram tratados.** A primeira versão reconhecia só `TRANSFER_DONE`/`TRANSFER_FAILED` -- os outros 5 (`TRANSFER_CREATED`, `TRANSFER_PENDING`, `TRANSFER_IN_BANK_PROCESSING`, `TRANSFER_BLOCKED`, `TRANSFER_CANCELLED`) eram silenciosamente ignorados pelo webhook (sem quebrar nada, mas um saque real ficaria preso sem nunca avançar de status até um evento reconhecido chegar). Corrigido: os 4 eventos intermediários avançam o saque pra `processing` (idempotente, sem tocar o ledger); os 3 desfechos definitivos (`DONE`/`FAILED`/`CANCELLED`) chamam `finalize_marketplace_withdrawal`. **`TRANSFER_BLOCKED` tratado com cuidado especial**: não é falha definitiva -- o saldo continua reservado, o saque continua `processing`, nada no ledger muda (testado explicitamente). **`TRANSFER_CANCELLED` ganhou status e `entry_type` próprios** (`finalize_marketplace_withdrawal` trocou `p_succeeded boolean` por `p_outcome text` -- `'completed'|'failed'|'cancelled'` --, novo `entry_type='withdrawal_cancelled'` no ledger, distinto de `withdrawal_failed`, pra auditoria nunca confundir "cancelado" com "recusado pelo banco").

**2) Idempotência do webhook estava deduplicando pela chave errada.** A versão anterior deduplicava por `(event_type, transfer.id)`, copiando ingenuamente o padrão do fluxo de pagamento SaaS (`payment.id`, migration `0037`). Isso funciona pra pagamento (cada evento só faz sentido uma vez por cobrança), mas uma transferência pode legitimamente reenviar o MESMO `event_type` mais de uma vez como atualização de progresso -- deduplicar só por `(event_type, transfer.id)` arriscava descartar uma atualização legítima (mesmo sem consequência financeira real, já que os eventos intermediários são idempotentes por natureza, mas ainda assim um comportamento errado). Corrigido: chave de idempotência agora é `body.id` (o id do EVENTO em si, distinto de `transfer.id`), com fallback pra `transfer.id` só se o provider não enviar id de evento. Testado: dois eventos diferentes da mesma transferência (`PENDING` depois `DONE`) processam normalmente; o mesmo evento reenviado (mesmo id) é deduplicado. Fluxo de pagamento SaaS **não foi tocado**.

**3) Conversão de centavos pra reais sem proteção contra imprecisão de ponto flutuante.** `params.amountCents / 100` direto no payload -- corrigido com `centsToReaisForProvider()` (`src/lib/asaas.ts`), `.toFixed(2)` explícito, isolado numa função só, testado contra os 4 valores pedidos (1, 100, 1050, 85000 centavos) mais um valor classicamente propenso a erro (20957 → 209.57 exato, sem o `0.1+0.2` do JavaScript). Conversão só acontece na borda da chamada ao provider -- `amountCents` continua inteiro em todo cálculo interno.

**Confirmado correto, sem mudança necessária**: payload (`value`/`pixAddressKey`/`pixAddressKeyType`/`externalReference`), mapeamento de tipo de chave (`cpf→CPF`, `cnpj→CNPJ`, `email→EMAIL`, `telefone→PHONE`, `evp→EVP`), `externalReference` já era `marketplace_withdrawals.id` (nunca company_id/chave/CPF/CNPJ/e-mail/telefone). Adicionado `operationType: "PIX"` ao payload (não estava antes).

**Pendência que permanece em aberto**: formato exato do campo PHONE (com/sem `+55`) não confirmado nem nesta revisão -- dígitos normalizados enviados como estão, registrado explicitamente.

**Testes**: 34 cenários (payload oficial, mapeamento dos 5 tipos de chave, conversão cents→reais nos 4 valores pedidos + caso de imprecisão, os 7 eventos oficiais tratados corretamente -- CREATED/PENDING/IN_BANK_PROCESSING → processing sem tocar ledger, BLOCKED mantém reservado, DONE→completed sem devolver saldo, FAILED→failed devolve saldo, CANCELLED→cancelled devolve saldo com entry_type próprio, replay do mesmo evento não duplica em nenhum dos dois casos, eventos fora de ordem processam corretamente, dois eventos diferentes da mesma transferência não bloqueiam um ao outro). **34/34 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, 4 warnings pré-existentes) e `npx next build` -- todos limpos. Nenhum teste acessou `api.asaas.com`/`api-sandbox.asaas.com` de verdade -- confirmado estruturalmente que o modo mock retorna antes de qualquer chamada de rede.

**Migration `0056`**: editada (não uma nova migration) -- autorizado explicitamente pra esta revisão, ainda não aplicada.

## 86. Comissão global do marketplace -- 10% inicial, snapshot de basis points, arquitetura pra override por empresa (sessão de 2026-08-31)

Decisão de produto: comissão global inicial do marketplace ToursFlow = 10% (1000 basis points), vale só pra NOVAS confirmações, nunca retroativa. Migration `0057` (local, **não aplicada**). Decisão de arquitetura completa em `docs/adr/0006-marketplace-global-commission.md`. Nenhuma chamada real ao Asaas, nenhum pagamento real ativado por esta fase.

**`calculateMarketplaceAmounts()` não mudou** -- já era determinística (floor na taxa, operador com o resto, `fee+operator=gross` por construção). Testada agora contra o valor real: 10% de R$100/R$500/R$1000, valores com centavos (R$10,01 → taxa R$1,00, não R$1,01), valor mínimo (1 centavo → taxa 0, operador fica com o centavo inteiro -- nunca some), fee=0 como config válida (distinta de ausência de config), fee>100%/negativa rejeitadas.

**`fee_basis_points_snapshot`**: coluna nova em `payments`, congelada junto com gross/fee/operator/policy/service_at na confirmação -- faltava guardar o PERCENTUAL exato (só dava pra inferir aproximadamente antes). Protegida pelo mesmo trigger de imutabilidade e pelo mesmo CHECK "conjunto completo ou nada" (ambos estendidos nesta migration).

**Mudança futura nunca retroativa**: testado explicitamente -- Venda A confirmada a 10%, config muda pra 12% depois, replay de A continua devolvendo o snapshot original (10%); Venda B, confirmada depois da mudança, usa 12%. Comportamento já garantido pela arquitetura existente (replay de payment `paid` sempre devolve o snapshot gravado) -- confirmado com teste, não alterado.

**Ledger reconfirmado com o valor real**: gross=R$1.000, fee=10% → `platform_revenue` recebe R$100, `operator_blocked` recebe R$900 -- nunca `operator_blocked = gross`.

**Refund usa o snapshot da venda, nunca a config atual**: reconfirmado -- `calculate_marketplace_refund_amounts` deriva a comissão de `payments.operator_amount_cents`/`gross_amount_cents` (snapshot), nunca reconsulta a config. Testado: venda a 10%, config muda pra 20% depois, refund daquela venda continua usando 10%.

**Saque -- isolamento de bucket reconfirmado**: `platform_revenue` nunca soma no saldo sacável do operador -- testado com o valor real (10% de R$1.000: sacável = R$900, os R$100 de comissão ficam num bucket estruturalmente inacessível).

**Arquitetura pronta pra override por empresa, NÃO implementado**: `marketplace_fee_config` ganhou `company_id` nullable (NULL=global, único tipo de linha real hoje). `get_current_marketplace_fee_config(p_company_id)` -- NOVO overload de 1 parâmetro (o de 0 parâmetros, `0053`, continua existindo intocado, sem uso novo -- são funções distintas por assinatura em Postgres). Prioriza override da empresa se existir, fallback pro global. Nenhuma linha com `company_id` preenchido é criada nesta fase.

**Admin sem UI nova**: guard de `0053` (`service_role`/`super_admin` only pra INSERT) reconfirmado, não alterado. `get_current_marketplace_fee_config` nunca concedido a `authenticated` -- operador não lê a config diretamente.

**Achado real -- por que o seed de 10% NÃO está dentro da migration**: `marketplace_fee_config` é protegida por um guard que depende de `auth.role()`/`auth.uid()`, que só resolvem valor real dentro de uma requisição autenticada -- uma migration rodando via `db push` conecta sem contexto de JWT, então `auth.role()` resolveria NULL e o INSERT provavelmente seria barrado pelo próprio guard. Mesmo motivo, mesmo padrão já usado pro pepper de trial (`0045`/`0046`): o INSERT real do valor de 10% fica como um comando SEPARADO, documentado, a ser executado (com autorização própria) depois da migration `0057` já aplicada -- nunca dentro do `db push`. Até essa linha existir de verdade, `MARKETPLACE_FEE_NOT_CONFIGURED` continua bloqueando toda confirmação, mesmo com a migration aplicada.

**UI**: `/reservas/[id]` ganhou um bloco "Venda / Taxa marketplace / Você recebe" (só quando existe pagamento confirmado), valores em R$ direto dos snapshots -- nenhum basis point exposto na UI.

**Testes**: 24 cenários (10% de 3 valores redondos, centavos quebrados com arredondamento determinístico, valor mínimo, fee=0 válida vs. ausência de config, fee>100%/negativa rejeitadas, ausência total de config → fail closed, ledger platform_revenue vs operator_blocked com valor real, mudança 10%→12% não afeta snapshot antigo -- replay confirma, venda nova usa o novo valor, refund usa snapshot mesmo com config já mudada, isolamento de bucket no saque, verificação estrutural de que nenhum grant novo abre a config pro operador). **24/24 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, 4 warnings pré-existentes) e `npx next build` -- todos limpos.

**Migration `0057`**: nova, não sobrescreve `0052`-`0056` (nenhuma aplicada ainda). Não aplicada nesta etapa. Seed de 10% preparado como comando separado, não executado.

## 87. Operação administrativa oficial pra configurar a comissão global -- fecha a pendência do seed (sessão de 2026-08-31)

Fechamento da seção 86: em vez de depender de um `INSERT` solto executado à mão em `marketplace_fee_config`, migration `0058` (local, **não aplicada**) cria `set_marketplace_global_fee_config(p_fee_basis_points, p_note)` -- único caminho oficial pra configurar a comissão global. Decisão de arquitetura completa em `docs/adr/0006-marketplace-global-commission.md` (seções novas). Nenhum pagamento real ativado, nenhuma chamada ao Asaas.

**Por que uma RPC em tempo de execução resolve o que o `INSERT` na migration não resolvia**: o problema encontrado na seção 86 era específico da conexão de `db push` (sem contexto de JWT, `auth.role()` resolve NULL). Uma chamada à RPC em produção -- via `service_role` (script/backend) ou uma sessão `authenticated` real de `super_admin` -- **tem** JWT de verdade, então `auth.role()`/`is_super_admin()` resolvem corretamente e o guard (trigger de `0053` + checagem redundante dentro da própria RPC) funciona como desenhado.

**Autorização testada nos 6 papéis**: `service_role`✓, `super_admin`✓ (via sessão `authenticated` real + `is_super_admin()`), `company_admin`✗, `staff`✗, `authenticated` comum✗, `anon`✗ (`FORBIDDEN` em todos os 4 últimos).

**ACL revisada explicitamente, sem repetir o incidente `0044`/`0048`**: `EXECUTE` concedido a `authenticated` (necessário -- não existe papel Postgres/PostgREST separado pra `super_admin`, a sessão dele é uma `authenticated` normal) e a `service_role` -- não é contradição com "authenticated comum nunca configura", a restrição real é a checagem de role DENTRO da função, não a ACL do Postgres. Confirmado que a função não chama nenhuma outra função com ACL própria por dentro (só `is_super_admin()`) -- sem o padrão de chamada transitiva que gerou o incidente anterior.

**`SECURITY DEFINER` necessário**: a tabela não concede `INSERT` a ninguém além do dono -- sem isso, nem um `super_admin` autenticado teria privilégio de escrita.

**Versionamento reconfirmado**: cada chamada insere uma linha nova, nunca sobrescreve. Testado: 1000→1200 gera duas linhas, config vigente muda pra 1200, mas o snapshot já capturado por uma venda anterior permanece 1000 (protegido pelo trigger de imutabilidade de `payments`, não por esta função).

**Range**: 0 (0%, válido) até 10000 (100%, teto real -- nenhum limite comercial abaixo disso foi inventado) aceitos; negativo e >10000 rejeitados (`INVALID_FEE_BASIS_POINTS`).

**Procedimento futuro exato pra ativar os 10%**: `supabase.rpc('set_marketplace_global_fee_config', { p_fee_basis_points: 1000, p_note: '...' })`, chamado com a `service_role` key ou por sessão de `super_admin`, com autorização própria e SEPARADA, depois de `0057`/`0058` já aplicadas. Até essa chamada acontecer de verdade, `MARKETPLACE_FEE_NOT_CONFIGURED` continua bloqueando toda confirmação -- schema pronto não é configuração ativa.

**Testes**: 23 cenários (matriz de autorização nos 6 papéis, range 0/1000/10000 aceitos e negativo/>10000 rejeitados, versionamento 1000→1200 com snapshot antigo preservado, ausência de config continua fail-closed, verificação estrutural do ACL real no arquivo -- revoke de public/anon, grant só service_role+authenticated, checagem FORBIDDEN presente, SECURITY DEFINER presente, search_path fixo, nenhuma chamada transitiva arriscada). **23/23 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, 4 warnings pré-existentes) e `npx next build` -- todos limpos.

**Migration `0058`**: nova, não sobrescreve `0052`-`0057` (nenhuma aplicada ainda). Não aplicada nesta etapa.

## 88. Pix do cliente -- cobrança real Asaas, QR Code, webhook de liquidação, confirmação atômica (sessão de 2026-08-31)

Fluxo completo de cobrança PIX do turista: ToursFlow cria booking/hold → solicita payment → NauticFlow cria/recupera customer Asaas → cria cobrança PIX → obtém QR Code → cliente paga → webhook → liquida payment → confirma reservation → comissão 10%/90% → D+1 → saque. Migration `0059` (local, **não aplicada**). Decisão de arquitetura completa em `docs/adr/0007-marketplace-pix-payment-settlement.md`. `MARKETPLACE_PAYMENTS_ENABLED` continua false por padrão; `MARKETPLACE_PAYMENTS_MODE` precisa estar explicitamente configurado pra qualquer chamada de rede.

**Asaas customer separado do SaaS**: `clients.asaas_customer_id` (novo) -- nunca confundido com `companies.asaas_customer_id` (mensalidade do operador, `0012`). `findOrCreateMarketplaceAsaasCustomer()` é função nova, separada de `findOrCreateCustomer()`.

**CPF/CNPJ obrigatório, checado antes de persistir**: `create_marketplace_payment_attempt` (estendida, mesma assinatura de `0052`) valida checksum real (reaproveita `trial_validate_cpf`/`trial_validate_cnpj`) ANTES do insert -- mesma disciplina "checar antes de persistir" do achado da Fase 4A (provider desabilitado). `CUSTOMER_DOCUMENT_REQUIRED` (422) se ausente/inválido.

**Deduplicação de customer e cobrança**: reconciliação por `externalReference` -- reutiliza se persistido; senão consulta o Asaas antes de criar (`GET /customers?externalReference=`/`GET /payments?externalReference=`); resultado ambíguo (>1) falha fechado, nunca adivinha.

**Contrato oficial confirmado**: `POST /v3/payments` (customer/billingType=PIX/value/dueDate/externalReference=payments.id interno, nunca reservation cru/CPF/e-mail/company_id/chave Pix); `GET /payments/{id}/pixQrCode` (payload/encodedImage/expirationDate, nunca persistido no banco).

**Amount sempre do NauticFlow**: `amount_cents` de `reservations.total_cents`, nunca aceito do ToursFlow -- reconfirmado, não alterado desde a Fase 4A.

**Comissão reaproveitada**: `marketplace_fee_config` continua vazia, `MARKETPLACE_FEE_NOT_CONFIGURED` bloqueia liquidação real até configuração via `set_marketplace_global_fee_config` (seção 87). Nenhum fallback de 10% hardcoded.

**Hold vs. QR Code**: `hold_expires_at` continua sendo a autoridade de exibição -- `GET .../bookings/[id]` só reinclui `pix` na resposta enquanto `payment.status='pending'` E o hold ainda não venceu.

**Pagamento tardio -- política do ADR 0001 finalmente implementada**: `settle_marketplace_payment_received` nunca confirma cegamente -- revalida capacidade ATOMICAMENTE via `trg_reservation_capacity` (migration `0000`, disparado pelo próprio `UPDATE reservations SET status='confirmada'`, sem checagem TypeScript separada). Capacidade OK → confirma normalmente. Capacidade perdida → payment marcado `paid` (dinheiro real), reserva NUNCA confirmada, operador NUNCA recebe `operator_blocked`, `marketplace_refunds` nasce em `manual_review` (`reason_code='settlement_exception'`, novo valor de enum) -- nunca overbooking, nunca dinheiro do cliente perdido/ignorado. Testado com cenário de 1 vaga disputada por 2 pagamentos.

**PAYMENT_CONFIRMED vs PAYMENT_RECEIVED**: CONFIRMED é só sinal operacional (persiste `provider_payment_id`, nunca cria `operator_blocked`, nenhum estado novo inventado). RECEIVED é o único gatilho financeiro real.

**Liquidação atômica**: `settle_marketplace_payment_received` garante numa única transação: elegibilidade, amount correto, reserva confirmável, capacidade, e delega o efeito financeiro pra `record_marketplace_payment_confirmed` (0053/0055/0057) -- nunca duplicado. Nunca payment paid com ledger faltando, nunca ledger criado sem reserva confirmada.

**Verificação de amount**: diferença nunca confirma nem credita -- `payment.status` fica `pending`, `manual_review` registra a divergência, sem PII no evento de segurança.

**Replay idempotente**: reconfirmado em todas as frentes -- segunda liquidação do mesmo pagamento não reconfirma reserva nem recria ledger.

**Eventos de refund (PAYMENT_REFUND_IN_PROGRESS/REFUNDED/PARTIALLY_REFUNDED)**: integrados só até o contrato interno seguro -- nenhum provider refund real ativado, webhook nunca ignora silenciosamente (dedupe + log `marketplace_payment_refund_event_received`).

**Webhook -- três fluxos independentes**: SaaS (intocado), transfer/saque (intocado, ADR 0005), e agora marketplace payment. Distinção NUNCA pelo nome do evento (idêntico entre SaaS e marketplace) -- sempre por `externalReference` corresponder a uma linha real em `payments`, verificado explicitamente antes de decidir o caminho. Idempotência por EVENTO (`body.id`, mesmo achado já aplicado ao webhook de transfer) -- CONFIRMED depois RECEIVED processam os dois, mesmo evento reenviado é deduplicado.

**MARKETPLACE_PAYMENTS_MODE**: mock/sandbox/production, ausente=fail closed. Cross-validação contra `ASAAS_API_URL` -- mode=production com URL de sandbox (ou vice-versa) é recusado. Nenhum teste real em sandbox nesta sessão (sem credencial, sem pedir chave pelo chat) -- só mock, testado.

**Segurança**: nenhum log carrega CPF/e-mail/telefone/payload Pix/encodedImage/payload bruto do provider/chave Asaas -- testado estruturalmente.

**Testes**: 47 cenários (ledger com valor real -- R$100/500/1000 → 10/90, 50/450, 100/900 -- settlement atômico payment+reservation juntos, replay não duplica, CONFIRMED isolado nunca credita, CONFIRMED depois RECEIVED credita normalmente, amount divergence cai pra manual_review sem confirmar, pagamento tardio com capacidade confirma, pagamento tardio sem capacidade nunca overbooka e nunca perde o dinheiro do cliente, payment desconhecido rejeitado, payload oficial/mapeamento/QR Code verificados estruturalmente, deduplicação de customer/cobrança, MARKETPLACE_PAYMENTS_MODE fail-closed e cross-validado, CPF obrigatório antes do insert, dispatch do webhook correto, SaaS e transfer preservados, refund events logados, nenhuma PII em log). **47/47 passaram.** `npx tsc --noEmit`, `npx eslint .` (0 erros, 4 warnings pré-existentes) e `npx next build` -- todos limpos.

**Migration `0059`**: nova, não sobrescreve `0052`-`0058` (nenhuma aplicada ainda). Não aplicada nesta etapa. Nenhuma cobrança real, nenhum Asaas de produção usado.
