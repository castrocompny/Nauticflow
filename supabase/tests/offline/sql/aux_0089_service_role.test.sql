-- Laboratório offline (run-sequential.sh): executa a RPC 0089 sob service_role
-- de fato, não só has_function_privilege. O CHAMADOR é service_role; o corpo
-- roda como o owner (SECURITY DEFINER). Fixtures fictícias preparadas como
-- owner (postgres); tudo revertido no fim, inclusive ledger e marcas.
-- Origem: auxiliar v2 de 2026-10-28 (v1 falhou por collation de current_user
-- -- `name` -- contra text em results_eq; corrigido com collate "default").
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

-- fixtures como owner
insert into public.companies (id, name) values ('f5000000-0000-4000-8000-000000000001', 'pgTAP SR 0089 (ficticia)');
insert into public.marketplace_withdrawals (id, company_id, amount_cents, status) values
  ('f5000000-0000-4000-8000-0000000000b1', 'f5000000-0000-4000-8000-000000000001', 10000, 'pending');
select is((select status from public.mark_marketplace_withdrawal_processing('f5000000-0000-4000-8000-0000000000b1', 'tr_sr_b1')),
  'processing', '[owner] fixture: saque b1 em processing com tr_sr_b1');
select is(current_user::text, 'postgres', '[owner] papel efetivo no preparo das fixtures');

-- caminhos da RPC sob service_role
set local role service_role;
select is(current_user::text, 'service_role', '[service_role] current_user antes da chamada');
select throws_ok($$ insert into public.marketplace_ledger_entries (company_id) values ('f5000000-0000-4000-8000-000000000001') $$,
  '42501', NULL, '[service_role] controle negativo: sem INSERT direto no ledger (papel restringe)');

-- 1) evento aplicado; current_user medido no mesmo statement da chamada
select results_eq($$ select current_user::text collate "default", outcome, withdrawal_status from public.process_marketplace_transfer_webhook_event('evt_sr_done_b1', 'TRANSFER_DONE', 'f5000000-0000-4000-8000-0000000000b1', 'tr_sr_b1', 150) $$,
  $$ values ('service_role'::text, 'applied'::text, 'completed'::text) $$, '[service_role] TRANSFER_DONE aplicado');

-- 2) replay sem duplicação
select results_eq($$ select current_user::text collate "default", outcome, withdrawal_status from public.process_marketplace_transfer_webhook_event('evt_sr_done_b1', 'TRANSFER_DONE', 'f5000000-0000-4000-8000-0000000000b1', 'tr_sr_b1', 150) $$,
  $$ values ('service_role'::text, 'already_applied'::text, 'completed'::text) $$, '[service_role] replay do mesmo evento é already_applied');

-- 3) conflito de identidade e de desfecho: erro, marca desfeita
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_sr_mismatch', 'TRANSFER_DONE', 'f5000000-0000-4000-8000-0000000000b1', 'tr_sr_other', null) $$,
  'PROVIDER_TRANSFER_ID_MISMATCH', '[service_role] transfer id divergente é recusado');
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_sr_failed_b1', 'TRANSFER_FAILED', 'f5000000-0000-4000-8000-0000000000b1', 'tr_sr_b1', null) $$,
  'TERMINAL_OUTCOME_CONFLICT', '[service_role] FAILED depois de DONE é recusado');
select is(current_user::text, 'service_role', '[service_role] papel inalterado após as chamadas');

-- verificações em tabelas restritas: como owner, após RESET ROLE
reset role;
select is(current_user::text, 'postgres', '[owner] RESET ROLE: verificações abaixo não são sob service_role');
select is((select count(*)::int from public.marketplace_ledger_entries where reference_id = 'f5000000-0000-4000-8000-0000000000b1' and entry_type = 'withdrawal_completed'),
  2, '[owner] DONE lançou exatamente o par withdrawal_completed');
select is((select count(*)::int from public.marketplace_ledger_entries where reference_id = 'f5000000-0000-4000-8000-0000000000b1'),
  2, '[owner] replay e conflitos não lançaram nada além do par');
select is((select status from public.marketplace_withdrawals where id = 'f5000000-0000-4000-8000-0000000000b1'),
  'completed', '[owner] saque continua completed');
select is((select net_transfer_cents from public.marketplace_withdrawals where id = 'f5000000-0000-4000-8000-0000000000b1'),
  9850, '[owner] net_transfer_cents desconta a taxa uma vez');
select is((select count(*)::int from public.processed_webhook_events where provider = 'asaas' and event_key = 'evt_sr_done_b1'),
  1, '[owner] uma única marca para o evento aplicado + replay');
select is((select count(*)::int from public.processed_webhook_events where event_key = 'evt_sr_mismatch'),
  0, '[owner] conflito de identidade não deixou marca');
select is((select count(*)::int from public.processed_webhook_events where event_key = 'evt_sr_failed_b1'),
  0, '[owner] conflito de desfecho não deixou marca');

select * from finish();
rollback;
