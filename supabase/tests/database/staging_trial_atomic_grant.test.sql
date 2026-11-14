-- grant_staging_trial (0092): contrato transacional e ACL.
-- Dados fictícios; uma transação revertida; execute só em Postgres local descartável.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
     from pg_proc
    where oid = 'public.grant_staging_trial(uuid,uuid,text)'::regprocedure),
  'RPC existe como SECURITY DEFINER com search_path vazio e fixo');
select ok(
  has_function_privilege('service_role', 'public.grant_staging_trial(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.grant_staging_trial(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.grant_staging_trial(uuid,uuid,text)', 'EXECUTE'),
  'somente service_role pode executar a RPC');

insert into public.companies (id, name, asaas_customer_id) values
  ('9a000000-0000-4000-8000-0000000000a1', 'Trial A fictícia', null),
  ('9a000000-0000-4000-8000-0000000000a2', 'Trial B fictícia', 'cus_test_linked'),
  ('9a000000-0000-4000-8000-0000000000a3', 'Trial C fictícia', null),
  ('9a000000-0000-4000-8000-0000000000a4', 'Trial D fictícia', null),
  ('9a000000-0000-4000-8000-0000000000a5', 'Trial E fictícia', null),
  ('9a000000-0000-4000-8000-0000000000a6', 'Trial F fictícia', null),
  ('9a000000-0000-4000-8000-0000000000a7', 'Trial G fictícia', null),
  ('9a000000-0000-4000-8000-0000000000a8', 'Trial H fictícia', null);
insert into auth.users (id, email, aud, role) values
  ('9b000000-0000-4000-8000-0000000000a1', 'trial-super@local.test', 'authenticated', 'authenticated'),
  ('9b000000-0000-4000-8000-0000000000a2', 'trial-company-admin@local.test', 'authenticated', 'authenticated');
insert into public.profiles (id, company_id, role, name, email) values
  ('9b000000-0000-4000-8000-0000000000a1', '9a000000-0000-4000-8000-0000000000a1', 'super_admin', 'Admin fictício', 'trial-super@local.test'),
  ('9b000000-0000-4000-8000-0000000000a2', '9a000000-0000-4000-8000-0000000000a1', 'company_admin', 'Operador fictício', 'trial-company-admin@local.test')
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role, name = excluded.name;

insert into public.subscriptions (id, company_id, status, paid_until, asaas_subscription_id, created_at) values
  ('9c000000-0000-4000-8000-0000000000a1', '9a000000-0000-4000-8000-0000000000a1', 'ativa', '2026-01-01T00:00:00Z', null, '2026-01-01T00:00:00Z'),
  ('9c000000-0000-4000-8000-0000000000a2', '9a000000-0000-4000-8000-0000000000a2', 'ativa', '2026-01-01T00:00:00Z', null, '2026-01-01T00:00:00Z'),
  ('9c000000-0000-4000-8000-0000000000a3', '9a000000-0000-4000-8000-0000000000a3', 'ativa', '2026-01-01T00:00:00Z', 'sub_test_linked', '2026-01-01T00:00:00Z'),
  ('9c000000-0000-4000-8000-0000000000a4', '9a000000-0000-4000-8000-0000000000a4', 'cancelada', '2026-01-01T00:00:00Z', null, '2026-01-01T00:00:00Z'),
  ('9c000000-0000-4000-8000-0000000000a5', '9a000000-0000-4000-8000-0000000000a5', 'ativa', transaction_timestamp() + interval '1 hour', null, '2026-01-01T00:00:00Z'),
  ('9c000000-0000-4000-8000-0000000000a6', '9a000000-0000-4000-8000-0000000000a6', 'ativa', null, null, '2026-01-01T00:00:00Z'),
  ('9c000000-0000-4000-8000-0000000000a8', '9a000000-0000-4000-8000-0000000000a8', 'ativa', '2026-01-01T00:00:00Z', null, '2026-01-01T00:00:00Z');

create function public.pgtap_fail_staging_trial_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action = 'conceder_trial_staging'
     and new.target_company_id = '9a000000-0000-4000-8000-0000000000a8'::uuid then
    raise exception 'TEST_AUDIT_INSERT_FAILURE';
  end if;
  return new;
end;
$$;
create trigger pgtap_fail_staging_trial_audit
  before insert on public.admin_audit_log
  for each row execute function public.pgtap_fail_staging_trial_audit();

set local role service_role;
set local request.jwt.claims to '{"role":"authenticated"}';
select throws_ok(
  $$select public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a1', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview')$$,
  '42501', 'FORBIDDEN', 'claim que não é service_role é recusada mesmo sob esse papel SQL');
set local request.jwt.claims to '{"role":"service_role"}';

select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a1', '9b000000-0000-4000-8000-0000000000a1', '  Validar reservas no Preview  ') ->> 'status',
  'granted', 'concede somente para assinatura ativa, vencida e sem vínculos Asaas');
