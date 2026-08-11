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

- **Timezone: parsing ingênuo de data/hora de saída** — `saidas/actions.ts` monta `departs_at` com `new Date(`${date}T${time}`).toISOString()`, que interpreta a string usando o fuso horário do processo Node, não necessariamente `America/Sao_Paulo`. Hoje isso funciona porque o `next dev` roda na máquina do desenvolvedor (fuso de Brasília). **Se o app for hospedado num serviço que roda em UTC por padrão (Vercel, por exemplo), toda essa lógica de horário — inclusive a trava de 08:00–19:00 e o "não pode ser no passado" — vai calcular errado por 3 horas.** Precisa ser corrigido (fixar o offset `-03:00` na escrita, e/ou passar `timeZone: "America/Sao_Paulo"` explícito nas formatações de leitura) antes de publicar em produção num host fora do Brasil/fora desse fuso.
- **Testar o webhook do Asaas com domínio real** (ou via ngrok) — hoje só validado localmente com uma chamada simulada.
- **Upgrade do Supabase pro plano Pro** — evita pausa automática do projeto por inatividade e ativa backup. Ainda não feito (decisão do dono do produto, envolve custo).
- Itens já resolvidos: índices de performance, sanitização de HTML no e-mail de voucher, monitoramento de erros via Sentry, **convidar colaborador / equipe** (tela `/equipe`, construída — ver seção 8), **dashboard e agenda reformulados** (ver seção 10), **migration `0014_horario_saida_no_banco.sql` aplicada no Supabase** (trava de horário de saída também no banco), **modo escuro** (ver seção 11), **gráficos no financeiro e botão de renovar condicional em `/planos`** (ver seção 11).

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

- Migrations em `supabase/migrations/` **não rodam sozinhas** — cada uma precisa ser colada manualmente no SQL Editor do Supabase, na ordem numérica.
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
