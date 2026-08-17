-- Melhorias no painel /admin: suspensão manual de empresa, log de auditoria das
-- ações do super admin, e visibilidade cross-empresa (vessels/profiles) pro
-- super admin conseguir mostrar uso vs. limite do plano de qualquer empresa.
--
-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query).

-- ============================================================================
-- 1) SUSPENSÃO MANUAL: independente do vencimento da assinatura, o super admin
--    pode bloquear uma empresa na hora (ex: fraude, abuso, pedido do cliente).
--    Reaproveita o mesmo mecanismo de bloqueio que já existe pra "assinatura
--    vencida" (só bloqueia criação de registro novo, não visualização/edição).
-- ============================================================================

alter table public.companies add column if not exists suspended_at timestamptz;
alter table public.companies add column if not exists suspended_reason text;

-- super admin precisa poder ATUALIZAR qualquer empresa (suspender, editar CNPJ/
-- dados de cobrança) -- antes só existia a policy de SELECT (migration 0007).
create policy "super admin - atualiza empresas" on public.companies
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ============================================================================
-- 2) VISIBILIDADE CROSS-EMPRESA pro super admin: sem isso, o painel não
--    consegue mostrar quantas embarcações/usuários uma empresa está usando
--    (RLS de vessels/profiles só libera a própria empresa).
-- ============================================================================

create policy "super admin - ve todas as embarcacoes" on public.vessels
  for select to authenticated using (public.is_super_admin());

create policy "super admin - ve todos os perfis" on public.profiles
  for select to authenticated using (public.is_super_admin());

-- ============================================================================
-- 3) LOG DE AUDITORIA: toda ação administrativa sensível (renovar, trocar
--    plano, suspender, editar dados de cobrança) fica registrada -- quem fez,
--    quando, em qual empresa. Isso não existia antes: o super admin podia
--    renovar uma assinatura sem deixar rastro de quem fez ou por quê.
-- ============================================================================

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id) on delete set null,
  admin_name text,
  action text not null,
  target_company_id uuid references public.companies (id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

create policy "super admin - ve logs" on public.admin_audit_log
  for select to authenticated using (public.is_super_admin());

-- so pode inserir um log em nome de si mesmo, e so se for super admin -- evita
-- que alguem forje um log atribuido a outro administrador
create policy "super admin - insere logs" on public.admin_audit_log
  for insert to authenticated with check (public.is_super_admin() and admin_id = auth.uid());
