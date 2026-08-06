# NauticFlow — Documentação do Sistema

Documento de referência sobre o que o sistema é, como está construído e o que falta. Complementa o [README.md](README.md).

**Atenção**: estes arquivo não está no controle de versão (não é rastreado pelo git) e já se perdeu uma vez nesta sessão. Vale commitar ele no repositório pra não perder de novo.

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

Segurança: `profiles` só permite UPDATE nas colunas `name`/`email` (via GRANT em nível de coluna) — evita que um usuário troque o próprio `company_id`/`role` via API direta e acesse dados de outra empresa.

## 6. Pendências conhecidas (lista do que fazer depois)

- **Modo escuro (dark mode)**: o app hoje só tem tema claro. Adicionar um alternador claro/escuro é uma tarefa pendente — construir quando o usuário pedir.
- **Testar o webhook do Asaas com domínio real** (ou via ngrok) — hoje só validado localmente com uma chamada simulada.
- **Upgrade do Supabase pro plano Pro** — evita pausa automática do projeto por inatividade e ativa backup. Ainda não feito (decisão do dono do produto, envolve custo).
- Itens já resolvidos: índices de performance, sanitização de HTML no e-mail de voucher, monitoramento de erros via Sentry, **convidar colaborador / equipe** (tela `/equipe`, construída — ver seção 8).

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
