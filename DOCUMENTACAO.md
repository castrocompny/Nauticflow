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

- 🔴 **URGENTE — Timezone: parsing ingênuo de data/hora de saída, agora ativo em produção DE VERDADE** — `saidas/actions.ts` monta `departs_at` com `new Date(`${date}T${time}`).toISOString()`, que interpreta a string usando o fuso horário do processo Node, não necessariamente `America/Sao_Paulo`. Isso funcionava certo em dev porque `next dev` roda na máquina do desenvolvedor (fuso de Brasília) — **e agora o app está publicado de verdade em `nauticflow.com.br`, rodando em UTC (Vercel)** — isso deixou de ser risco hipotético. Toda a lógica de horário de saída — a trava de 08:00–19:00 e o "não pode ser no passado" (migration `0014`, ver seção 10) — está calculando errado por 3 horas neste exato momento em produção. Precisa ser corrigido (fixar o offset `-03:00` na escrita, e/ou passar `timeZone: "America/Sao_Paulo"` explícito nas formatações de leitura).
- **Testar o webhook do Asaas com domínio real** — apontar a URL do webhook no painel do Asaas pra `https://nauticflow.com.br/api/webhooks/asaas` (ver seção 20) e testar de verdade.
- **Redirect URLs no Supabase** pra `https://nauticflow.com.br/**` — ainda não feito (as seções 19/20 mencionaram isso pra URL da Vercel, mas o domínio final mudou depois).
- **Confirmar o Resend "Verified"** e testar envio de e-mail de verdade pelo domínio novo (ver seção 20 — status "Pending" no fim da sessão de 14/15 de agosto).
- **Upgrade do Supabase pro plano Pro** — evita pausa automática do projeto por inatividade e ativa backup. Ainda não feito (decisão do dono do produto, envolve custo).
- **`headers().get("origin")` usado pra montar link de e-mail** (reset de senha em `login/actions.ts`, convite em `equipe/actions.ts`) — hoje protegido pela validação nativa de Origin/Host das Server Actions do Next.js, mas é uma dependência frágil de comportamento de framework pra algo sensível (link de reset de senha). Recomendado trocar por uma `NEXT_PUBLIC_SITE_URL` fixa agora que já existe um domínio de produção definitivo (`nauticflow.com.br`, seção 20).
- **Projeto Vercel órfão** (`nautic-flow/nauticflow`, ver seção 20) — não é mais o que serve o domínio, decidir se apaga pra não confundir.
- **2 advisories HIGH residuais no `npm audit`** (SSRF em rewrites com host controlado por env var interna, DoS em Server Components) só têm correção disponível na branch major do Next (15/16) — não fazem sentido pra esse app hoje (sem custom server, sem i18n, sem `images.remotePatterns`, sem WebSocket), mas vale reavaliar numa futura migração de major version do Next.js.
- **Linhas de tabela client-side demais** (`saidas/departure-row.tsx`, `reservas/reservation-row.tsx`, `parceiros/partner-row.tsx`, `embarcacoes/vessel-row.tsx`, `clientes/client-row.tsx`): cada linha é seu próprio Client Component com o formulário de edição inteiro embutido (mesmo escondido), instanciado uma vez por linha — até 25-50 por página. Contribui pro tempo de hidratação logo após abrir uma lista (o "atraso" pode aparecer como clique sem resposta nos primeiros instantes da página). Não mexido ainda porque exige reestruturar a UI (separar linha estática de um "island" de edição sob demanda) e eu não tenho como testar visualmente sem login no app.
- **2FA pro super_admin** — sugerido na auditoria de segurança (seção 13), reconfirmado na melhoria do `/admin` (seção 15). Ainda não implementado, de propósito (feature grande demais pra fazer sem testar ao vivo).
- **Emissão de nota fiscal ainda é manual** (seção 16) — não há certificado digital nem provedor de NFS-e configurado. O registro em `/admin/[id]` é só controle, não gera nota nenhuma de verdade.
- Itens já resolvidos: índices de performance, sanitização de HTML no e-mail de voucher, monitoramento de erros via Sentry, **convidar colaborador / equipe** (tela `/equipe`, construída — ver seção 8), **dashboard e agenda reformulados** (ver seção 10), **migration `0014_horario_saida_no_banco.sql` aplicada no Supabase** (trava de horário de saída também no banco), **modo escuro** (ver seção 11), **gráficos no financeiro e botão de renovar condicional em `/planos`** (ver seção 11), **deduplicação de `auth.getUser()` e queries repetidas** (ver seção 12), **auditoria de segurança — IDOR entre empresas e dependências vulneráveis** (ver seção 13), **migration `0015` aplicada** (trava de IDOR também no banco), **Supabase CLI instalado no projeto** (ver seção 14), **painel /admin melhorado** (ver seção 15, migration `0016` aplicada), **controle manual de notas fiscais** (ver seção 16, migration `0017` aplicada), **gráficos/funil/onboarding travado/filtro por plano no /admin** (ver seção 17), **deploy em produção com domínio próprio no ar** (`nauticflow.com.br`, ver seções 19 e 20), **2 commits de segurança/admin/performance que estavam sem push finalmente publicados** (ver seção 20).

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

- **`headers().get("origin")` usado pra montar link de e-mail de reset de senha/convite** — verifiquei e não é explorável hoje (Server Actions do Next.js validam Origin contra Host antes do código rodar), mas é uma dependência frágil de comportamento de framework pra algo sensível. Não troquei por uma URL fixa porque isso precisa de uma `NEXT_PUBLIC_SITE_URL` configurada em produção, e não quis arriscar quebrar o fluxo de e-mail sem confirmar o domínio final com o dono do produto.
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
- [ ] Decidir se apaga o projeto Vercel órfão (`nautic-flow/nauticflow`) pra não confundir no futuro
- [ ] Conectar Git no meu projeto original não é mais necessário — o `Passatempo/fluxo náutico` já tem Git; ele é o que deve continuar sendo usado

### Validação final desta sessão

`tsc --noEmit`, `next lint`, `next build` — todos limpos, sem erros novos. `npm audit` sem novidade (mesmos 2 advisories residuais já conhecidos, ver seção 6). Testado ao vivo em `nauticflow.com.br`: todas as rotas protegidas redirecionam certo, rotas públicas respondem 200, webhook recusa sem token, CSS carrega normal.
