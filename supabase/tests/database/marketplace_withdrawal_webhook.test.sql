-- Migration 0089 -- TRANSFER_* decidido pelo estado travado do saque, e RPCs de
-- saque corrigidas. Executado só em banco local isolado (40/40); as funções
-- rodam no papel da sessão de teste, não sob service_role.
-- Corridas em duas sessões (DONE x FAILED; mesmo transfer id em dois saques)
-- não são exercitáveis num único arquivo pgTAP; aqui só os efeitos sequenciais.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

insert into public.companies (id, name) values ('f3000000-0000-4000-8000-000000000001', 'pgTAP Withdrawal');
insert into public.marketplace_withdrawals (id, company_id, amount_cents, status) values
  ('f3000000-0000-4000-8000-0000000000a1', 'f3000000-0000-4000-8000-000000000001', 10000, 'pending'),
  ('f3000000-0000-4000-8000-0000000000a2', 'f3000000-0000-4000-8000-000000000001', 5000, 'pending'),
  ('f3000000-0000-4000-8000-0000000000a3', 'f3000000-0000-4000-8000-000000000001', 7000, 'pending'),
  ('f3000000-0000-4000-8000-0000000000a4', 'f3000000-0000-4000-8000-000000000001', 3000, 'pending'),
  -- terminal sem transfer id (legado, ex.: 0053 failed nunca gravava o id)
  ('f3000000-0000-4000-8000-0000000000a5', 'f3000000-0000-4000-8000-000000000001', 2000, 'failed'),
  -- processing sem transfer id (legado; mark só vincula a partir de pending)
  ('f3000000-0000-4000-8000-0000000000a6', 'f3000000-0000-4000-8000-000000000001', 1000, 'processing');

-- privilégios
select ok(not has_function_privilege('anon', 'public.process_marketplace_transfer_webhook_event(text, text, uuid, text, int)', 'execute'), 'anon não executa o evento de transferência');
select ok(not has_function_privilege('authenticated', 'public.process_marketplace_transfer_webhook_event(text, text, uuid, text, int)', 'execute'), 'authenticated não executa o evento de transferência');
select ok(has_function_privilege('service_role', 'public.process_marketplace_transfer_webhook_event(text, text, uuid, text, int)', 'execute'), 'service_role executa o evento de transferência');
select ok(not has_function_privilege('authenticated', 'public.mark_marketplace_withdrawal_processing(uuid, text)', 'execute'), 'authenticated não executa mark_processing');
select ok(not has_function_privilege('authenticated', 'public.finalize_marketplace_withdrawal(uuid, text, text, int, text, text)', 'execute'), 'authenticated não executa finalize');
select ok(not has_function_privilege('service_role', 'public.lock_marketplace_transfer_identity(uuid, text)', 'execute'), 'helper de identidade não é chamável direto');
select ok(not has_function_privilege('service_role', 'public.complete_marketplace_withdrawal(uuid, boolean, text)', 'execute'), 'RPC 0053 superada não é mais executável por service_role');
select ok(not has_function_privilege('authenticated', 'public.complete_marketplace_withdrawal(uuid, boolean, text)', 'execute'), 'RPC 0053 superada não é executável por authenticated');

-- mark_processing: sem ambiguidade de colunas, vincula o transfer id
select is((select status from public.mark_marketplace_withdrawal_processing('f3000000-0000-4000-8000-0000000000a1', 'tr_a1')),
  'processing', 'mark_processing executa e move pending -> processing');
select is((select provider_transfer_id from public.marketplace_withdrawals where id = 'f3000000-0000-4000-8000-0000000000a1'),
  'tr_a1', 'mark_processing grava o provider_transfer_id');
select throws_ok($$ select * from public.mark_marketplace_withdrawal_processing('f3000000-0000-4000-8000-0000000000a1', 'tr_other') $$,
  'PROVIDER_TRANSFER_ID_MISMATCH', 'mark_processing recusa outro transfer id no mesmo saque');
