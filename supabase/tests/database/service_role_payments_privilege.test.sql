-- Privilégios que o webhook Asaas (src/app/api/webhooks/asaas/route.ts) exige
-- do papel service_role. Nenhuma migration do repositório os concede NESTAS
-- quatro tabelas (a 0053 concede SELECT só no ledger): vêm dos default
-- privileges da plataforma Supabase. A imagem local recente concede ao
-- service_role só `Dxtm` (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN -- sem SELECT,
-- INSERT, UPDATE nem DELETE) em tabelas criadas por `postgres`, então rodar a
-- chain num banco novo exige o bootstrap de teste
-- supabase/tests/setup/service_role_platform_grants.sql (ver o arquivo e
-- supabase/tests/README.md).
--
-- Dois tipos de asserção: has_*_privilege = só ACL; lives_ok/is sob
-- `set local role service_role` = execução real do caminho.
--   payments, marketplace_withdrawals: SELECT direto da rota (lookups)
--   processed_webhook_events: INSERT direto da rota; SELECT/INSERT/DELETE pela
--     RPC 0079 (security invoker: insert ... returning id, delete da marca)
--   subscriptions: SELECT ... FOR UPDATE e UPDATE pela RPC 0079
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

select ok(has_schema_privilege('service_role', 'public', 'USAGE'), 'service_role tem USAGE no schema public');
select ok((select rolbypassrls from pg_roles where rolname = 'service_role'), 'service_role tem BYPASSRLS (RLS sem policy não o bloqueia)');

select ok(has_table_privilege('service_role', 'public.payments', 'SELECT'), 'service_role tem SELECT em payments (lookups da rota)');
select ok(has_table_privilege('service_role', 'public.marketplace_withdrawals', 'SELECT'), 'service_role tem SELECT em marketplace_withdrawals (lookups da rota)');
select ok(has_table_privilege('service_role', 'public.processed_webhook_events', 'SELECT'), 'service_role tem SELECT em processed_webhook_events (returning/delete da 0079)');
select ok(has_table_privilege('service_role', 'public.processed_webhook_events', 'INSERT'), 'service_role tem INSERT em processed_webhook_events (rota e 0079)');
select ok(has_table_privilege('service_role', 'public.processed_webhook_events', 'DELETE'), 'service_role tem DELETE em processed_webhook_events (0079 desfaz a marca)');
select ok(has_table_privilege('service_role', 'public.subscriptions', 'SELECT'), 'service_role tem SELECT em subscriptions (0079)');
select ok(has_table_privilege('service_role', 'public.subscriptions', 'UPDATE'), 'service_role tem UPDATE em subscriptions (0079: for update + update)');

select ok(not has_table_privilege('anon', 'public.payments', 'SELECT'), 'anon continua sem SELECT em payments');
select ok(not has_table_privilege('authenticated', 'public.payments', 'SELECT'), 'authenticated continua sem SELECT em payments');
select ok(not has_table_privilege('anon', 'public.processed_webhook_events', 'SELECT'), 'anon continua sem SELECT em processed_webhook_events');
select ok(not has_table_privilege('authenticated', 'public.processed_webhook_events', 'SELECT'), 'authenticated continua sem SELECT em processed_webhook_events');

-- execução real sob o papel (não só ACL): lookups da rota e a RPC 0079
insert into public.companies (id, name) values ('f4000000-0000-4000-8000-000000000001', 'pgTAP Grants');
insert into public.subscriptions (id, company_id, status) values ('f4000000-0000-4000-8000-0000000000c1', 'f4000000-0000-4000-8000-000000000001', 'ativa');
set local role service_role;
select lives_ok($$ select id from public.payments where provider_payment_id = 'pay_none' limit 1 $$, 'service_role executa o lookup de payments da rota');
select lives_ok($$ select id from public.marketplace_withdrawals where provider_transfer_id = 'tr_none' limit 1 $$, 'service_role executa o lookup de marketplace_withdrawals da rota');
select is((select public.renew_subscription_from_asaas_payment('f4000000-0000-4000-8000-000000000001', 'pay_grants_1', 'PAYMENT_RECEIVED')),
  'renewed', 'service_role executa a RPC 0079 (security invoker) de ponta a ponta');
-- empresa sem assinatura: a 0079 grava a marca e a DELETA na mesma transação
-- (caminho que exige DELETE em processed_webhook_events).
select is((select public.renew_subscription_from_asaas_payment('f4000000-0000-4000-8000-0000000000ff', 'pay_grants_nosub', 'PAYMENT_RECEIVED')),
  'no_subscription', 'service_role executa o caminho no_subscription da RPC 0079');
reset role;
select is((select count(*)::int from public.processed_webhook_events where provider = 'asaas' and event_key = 'pay_grants_nosub'),
  0, 'marca de no_subscription foi removida sob service_role');

select * from finish();
rollback;
