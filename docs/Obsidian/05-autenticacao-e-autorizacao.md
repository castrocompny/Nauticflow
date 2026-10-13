---
tags:
  - nauticflow
  - auth
updated: 2026-09-19
---
← [[00-INDEX]] · relacionado: [[06-seguranca]] · [[04-banco-e-supabase]] · [[02-arquitetura]]

# Autenticação e autorização

## Cadastro e bootstrap de empresa

Cadastro pede: nome, empresa, cidade, CNPJ/CPF (**obrigatório desde a seção 63** — era opcional antes, virou obrigatório pra suportar o anti-abuso do trial), e-mail, senha (política forte, ver abaixo), aceite de Termos/Privacidade.

Empresa + perfil + assinatura são criados por um **gatilho no banco** (`handle_new_user()`, disparado por `on_auth_user_created` em `auth.users`, migration `0002`) — não depende de nenhuma chamada autenticada subsequente do navegador. Decisão de arquitetura explícita (README): resolve um problema real onde o cadastro criava o usuário mas falhava ao montar a empresa porque a sessão ainda não existia no momento da chamada RPC.

⚠️ **Esse gatilho já sumiu sozinho uma vez em produção** (causa desconhecida, possivelmente manutenção interna do Supabase no schema `auth`). Se cadastros novos ficarem sem empresa: `select tgname from pg_trigger where tgname = 'on_auth_user_created'` — se não existir, recriar (`supabase/migrations/0010_recria_gatilho_cadastro.sql`).

## Papéis (roles)

- **`staff`** (colaborador): acesso só ao operacional — Dashboard, Reservas, Agenda, Saídas, Clientes, Embarcações, Parceiros. **Desde a seção 58**, não vê nem consegue acessar (bloqueio também no servidor, não só escondido no menu) `/configuracoes`, `/equipe`, `/planos`, `/financeiro`, `/relatorios` — redireciona pra `/dashboard`. Não remove a si mesmo nem outro admin.
- **`company_admin`**: tudo do staff + gestão (Financeiro, Relatórios, Equipe, Configurações, Planos/cobrança). Único que pode convidar/remover colaborador, cancelar assinatura, excluir a empresa inteira.
- **`super_admin`**: role especial (hoje só a conta do dono do produto, `castrocompny@gmail.com`, compartilhada com o sócio via mesmo login) com acesso ao painel `/admin` e visibilidade cross-empresa. Protegido por **2FA/TOTP obrigatório** (ver abaixo).

Autorização reforçada em múltiplas camadas, não só checagem de `role` na UI:
- RLS por `company_id` em toda tabela sensível.
- `profiles` só permite `UPDATE` nas colunas `name`/`email` via **GRANT em nível de coluna** — impede um usuário trocar o próprio `company_id`/`role` via API direta do Supabase (fechado desde a migration `0003`; reaberto uma vez por um caminho diferente e corrigido de novo, ver [[06-seguranca]] §26).
- `current_company_id()`/`is_super_admin()` são `security definer` com `search_path` fixo (evita hijacking de schema).
- Toda Server Action sensível revalida a permissão no servidor, mesmo quando a UI já esconde o botão (ex: RLS de `companies` permitia qualquer membro editar dados da empresa — fechado na seção 58 adicionando checagem de cargo na própria action `updateSettings`).

## Recuperação de senha

Fluxo completo: `/login` → "Esqueci minha senha" → e-mail → `/auth/callback` → `/redefinir-senha`. Exige que as Redirect URLs no Supabase (Authentication → URL Configuration) incluam a URL real do app. Histórico de bugs reais corrigidos (seção 25, sessão 2026-08-15) — relevante se o fluxo voltar a quebrar:
1. Redirect URLs do Supabase sem o domínio de produção (o erro era engolido de propósito, pra não revelar quais e-mails existem — tela sempre dizia "e-mail enviado" mesmo falhando).
2. Remetente SMTP customizado apontando pra domínio não verificado no Resend.
3. Template de e-mail em inglês sem logo (cosmético).
4. **Bug de código real**: `/auth/callback` só tratava o fluxo PKCE (`?code=`), mas o link de recovery do Supabase manda fluxo OTP (`?token_hash=&type=recovery`) — corrigido tratando os dois. `src/lib/supabase/middleware.ts` não tinha `/redefinir-senha` na lista de rotas públicas — corrigido.

## Senha forte

`src/lib/password.ts` (`validatePassword`): mínimo 8 caracteres, exige letra + número, bloqueia lista de senhas óbvias comuns no Brasil, rejeita caractere repetido. Aplicada em `signUp` e `updatePassword` (substituiu o mínimo de 6 do Supabase Auth nativo). Não aplicada no login (não trava quem já tem conta com senha mais curta de antes).

## Convite de equipe — histórico de 3 bugs reais em produção (seções 55-57)

