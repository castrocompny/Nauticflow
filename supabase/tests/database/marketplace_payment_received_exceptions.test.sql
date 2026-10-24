-- Migration 0081 -- PAYMENT_RECEIVED em payment 'failed' vira exceção durável,
-- sem tocar payment/reserva/ledger. RECONSTRUÇÃO (2026-10-23). Testado com
-- pg_prove no DB efêmero desta tarefa (22 assertions); as fixtures são
-- artificiais e isso não valida a chain Supabase completa. Tudo revertido no fim.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

insert into public.companies (id, name) values ('f1000000-0000-4000-8000-000000000001', 'pgTAP Exc A');
insert into public.vessels (id, company_id, name, type, official_capacity) values
  ('f1000000-0000-4000-8000-0000000000f1', 'f1000000-0000-4000-8000-000000000001', 'Escuna', 'escuna', 50);
insert into public.tours (id, company_id, name, slug, active) values
  ('f1000000-0000-4000-8000-0000000000e1', 'f1000000-0000-4000-8000-000000000001', 'Passeio', 'pgtap-exc-a', true);
insert into public.departures (id, company_id, tour_id, vessel_id, departs_at, capacity, status) values
  ('f1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-000000000001',
   'f1000000-0000-4000-8000-0000000000e1', 'f1000000-0000-4000-8000-0000000000f1', now() + interval '60 days', 40, 'agendada');
insert into public.clients (id, company_id, name) values
  ('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-000000000001', 'Cliente');
insert into public.reservations (id, company_id, departure_id, client_id, people_count, total_cents, status, source) values
  ('f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-000000000001',
   'f1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000c1', 1, 15000, 'cancelada', 'manual');
insert into public.payments (id, company_id, reservation_id, status, amount_cents) values
  ('f1000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-000000000001',
   'f1000000-0000-4000-8000-0000000000a1', 'failed', 15000);

-- estrutura e privilégios
select ok((select relrowsecurity from pg_class where oid = 'public.marketplace_payment_exceptions'::regclass), 'RLS ligada na fila');
select ok(not has_table_privilege('anon', 'public.marketplace_payment_exceptions', 'select'), 'anon não lê a fila');
select ok(not has_table_privilege('service_role', 'public.marketplace_payment_exceptions', 'insert'), 'service_role não insere direto (só pela RPC)');
select ok(not has_function_privilege('authenticated', 'public.process_marketplace_payment_received_event(uuid,text,int)', 'execute'), 'authenticated não executa a RPC');
select ok(has_function_privilege('service_role', 'public.process_marketplace_payment_received_event(uuid,text,int)', 'execute'), 'service_role executa a RPC');

-- payment 'failed': exceção gravada, nada mais muda
set local role service_role;
select is((select outcome from public.process_marketplace_payment_received_event(
  'f1000000-0000-4000-8000-0000000000b1', 'pay_exc_1', 15000)), 'exception_recorded', 'primeira entrega grava a exceção');
select is((select outcome from public.process_marketplace_payment_received_event(
  'f1000000-0000-4000-8000-0000000000b1', 'pay_exc_1', 15000)), 'exception_existing', 'reentrega é idempotente');
select is((select outcome from public.process_marketplace_payment_received_event(
  'f1000000-0000-4000-8000-0000000000b1', 'pay_exc_2', 15000)), 'exception_recorded', 'outra cobrança do provedor gera outra exceção');
select is((select outcome from public.process_marketplace_payment_received_event(
  'f1000000-0000-4000-8000-0000000000b1', 'pay_exc_2', 15000)), 'exception_existing', 'reentrega da segunda cobrança é idempotente');
select throws_ok(
  $$select * from public.process_marketplace_payment_received_event('f1000000-0000-4000-8000-0000000000b1', 'pay_exc_2', 14999)$$,
  'PAYMENT_RECEIVED_EXCEPTION_MISMATCH', 'replay conflitante da mesma cobrança não é reconhecido como idempotente');
select is((select payment_status from public.process_marketplace_payment_received_event(
  'f1000000-0000-4000-8000-0000000000b1', 'pay_exc_1', 15000)), 'failed', 'status devolvido é failed');
reset role;

select is((select count(*)::int from public.marketplace_payment_exceptions
  where payment_id = 'f1000000-0000-4000-8000-0000000000b1'), 2, 'cada cobrança distinta tem sua própria exceção');
update public.payments set provider_payment_id = 'pay_exc_1' where id = 'f1000000-0000-4000-8000-0000000000b1';
set local role service_role;
select is((select outcome from public.process_marketplace_payment_received_event(
  'f1000000-0000-4000-8000-0000000000b1', 'pay_other', 15000)), 'exception_recorded', 'cobrança divergente em payment failed também é registrada');
select is((select provider_payment_id from public.payments where id = 'f1000000-0000-4000-8000-0000000000b1'), 'pay_exc_1', 'exceção não sobrescreve o vínculo original');
reset role;
select is((select count(*)::int from public.marketplace_payment_exceptions
  where payment_id = 'f1000000-0000-4000-8000-0000000000b1'), 3, 'três cobranças distintas permanecem visíveis na fila');
select is((select status from public.payments where id = 'f1000000-0000-4000-8000-0000000000b1'), 'failed', 'payment continua failed');
select is((select status from public.reservations where id = 'f1000000-0000-4000-8000-0000000000a1'), 'cancelada', 'reserva intacta');
select is((select count(*)::int from public.marketplace_ledger_entries
  where reference_id = 'f1000000-0000-4000-8000-0000000000b1'), 0, 'nenhum lançamento de ledger');
select is((select count(*)::int from public.marketplace_refunds
  where payment_id = 'f1000000-0000-4000-8000-0000000000b1'), 0, 'nenhum refund criado');

-- id do provedor divergente em payment já vinculado: erro (5xx no webhook), sem exceção nova
update public.payments set provider_payment_id = 'pay_exc_1', status = 'pending' where id = 'f1000000-0000-4000-8000-0000000000b1';
set local role service_role;
select throws_ok(
  $$select * from public.process_marketplace_payment_received_event('f1000000-0000-4000-8000-0000000000b1', 'pay_other', 15000)$$,
  'PROVIDER_PAYMENT_ID_MISMATCH', 'id do provedor divergente é recusado');
select throws_ok(
  $$select * from public.process_marketplace_payment_received_event('f1000000-0000-4000-8000-0000000000ff', 'pay_x', 1)$$,
  'PAYMENT_NOT_FOUND', 'payment inexistente é recusado');
reset role;

-- a função corrigida da 0059 passa a funcionar (antes: coluna ambígua)
set local role service_role;
select lives_ok(
  $$select * from public.mark_marketplace_payment_provider_created('f1000000-0000-4000-8000-0000000000b1', 'pay_exc_1')$$,
  'mark_marketplace_payment_provider_created não falha por coluna ambígua');
reset role;

select * from finish();
rollback;
