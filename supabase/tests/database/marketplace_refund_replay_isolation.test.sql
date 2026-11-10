-- create_marketplace_refund_request: o replay por idempotency_key não pode
-- devolver pedido de outra empresa nem de outra reserva (índice único da chave
-- é GLOBAL). Chamadas como `authenticated` com claims; dados fictícios; tudo
-- numa transação revertida no fim. Roda só em Postgres local descartável.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures: empresa A e empresa B, cada uma com reserva paga e um pedido
-- ---------------------------------------------------------------------------
insert into public.companies (id, name) values
  ('5e000000-0000-4000-8000-00000000000a', 'pgTAP Replay A'),
  ('5e000000-0000-4000-8000-00000000000b', 'pgTAP Replay B');
insert into auth.users (id, email, aud, role) values
  ('5e000000-0000-4000-8000-0000000000a1', 'replay-admin-a@local.test', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000a2', 'replay-super-a@local.test', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000a3', 'replay-staff-a@local.test', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000b1', 'replay-admin-b@local.test', 'authenticated', 'authenticated');
insert into public.profiles (id, company_id, role) values
  ('5e000000-0000-4000-8000-0000000000a1', '5e000000-0000-4000-8000-00000000000a', 'company_admin'),
  ('5e000000-0000-4000-8000-0000000000a2', '5e000000-0000-4000-8000-00000000000a', 'super_admin'),
  ('5e000000-0000-4000-8000-0000000000a3', '5e000000-0000-4000-8000-00000000000a', 'staff'),
  ('5e000000-0000-4000-8000-0000000000b1', '5e000000-0000-4000-8000-00000000000b', 'company_admin')
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role;

insert into public.vessels (id, company_id, name, type, official_capacity) values
  ('5e000000-0000-4000-8000-0000000000fa', '5e000000-0000-4000-8000-00000000000a', 'Escuna A', 'escuna', 50),
  ('5e000000-0000-4000-8000-0000000000fb', '5e000000-0000-4000-8000-00000000000b', 'Escuna B', 'escuna', 50);
insert into public.tours (id, company_id, name, slug, active) values
  ('5e000000-0000-4000-8000-0000000000ea', '5e000000-0000-4000-8000-00000000000a', 'Passeio A', 'pgtap-replay-a', true),
  ('5e000000-0000-4000-8000-0000000000eb', '5e000000-0000-4000-8000-00000000000b', 'Passeio B', 'pgtap-replay-b', true);
insert into public.departures (id, company_id, tour_id, vessel_id, departs_at, capacity, status) values
  ('5e000000-0000-4000-8000-0000000000da', '5e000000-0000-4000-8000-00000000000a',
   '5e000000-0000-4000-8000-0000000000ea', '5e000000-0000-4000-8000-0000000000fa', now() + interval '60 days', 40, 'agendada'),
  ('5e000000-0000-4000-8000-0000000000db', '5e000000-0000-4000-8000-00000000000b',
   '5e000000-0000-4000-8000-0000000000eb', '5e000000-0000-4000-8000-0000000000fb', now() + interval '60 days', 40, 'agendada');
insert into public.clients (id, company_id, name) values
  ('5e000000-0000-4000-8000-0000000000ca', '5e000000-0000-4000-8000-00000000000a', 'Cliente A'),
  ('5e000000-0000-4000-8000-0000000000cb', '5e000000-0000-4000-8000-00000000000b', 'Cliente B');
-- rA1 tem pedido; rA2 é outra reserva paga de A, sem pedido; rB1 tem pedido
insert into public.reservations (id, company_id, departure_id, client_id, people_count, total_cents, status, source) values
  ('5e000000-0000-4000-8000-0000000001a1', '5e000000-0000-4000-8000-00000000000a', '5e000000-0000-4000-8000-0000000000da', '5e000000-0000-4000-8000-0000000000ca', 1, 15000, 'confirmada', 'manual'),
  ('5e000000-0000-4000-8000-0000000001a2', '5e000000-0000-4000-8000-00000000000a', '5e000000-0000-4000-8000-0000000000da', '5e000000-0000-4000-8000-0000000000ca', 1, 15000, 'confirmada', 'manual'),
  ('5e000000-0000-4000-8000-0000000001b1', '5e000000-0000-4000-8000-00000000000b', '5e000000-0000-4000-8000-0000000000db', '5e000000-0000-4000-8000-0000000000cb', 1, 20000, 'confirmada', 'manual');
insert into public.payments (id, company_id, reservation_id, status, amount_cents) values
  ('5e000000-0000-4000-8000-0000000002a1', '5e000000-0000-4000-8000-00000000000a', '5e000000-0000-4000-8000-0000000001a1', 'paid', 15000),
  ('5e000000-0000-4000-8000-0000000002a2', '5e000000-0000-4000-8000-00000000000a', '5e000000-0000-4000-8000-0000000001a2', 'paid', 15000),
  ('5e000000-0000-4000-8000-0000000002b1', '5e000000-0000-4000-8000-00000000000b', '5e000000-0000-4000-8000-0000000001b1', 'paid', 20000);
insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id, reservation_id) values
  ('5e000000-0000-4000-8000-00000000000a', 'operator_blocked', 'blocked', 13000, 'payment', '5e000000-0000-4000-8000-0000000002a1', '5e000000-0000-4000-8000-0000000001a1'),
  ('5e000000-0000-4000-8000-00000000000b', 'operator_blocked', 'blocked', 17000, 'payment', '5e000000-0000-4000-8000-0000000002b1', '5e000000-0000-4000-8000-0000000001b1');