select is((select status from public.subscriptions where id = '9c000000-0000-4000-8000-0000000000a1'),
  'ativa', 'a concessão mantém o status ativo');
select is((select paid_until - transaction_timestamp() from public.subscriptions where id = '9c000000-0000-4000-8000-0000000000a1'),
  interval '168 hours', 'a concessão estende exatamente 168 horas a partir da transação');
select is((select count(*)::int from public.admin_audit_log where action = 'conceder_trial_staging' and target_company_id = '9a000000-0000-4000-8000-0000000000a1'),
  1, 'a concessão grava exatamente uma auditoria');
select results_eq(
  $$select admin_id, admin_name, action, target_company_id from public.admin_audit_log where target_company_id = '9a000000-0000-4000-8000-0000000000a1'$$,
  $$values ('9b000000-0000-4000-8000-0000000000a1'::uuid, 'Admin fictício'::text, 'conceder_trial_staging'::text, '9a000000-0000-4000-8000-0000000000a1'::uuid)$$,
  'auditoria registra administrador, nome, ação e empresa corretos');
select ok(
  (select details->>'days' = '7' and details->>'reason' = 'Validar reservas no Preview' and details->>'provider' = 'none'
      from public.admin_audit_log where target_company_id = '9a000000-0000-4000-8000-0000000000a1'),
  'auditoria registra duração, motivo normalizado e ausência de provedor');
select is(
  (select (details->>'new_paid_until')::timestamptz from public.admin_audit_log where target_company_id = '9a000000-0000-4000-8000-0000000000a1'),
  (select paid_until from public.subscriptions where id = '9c000000-0000-4000-8000-0000000000a1'),
  'auditoria e assinatura registram o mesmo vencimento');
select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a1', '9b000000-0000-4000-8000-0000000000a1', 'Tentar de novo') ->> 'status',
  'subscription_not_eligible', 'repetição imediata não concede outro período');
select is((select count(*)::int from public.admin_audit_log where action = 'conceder_trial_staging' and target_company_id = '9a000000-0000-4000-8000-0000000000a1'),
  1, 'repetição recusada não cria auditoria adicional');

select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a2', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview') ->> 'status',
  'company_asaas_linked', 'empresa já vinculada ao customer Asaas é recusada');
select is((select paid_until from public.subscriptions where id = '9c000000-0000-4000-8000-0000000000a2'),
  '2026-01-01T00:00:00Z'::timestamptz, 'recusa por vínculo da empresa não altera vencimento');
select is((select count(*)::int from public.admin_audit_log where target_company_id = '9a000000-0000-4000-8000-0000000000a2'),
  0, 'recusa por vínculo da empresa não grava concessão na auditoria');
select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a3', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview') ->> 'status',
  'subscription_not_eligible', 'assinatura com vínculo Asaas é recusada');
select is((select paid_until from public.subscriptions where id = '9c000000-0000-4000-8000-0000000000a3'),
  '2026-01-01T00:00:00Z'::timestamptz, 'recusa por vínculo da assinatura não altera vencimento');
select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a4', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview') ->> 'status',
  'subscription_not_eligible', 'assinatura cancelada é recusada');
select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a5', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview') ->> 'status',
  'subscription_not_eligible', 'assinatura com vencimento futuro é recusada');
select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a6', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview') ->> 'status',
  'subscription_not_eligible', 'assinatura sem vencimento é recusada');
select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a7', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview') ->> 'status',
  'subscription_not_found', 'empresa sem assinatura é recusada');
select is(
  public.grant_staging_trial('9a000000-0000-4000-8000-0000000000ff', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview') ->> 'status',
  'company_not_found', 'empresa inexistente é recusada');
select throws_ok(
  $$select public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a1', '9b000000-0000-4000-8000-0000000000a1', '  ')$$,
  'P0001', 'INVALID_TRIAL_REASON', 'motivo fora do limite é recusado');
select throws_ok(
  $$select public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a1', '9b000000-0000-4000-8000-0000000000a2', 'Validar Preview')$$,
  'P0001', 'ADMIN_NOT_AUTHORIZED', 'perfil que não é super_admin não pode conceder');
select throws_ok(
  $$select public.grant_staging_trial('9a000000-0000-4000-8000-0000000000a8', '9b000000-0000-4000-8000-0000000000a1', 'Validar Preview')$$,
  'P0001', 'TEST_AUDIT_INSERT_FAILURE', 'falha na auditoria aborta a transação da concessão');
select is((select paid_until from public.subscriptions where id = '9c000000-0000-4000-8000-0000000000a8'),
  '2026-01-01T00:00:00Z'::timestamptz, 'falha na auditoria reverte integralmente a extensão do vencimento');
select is((select count(*)::int from public.admin_audit_log where target_company_id = '9a000000-0000-4000-8000-0000000000a8'),
  0, 'falha na auditoria não deixa registro parcial');

reset role;
select * from finish();
rollback;