select throws_ok($$ select * from public.mark_marketplace_withdrawal_processing('f3000000-0000-4000-8000-0000000000a4', 'tr_a1') $$,
  'PROVIDER_TRANSFER_ID_MISMATCH', 'mark_processing recusa transfer id já ligado a outro saque');
select is((select status from public.marketplace_withdrawals where id = 'f3000000-0000-4000-8000-0000000000a4'),
  'pending', 'saque recusado continua pending');

-- desfecho via evento
select results_eq($$ select outcome, withdrawal_status from public.process_marketplace_transfer_webhook_event('evt_done_a1', 'TRANSFER_DONE', 'f3000000-0000-4000-8000-0000000000a1', 'tr_a1', 150) $$,
  $$ values ('applied'::text, 'completed'::text) $$, 'TRANSFER_DONE aplica o desfecho');
select is((select count(*)::int from public.marketplace_ledger_entries where reference_id = 'f3000000-0000-4000-8000-0000000000a1' and entry_type = 'withdrawal_completed'),
  2, 'TRANSFER_DONE lança o par withdrawal_pending -> transferred');
select is((select net_transfer_cents from public.marketplace_withdrawals where id = 'f3000000-0000-4000-8000-0000000000a1'),
  9850, 'net_transfer_cents desconta a taxa do provider');

-- reentrega: decidida pelo estado
select results_eq($$ select outcome, withdrawal_status from public.process_marketplace_transfer_webhook_event('evt_done_a1', 'TRANSFER_DONE', 'f3000000-0000-4000-8000-0000000000a1', 'tr_a1', 150) $$,
  $$ values ('already_applied'::text, 'completed'::text) $$, 'reentrega do mesmo desfecho é already_applied');
select is((select count(*)::int from public.marketplace_ledger_entries where reference_id = 'f3000000-0000-4000-8000-0000000000a1'),
  2, 'reentrega não lança de novo');

-- desfecho terminal contraditório: recusado, nada muda, nenhuma marca
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_failed_a1', 'TRANSFER_FAILED', 'f3000000-0000-4000-8000-0000000000a1', 'tr_a1', null) $$,
  'TERMINAL_OUTCOME_CONFLICT', 'FAILED depois de DONE é recusado');
select is((select count(*)::int from public.processed_webhook_events where event_key = 'evt_failed_a1'),
  0, 'conflito terminal não deixa marca');
select is((select count(*)::int from public.marketplace_ledger_entries where reference_id = 'f3000000-0000-4000-8000-0000000000a1'),
  2, 'conflito terminal não lança no ledger');

-- marca legada gravada SEM efeito (código antigo): o reenvio ainda aplica
insert into public.processed_webhook_events (provider, event_type, event_key) values ('asaas', 'TRANSFER_FAILED', 'evt_legacy_a3');
select results_eq($$ select outcome, withdrawal_status from public.process_marketplace_transfer_webhook_event('evt_legacy_a3', 'TRANSFER_FAILED', 'f3000000-0000-4000-8000-0000000000a3', 'tr_a3', null) $$,
  $$ values ('applied'::text, 'failed'::text) $$, 'marca legada não impede aplicar o efeito');
select is((select sum(amount_cents)::int from public.marketplace_ledger_entries where reference_id = 'f3000000-0000-4000-8000-0000000000a3' and entry_type = 'withdrawal_failed' and bucket = 'available'),
  7000, 'FAILED devolve o valor para available');

-- chave compartilhada com outro tipo/fluxo: recusa, sem tocar o saque
insert into public.processed_webhook_events (provider, event_type, event_key) values ('asaas', 'PAYMENT_RECEIVED', 'evt_shared');
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_shared', 'TRANSFER_BLOCKED', 'f3000000-0000-4000-8000-0000000000a2', 'tr_a2', null) $$,
  'EVENT_KEY_CONFLICT', 'event_key de outro event_type é recusado');