insert into public.marketplace_refunds (id, company_id, reservation_id, payment_id, customer_refund_cents, operator_deduction_cents,
    platform_fee_adjustment_cents, deducted_from_bucket, status, reason_code, cancelled_by_type, idempotency_key) values
  ('5e000000-0000-4000-8000-0000000003a1', '5e000000-0000-4000-8000-00000000000a', '5e000000-0000-4000-8000-0000000001a1',
   '5e000000-0000-4000-8000-0000000002a1', 15000, 13000, 2000, 'blocked', 'pending', 'operator_cancellation', 'operator', 'pgtap-replay-key-A-0001'),
  ('5e000000-0000-4000-8000-0000000003b1', '5e000000-0000-4000-8000-00000000000b', '5e000000-0000-4000-8000-0000000001b1',
   '5e000000-0000-4000-8000-0000000002b1', 19999, 17777, 2222, 'blocked', 'processing', 'operator_cancellation', 'operator', 'pgtap-replay-key-B-0001');

-- Estado financeiro antes de qualquer chamada (owner)
create temporary table snap (name text primary key, v text) on commit drop;
insert into snap values
  ('refunds', (select md5(string_agg(t::text, '|' order by t.id)) from public.marketplace_refunds t)),
  ('ledger', (select md5(string_agg(t::text, '|' order by t.id)) from public.marketplace_ledger_entries t)),
  ('bal_a', (select row(b.*)::text from public.get_marketplace_operator_balances('5e000000-0000-4000-8000-00000000000a') b)),
  ('bal_b', (select row(b.*)::text from public.get_marketplace_operator_balances('5e000000-0000-4000-8000-00000000000b') b));

-- ---------------------------------------------------------------------------
-- Catálogo: assinatura, SECURITY DEFINER, search_path, grants
-- ---------------------------------------------------------------------------
select ok(
  (select prosecdef and proconfig @> array['search_path=public'] from pg_proc
    where oid = 'public.create_marketplace_refund_request(uuid,text,text,int,text)'::regprocedure),
  'assinatura (uuid,text,text,int,text) existe, SECURITY DEFINER, search_path=public');
select ok(
  has_function_privilege('authenticated', 'public.create_marketplace_refund_request(uuid,text,text,int,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_marketplace_refund_request(uuid,text,text,int,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.create_marketplace_refund_request(uuid,text,text,int,text)', 'EXECUTE'),
  'grants inalterados: só authenticated executa');

-- ---------------------------------------------------------------------------
-- Admin A (company_admin) tentando replay de pedidos que não são dele
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001b1', 'pgtap-replay-key-B-0001', 'operator_cancellation')$$,
  'P0001', 'IDEMPOTENCY_KEY_CONFLICT',
  'admin A com chave de B e reserva de B: recusa sem devolver o pedido de B');