Vale entender esse histórico porque a causa raiz de cada um é sutil e pode se repetir num cenário parecido:

1. **§55 — conta órfã por reaproveitamento**: se o e-mail convidado já tinha uma conta pendente (criada via "Criar conta" antes, nunca confirmada), `admin.inviteUserByEmail()` reaproveita a conta existente via `UPDATE`, não `INSERT` — o gatilho de vínculo à empresa só rodava em `AFTER INSERT`, nunca disparava. Corrigido bloqueando o convite na origem se já existir `profiles` com aquele e-mail (checagem via client admin, porque a RLS normal de `profiles` não deixaria ver e-mail de outra empresa).
2. **§56 — causa raiz real, mais funda**: mesmo em convites "limpos" (e-mail nunca usado), o convite sempre caía no caminho de cadastro normal. `new.invited_at` chega `null` no gatilho `AFTER INSERT on auth.users` — o Supabase grava a linha primeiro e só preenche `invited_at` numa `UPDATE` separada ~34ms depois. A condição de segurança da migration `0018` (`if new.invited_at is not null`) nunca era verdadeira. Corrigido com um **segundo gatilho**, `on_auth_user_invited`, em `AFTER UPDATE OF invited_at`, `WHEN (old.invited_at is null and new.invited_at is not null)` — dispara exatamente quando o Supabase confirma que é convite de verdade (`invited_at` só é preenchido pela API admin, que exige `service_role` — segue impossível de forjar via `signUp()` público). Migration `0025`.
3. **§57 — link do e-mail padrão do Supabase não funcionava**: `{{ .ConfirmationURL }}` do template nativo aponta pro endpoint do próprio Supabase, que redireciona com a sessão **no fragmento da URL** (`#access_token=`) — fragmento nunca chega ao servidor, então `/auth/callback` (server-side) nunca recebia a sessão. Customizar o template no painel não resolveu de forma confiável (edição não "pegava" nos envios reais, causa não identificada). **Solução definitiva**: parar de usar o e-mail nativo do Supabase — `generateLink({ type: "invite" })` só cria o token sem mandar e-mail, o link é montado na mão (`/auth/callback?token_hash=&type=invite&next=/redefinir-senha`) e enviado via Edge Function própria (`send-email`, Resend), autenticada por `MAILER_SECRET`. Ver `src/lib/team-invite-email.ts`.

Botão "Reenviar convite" (§53) existe porque o link de uso único pode ser consumido antes da pessoa clicar de verdade (scanners de e-mail corporativo tipo Outlook Safe Links, ou expiração de 1h).

## 2FA / TOTP obrigatório pro Super Admin (§33)

MFA nativo do Supabase Auth (TOTP), sem infraestrutura própria de segredo/QR code:
- `src/lib/admin-auth.ts`: `requireSuperAdminPage()` e `requireSuperAdminAction()` checam, em ordem: sessão existe → `profiles.role === "super_admin"` → `supabase.auth.mfa.getAuthenticatorAssuranceLevel().currentLevel === "aal2"`.
- Sem sessão → `/login`; não é super admin → tela de acesso restrito (não revela que a área existe); é super admin sem 2FA cadastrado → `/admin/mfa-setup`; cadastrado mas não verificado nesta sessão → `/admin/mfa-challenge`.
- AAL preso à **sessão** — cada login pede o código de novo, mesmo com o fator já cadastrado no dispositivo.
- Server Actions de admin também exigem `aal2`, não só a página (uma Action pode ser chamada direto sem passar pela renderização).
- Sem tela de "recuperar 2FA" — perda de acesso exige apagar o fator TOTP direto no Supabase (Authentication → Users → MFA) e cadastrar de novo.

## Exclusão de conta/empresa

`staff` apaga só a própria conta (confirmação: digitar "EXCLUIR"). `company_admin` apaga a **empresa inteira** (confirmação: nome exato da empresa **+ senha da conta**, reautenticada via `signInWithPassword` — adicionado depois que se percebeu que o nome da empresa é visível pra qualquer um com acesso à tela já logada, então sozinho não protegia contra uso indevido por terceiros). Usa client `service_role`: apaga cada usuário via `auth.admin.deleteUser` (admin por último), depois a linha de `companies` — cascade cuida do resto, exceto `profiles.company_id` (`on delete set null`, não cascade — por isso os perfis são removidos antes, via API admin). Sem período de carência, exclusão imediata.

`super_admin` tem um caminho equivalente em `/admin/[id]` (`deleteCompanyPermanently`), com a mesma trava de digitar o nome exato — bug real encontrado (§54): comparação não usava `.trim()` dos dois lados, então nome com espaço sobrando no banco (invisível na tela) travava o botão pra sempre. Corrigido nos 3 lugares que faziam essa comparação.