select is((select status from public.marketplace_withdrawals where id = 'f3000000-0000-4000-8000-0000000000a2'),
  'pending', 'colisão de chave não muda o saque');

-- conflito de identidade e saque inexistente: rollback inclusive da marca
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_mismatch', 'TRANSFER_DONE', 'f3000000-0000-4000-8000-0000000000a1', 'tr_other', null) $$,
  'PROVIDER_TRANSFER_ID_MISMATCH', 'transfer id divergente é recusado');
select is((select count(*)::int from public.processed_webhook_events where event_key = 'evt_mismatch'),
  0, 'marca desfeita quando o efeito falha');
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_missing', 'TRANSFER_DONE', 'f3000000-0000-4000-8000-0000000000ff', 'tr_x', null) $$,
  'WITHDRAWAL_NOT_FOUND', 'saque inexistente é recusado');

-- BLOCKED: só processing, sem ledger; reentrega é already_applied
select results_eq($$ select outcome, withdrawal_status from public.process_marketplace_transfer_webhook_event('evt_blocked_a2', 'TRANSFER_BLOCKED', 'f3000000-0000-4000-8000-0000000000a2', 'tr_a2', null) $$,
  $$ values ('applied'::text, 'processing'::text) $$, 'BLOCKED move para processing');
select results_eq($$ select outcome, withdrawal_status from public.process_marketplace_transfer_webhook_event('evt_pending_a2', 'TRANSFER_PENDING', 'f3000000-0000-4000-8000-0000000000a2', 'tr_a2', null) $$,
  $$ values ('already_applied'::text, 'processing'::text) $$, 'intermediário em processing é already_applied');
select is((select count(*)::int from public.marketplace_ledger_entries where reference_id = 'f3000000-0000-4000-8000-0000000000a2'),
  0, 'intermediários não tocam o ledger');

-- saque terminal sem transfer id: identidade não provada, falha fechado e não vincula
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_unproven_done', 'TRANSFER_FAILED', 'f3000000-0000-4000-8000-0000000000a5', 'tr_a5', null) $$,
  'TRANSFER_IDENTITY_UNPROVEN', 'desfecho em saque terminal sem id é recusado');
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_unproven_mid', 'TRANSFER_PENDING', 'f3000000-0000-4000-8000-0000000000a5', 'tr_a5', null) $$,
  'TRANSFER_IDENTITY_UNPROVEN', 'intermediário em saque terminal sem id é recusado');
select ok((select provider_transfer_id is null from public.marketplace_withdrawals where id = 'f3000000-0000-4000-8000-0000000000a5'),
  'saque terminal continua sem transfer id vinculado');
select is((select count(*)::int from public.processed_webhook_events where event_key in ('evt_unproven_done', 'evt_unproven_mid')),
  0, 'identidade não provada não deixa marca');

-- processing sem transfer id: mesma regra -- só pending pode vincular
select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_unproven_proc', 'TRANSFER_PENDING', 'f3000000-0000-4000-8000-0000000000a6', 'tr_a6', null) $$,
  'TRANSFER_IDENTITY_UNPROVEN', 'intermediário em processing sem id é recusado');
select ok((select provider_transfer_id is null from public.marketplace_withdrawals where id = 'f3000000-0000-4000-8000-0000000000a6'),
  'processing continua sem transfer id vinculado');
select is((select count(*)::int from public.processed_webhook_events where event_key = 'evt_unproven_proc'),
  0, 'processing sem id não deixa marca');
select is((select count(*)::int from public.marketplace_ledger_entries where reference_id = 'f3000000-0000-4000-8000-0000000000a6'),
  0, 'processing sem id não lança no ledger');

select throws_ok($$ select * from public.process_marketplace_transfer_webhook_event('evt_bad', 'PAYMENT_RECEIVED', 'f3000000-0000-4000-8000-0000000000a2', 'tr_a2', null) $$,
  'INVALID_EVENT_TYPE', 'evento fora de TRANSFER_* é recusado');

select * from finish();
rollback;