select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001a1', 'pgtap-replay-key-B-0001', 'operator_cancellation')$$,
  'P0001', 'IDEMPOTENCY_KEY_CONFLICT',
  'admin A com chave de B e reserva PRÓPRIA: recusa sem devolver o pedido de B');
select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001a2', 'pgtap-replay-key-A-0001', 'operator_cancellation')$$,
  'P0001', 'IDEMPOTENCY_KEY_CONFLICT',
  'admin A com chave própria e reservation_id incompatível: recusa, não faz replay');
select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001b1', 'pgtap-replay-key-NOVA-0001', 'operator_cancellation')$$,
  'P0001', 'BOOKING_NOT_FOUND',
  'chave inexistente com reserva de B continua BOOKING_NOT_FOUND (regra anterior)');

-- super_admin segue vinculado à própria empresa (regra existente)
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001b1', 'pgtap-replay-key-B-0001', 'operator_cancellation')$$,
  'P0001', 'IDEMPOTENCY_KEY_CONFLICT',
  'super_admin de A com chave e reserva de B: recusa (sem privilégio entre empresas)');
select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001a1', 'pgtap-replay-key-B-0001', 'operator_cancellation')$$,
  'P0001', 'IDEMPOTENCY_KEY_CONFLICT',
  'super_admin de A com chave de B e reserva própria: recusa');

-- staff continua sem acesso, e não descobre nada pela chave
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001a1', 'pgtap-replay-key-A-0001', 'operator_cancellation')$$,
  'P0001', 'FORBIDDEN', 'staff: FORBIDDEN mesmo com chave e reserva da própria empresa');
select throws_ok(
  $$select * from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001b1', 'pgtap-replay-key-B-0001', 'operator_cancellation')$$,
  'P0001', 'FORBIDDEN', 'staff: FORBIDDEN com chave de B');

reset role;
select is((select md5(string_agg(t::text, '|' order by t.id)) from public.marketplace_refunds t),
  (select v from snap where name = 'refunds'), 'recusas não alteram marketplace_refunds');
select is((select md5(string_agg(t::text, '|' order by t.id)) from public.marketplace_ledger_entries t),
  (select v from snap where name = 'ledger'), 'recusas não alteram o ledger');
select is(
  (select row(b.*)::text from public.get_marketplace_operator_balances('5e000000-0000-4000-8000-00000000000a') b)
  || '/' || (select row(b.*)::text from public.get_marketplace_operator_balances('5e000000-0000-4000-8000-00000000000b') b),
  (select v from snap where name = 'bal_a') || '/' || (select v from snap where name = 'bal_b'),
  'recusas não alteram saldos de A nem de B');

-- ---------------------------------------------------------------------------
-- Replay legítimo (mesma empresa e reserva) preservado, sem novo efeito
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select id, status, customer_refund_cents, operator_deduction_cents, is_replay
      from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001a1', 'pgtap-replay-key-A-0001', 'operator_cancellation')$$,
  $$values ('5e000000-0000-4000-8000-0000000003a1'::uuid, 'pending'::text, 15000, 13000, true)$$,
  'admin A: replay legítimo devolve o próprio pedido');

set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select results_eq(
  $$select id, status, customer_refund_cents, operator_deduction_cents, is_replay
      from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001b1', 'pgtap-replay-key-B-0001', 'operator_cancellation')$$,
  $$values ('5e000000-0000-4000-8000-0000000003b1'::uuid, 'processing'::text, 19999, 17777, true)$$,
  'admin B: replay legítimo devolve o próprio pedido');

set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select id, is_replay
      from public.create_marketplace_refund_request('5e000000-0000-4000-8000-0000000001a1', 'pgtap-replay-key-A-0001', 'operator_cancellation')$$,
  $$values ('5e000000-0000-4000-8000-0000000003a1'::uuid, true)$$,
  'super_admin de A: replay legítimo na própria empresa preservado');

reset role;
select ok(
  (select md5(string_agg(t::text, '|' order by t.id)) from public.marketplace_refunds t) = (select v from snap where name = 'refunds')
  and (select md5(string_agg(t::text, '|' order by t.id)) from public.marketplace_ledger_entries t) = (select v from snap where name = 'ledger'),
  'replays legítimos não criam pedido nem movimentam o ledger');

select * from finish();
rollback;
