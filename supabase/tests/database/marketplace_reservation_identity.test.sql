-- Migration 0080 -- identidade da reserva do marketplace imutável.
-- Achado da revisão adversarial (2026-10-13): a policy "reservas da empresa"
-- (0000) deixa o authenticated da empresa fazer UPDATE/DELETE em qualquer
-- coluna. Trocar source (marketplace -> manual), idempotency_key ou
-- request_fingerprint tirava a reserva do índice parcial de idempotência e o
-- replay do ToursFlow criava uma SEGUNDA reserva. Aqui: só os campos
-- operacionais continuam editáveis; liquidação/cancelamento seguem funcionando.
-- Roda só no Supabase local: `supabase test db --local`. Tudo revertido no fim.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

-- ----------------------------------------------------------------------------
-- Fixtures
-- ----------------------------------------------------------------------------
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'pgTAP Ident A'),
  ('d0000000-0000-4000-8000-000000000002', 'pgTAP Ident B'),
  ('e0000000-0000-4000-8000-000000000003', 'pgTAP Ident C (exclusão de conta)');
insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-4000-8000-0000000000a1', 'pgtap-ident-a@local.test', 'authenticated', 'authenticated'),
  ('d0000000-0000-4000-8000-0000000000b1', 'pgtap-ident-b@local.test', 'authenticated', 'authenticated');
insert into public.profiles (id, company_id, role) values
  ('c0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000001', 'company_admin'),
  ('d0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-000000000002', 'company_admin')
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role;
insert into public.vessels (id, company_id, name, type, official_capacity) values
  ('c0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-000000000001', 'Escuna A', 'escuna', 50),
  ('e0000000-0000-4000-8000-0000000000f1', 'e0000000-0000-4000-8000-000000000003', 'Escuna C', 'escuna', 50);
-- published no INSERT: o trigger de publicação só valida transição (UPDATE)
insert into public.tours (id, company_id, name, slug, active, marketplace_status) values
  ('c0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-000000000001', 'Passeio A', 'pgtap-ident-a', true, 'published'),
  ('e0000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-000000000003', 'Passeio C', 'pgtap-ident-c', true, 'published');
insert into public.departures (id, company_id, tour_id, vessel_id, departs_at, capacity, status, marketplace_sales_enabled) values
  ('c0000000-0000-4000-8000-0000000000d1', 'c0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000f1',
   now() + interval '60 days', 40, 'agendada', true),
  ('e0000000-0000-4000-8000-0000000000d1', 'e0000000-0000-4000-8000-000000000003',
   'e0000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-0000000000f1',
   now() + interval '60 days', 40, 'agendada', true);
insert into public.clients (id, company_id, name) values
  ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-000000000001', 'Cliente balcão'),
  ('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-000000000002', 'Cliente B');
-- recursos da empresa B: alvo de uma tentativa de "mover" a reserva inteira
insert into public.vessels (id, company_id, name, type, official_capacity) values
  ('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-000000000002', 'Escuna B', 'escuna', 50);
insert into public.tours (id, company_id, name, slug, active) values
  ('d0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-000000000002', 'Passeio B', 'pgtap-ident-b', true);
insert into public.departures (id, company_id, tour_id, vessel_id, departs_at, capacity, status) values
  ('d0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000f1',
   now() + interval '60 days', 40, 'agendada');

-- comissão da plataforma (só "backend" grava -- auth.role() = service_role)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.marketplace_fee_config (fee_basis_points) values (1000);

create temporary table ident (name text primary key, id uuid) on commit drop;
grant all on ident to service_role, authenticated;

create temporary table policy_v1 (snapshot jsonb) on commit drop;
insert into policy_v1 values
  ('{"id":"toursflow-cancelamento","version":"2026-10-01","title":"Política","summary":"Resumo","terms":["t"]}');
grant select on policy_v1 to service_role, authenticated;

set local role service_role;
insert into ident
  select 'mkt', booking_id from public.create_marketplace_booking(
    'c0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Turista', 'turista@local.test', null, '52998224725',
    'ident-key-1', 'ident-fp-1', 15, 'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_v1));
insert into ident
  select 'mkt_pay', booking_id from public.create_marketplace_booking(
    'c0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Pagante', 'pagante@local.test', null, '52998224725',
    'ident-key-pay', 'ident-fp-pay', 15, 'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_v1));
insert into ident
  select 'mkt_c', booking_id from public.create_marketplace_booking(
    'e0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Turista C', 'turista-c@local.test', null, null,
    'ident-key-c', 'ident-fp-c', 15, 'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_v1));
reset role;

insert into public.reservations (id, company_id, departure_id, client_id, people_count, total_cents, status, source)
  values ('c0000000-0000-4000-8000-0000000000a9', 'c0000000-0000-4000-8000-000000000001',
          'c0000000-0000-4000-8000-0000000000d1', 'c0000000-0000-4000-8000-0000000000c1', 1, 5000, 'confirmada', 'manual');
insert into ident values ('manual', 'c0000000-0000-4000-8000-0000000000a9');

-- ----------------------------------------------------------------------------
-- Catálogo
-- ----------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.reservations'::regclass and not tgisinternal and tgenabled = 'O'
      and tgname in ('trg_reservation_marketplace_row_guard', 'trg_reservation_marketplace_delete_guard')),
  2, 'triggers de identidade (UPDATE/INSERT) e de DELETE existem e estão habilitados');

-- ----------------------------------------------------------------------------
-- UPDATE pela empresa dona (authenticated)
-- ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

select throws_ok(
  format($$update public.reservations set source = 'manual' where id = %L$$, (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE',
  'empresa dona não converte reserva marketplace em manual');
select throws_ok(
  format($$update public.reservations set idempotency_key = 'outra-key' where id = %L$$, (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE',
  'empresa dona não altera idempotency_key');
select throws_ok(
  format($$update public.reservations set idempotency_key = null where id = %L$$, (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE',
  'empresa dona não apaga idempotency_key');
select throws_ok(
  format($$update public.reservations set request_fingerprint = 'forjado' where id = %L$$, (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE',
  'empresa dona não altera request_fingerprint');
select throws_ok(
  format($$update public.reservations set source = 'marketplace', idempotency_key = 'squat-key', request_fingerprint = 'x'
          where id = %L$$, (select id from ident where name = 'manual')),
  '42501', 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE',
  'empresa dona não converte reserva manual em marketplace');
select throws_ok(
  $$insert into public.reservations (company_id, departure_id, client_id, people_count, source, idempotency_key, request_fingerprint)
    values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000d1',
            'c0000000-0000-4000-8000-0000000000c1', 1, 'marketplace', 'squat-key', 'x')$$,
  '42501', 'MARKETPLACE_BOOKING_RPC_REQUIRED',
  'empresa dona não cria reserva marketplace por fora da RPC (squatting de Idempotency-Key)');
-- forjar a marca transacional na própria sessão não adianta: ela só vale
-- dentro da RPC (current_user = dono do núcleo interno)
select set_config('nauticflow.marketplace_booking_insert', txid_current()::text || ':squat-key', true);
select throws_ok(
  $$insert into public.reservations (company_id, departure_id, client_id, people_count, source, idempotency_key, request_fingerprint)
    values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000d1',
            'c0000000-0000-4000-8000-0000000000c1', 1, 'marketplace', 'squat-key', 'x')$$,
  '42501', 'MARKETPLACE_BOOKING_RPC_REQUIRED',
  'authenticated com a marca forjada via set_config continua bloqueado');
select set_config('nauticflow.marketplace_booking_insert', '', true);
select throws_ok(
  format($$delete from public.reservations where id = %L$$, (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_DELETE_FORBIDDEN',
  'empresa dona não apaga reserva marketplace (liberaria a key e apagaria pagamentos)');

-- campos operacionais continuam livres
select lives_ok(
  format($$update public.reservations set status = 'cancelada' where id = %L$$, (select id from ident where name = 'mkt')),
  'cancelamento lógico (status) da reserva marketplace continua permitido');
select lives_ok(
  format($$update public.reservations set people_count = 2, total_cents = 20000, origin_name = 'ToursFlow (ajuste)',
            client_id = client_id, departure_id = departure_id where id = %L$$, (select id from ident where name = 'mkt')),
  'edição operacional (updateReservation) da reserva marketplace continua permitida');
select lives_ok(
  format($$update public.reservations set source = source, idempotency_key = idempotency_key,
            request_fingerprint = request_fingerprint, company_id = company_id where id = %L$$, (select id from ident where name = 'mkt')),
  'UPDATE que reescreve a identidade com o mesmo valor é aceito (full-row update sem mudança)');

-- reserva manual: comportamento de sempre
select lives_ok(
  format($$update public.reservations set source = 'partner', origin_name = 'Agência X' where id = %L$$, (select id from ident where name = 'manual')),
  'reserva manual continua podendo trocar de canal entre canais não-marketplace');
select lives_ok(
  format($$delete from public.reservations where id = %L$$, (select id from ident where name = 'manual')),
  'reserva manual continua podendo ser excluída pela empresa');

-- ----------------------------------------------------------------------------
-- Outra empresa (B): RLS esconde, nada muda
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is_empty(
  format($$update public.reservations set source = 'manual', idempotency_key = null, request_fingerprint = 'x'
          where id = %L returning id$$, (select id from ident where name = 'mkt')),
  'empresa B não altera identidade da reserva da empresa A');
select is_empty(
  format($$delete from public.reservations where id = %L returning id$$, (select id from ident where name = 'mkt')),
  'empresa B não apaga a reserva da empresa A');
select is_empty(
  format($$update public.reservations set company_id = 'd0000000-0000-4000-8000-000000000002' where id = %L returning id$$,
         (select id from ident where name = 'mkt')),
  'empresa B não move a reserva da empresa A para si');
reset role;

-- ----------------------------------------------------------------------------
-- service_role e company_id (mesmo com DML disponível)
-- ----------------------------------------------------------------------------
-- o Supabase local recente não expõe tabela nova ao service_role; em produção
-- ele tem DML. Concede só nesta transação para provar que é o TRIGGER que barra.
grant select, update, delete on public.reservations to service_role;
grant select on public.departures, public.clients, public.partners to service_role;
set local role service_role;
select throws_ok(
  -- saída + cliente da B juntos: passa no trg_reservation_fk_company, então
  -- quem barra é o guard de identidade
  format($$update public.reservations set company_id = 'd0000000-0000-4000-8000-000000000002',
            departure_id = 'd0000000-0000-4000-8000-0000000000d1', client_id = 'd0000000-0000-4000-8000-0000000000c1'
          where id = %L$$,
         (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE',
  'nem service_role move reserva marketplace para outra empresa');
select throws_ok(
  format($$update public.reservations set source = 'manual' where id = %L$$, (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE',
  'nem service_role converte reserva marketplace em manual');
select throws_ok(
  format($$delete from public.reservations where id = %L$$, (select id from ident where name = 'mkt')),
  '42501', 'MARKETPLACE_RESERVATION_DELETE_FORBIDDEN',
  'nem service_role apaga reserva marketplace');
reset role;

-- INSERT direto de reserva marketplace por service_role e pelo dono do banco.
-- No Supabase hospedado o service_role tem DML em todas as tabelas de public
-- (os triggers anteriores leem tours/departures com FOR UPDATE) -- reproduz
-- isso só nesta transação, pra que quem barra seja o guard, não falta de grant.
grant select, insert, update, delete on all tables in schema public to service_role;
set local role service_role;
select throws_ok(
  $$insert into public.reservations (company_id, departure_id, client_id, people_count, source, idempotency_key, request_fingerprint)
    values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000d1',
            'c0000000-0000-4000-8000-0000000000c1', 1, 'marketplace', 'squat-key-sr', 'x')$$,
  '42501', 'MARKETPLACE_BOOKING_RPC_REQUIRED',
  'service_role não insere reserva marketplace direto');
reset role;
select throws_ok(
  $$insert into public.reservations (company_id, departure_id, client_id, people_count, source, idempotency_key, request_fingerprint)
    values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000d1',
            'c0000000-0000-4000-8000-0000000000c1', 1, 'marketplace', 'squat-key-pg', 'x')$$,
  '42501', 'MARKETPLACE_BOOKING_RPC_REQUIRED',
  'nem o dono do banco (postgres) insere reserva marketplace direto, sem a marca');

-- função SECURITY DEFINER futura (mesmo dono das RPCs) que esquece a marca
create function public.pgtap_rogue_marketplace_insert() returns void
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.reservations (company_id, departure_id, client_id, people_count, source, idempotency_key, request_fingerprint)
  values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000d1',
          'c0000000-0000-4000-8000-0000000000c1', 1, 'marketplace', 'squat-key-fn', 'x');
end;
$fn$;
grant execute on function public.pgtap_rogue_marketplace_insert() to authenticated;
set local role authenticated;
select throws_ok(
  'select public.pgtap_rogue_marketplace_insert()',
  '42501', 'MARKETPLACE_BOOKING_RPC_REQUIRED',
  'função SECURITY DEFINER sem a marca não cria reserva marketplace');
reset role;

select ok(
  (select source = 'marketplace' and idempotency_key = 'ident-key-1' and request_fingerprint = 'ident-fp-1'
          and company_id = 'c0000000-0000-4000-8000-000000000001'
     from public.reservations where id = (select id from ident where name = 'mkt')),
  'identidade da reserva marketplace intacta depois de todas as tentativas');

-- ----------------------------------------------------------------------------
-- Replay continua devolvendo a reserva original (sem duplicar)
-- ----------------------------------------------------------------------------
create temporary table counts (name text primary key, n int) on commit drop;
insert into counts select 'before_replay', count(*) from public.reservations
  where departure_id = 'c0000000-0000-4000-8000-0000000000d1';
set local role service_role;
insert into ident
  select 'replay', booking_id from public.create_marketplace_booking(
    'c0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Turista', 'turista@local.test', null, '52998224725',
    'ident-key-1', 'ident-fp-1', 15, 'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_v1));
reset role;
select is((select id from ident where name = 'replay'), (select id from ident where name = 'mkt'),
  'replay com a mesma key devolve a reserva original');
-- conta pela saída, não pela key: o ataque altera justamente a key
select is(
  (select count(*)::int from public.reservations where departure_id = 'c0000000-0000-4000-8000-0000000000d1'),
  (select n from counts where name = 'before_replay'),
  'replay não cria uma segunda reserva na saída');

-- ----------------------------------------------------------------------------
-- Fluxos legítimos do banco: pagamento + liquidação (webhook) e outcome
-- ----------------------------------------------------------------------------
set local role service_role;
insert into ident
  select 'payment', payment_id from public.create_marketplace_payment_attempt(
    (select id from ident where name = 'mkt_pay'), 'pix', 'ident-pay-idem', 'ident-pay-fp');
select is(
  (select reservation_status from public.settle_marketplace_payment_received(
     (select id from ident where name = 'payment'), 'pay_local_ident', 10000)),
  'confirmada',
  'liquidação do pagamento (webhook) continua confirmando a reserva marketplace');
reset role;
select is(
  (select status from public.reservations where id = (select id from ident where name = 'mkt_pay')),
  'confirmada', 'status confirmada persistido pela liquidação');
-- set_marketplace_reservation_outcome roda como dono e só faz UPDATE de outcome
select lives_ok(
  format($$update public.reservations set outcome = 'completed' where id = %L$$, (select id from ident where name = 'mkt_pay')),
  'UPDATE de outcome (fluxo de settlement/D+1) continua permitido');
select throws_ok(
  format($$delete from public.reservations where id = %L$$, (select id from ident where name = 'mkt_pay')),
  '42501', 'MARKETPLACE_RESERVATION_DELETE_FORBIDDEN',
  'reserva marketplace paga não é apagada nem pelo dono do banco (pagamento iria junto em cascata)');
select is(
  (select count(*)::int from public.payments where reservation_id = (select id from ident where name = 'mkt_pay')),
  1, 'pagamento da reserva marketplace preservado');

-- ----------------------------------------------------------------------------
-- Exclusão de conta (empresa inteira) continua funcionando em cascata
-- ----------------------------------------------------------------------------
select lives_ok(
  $$delete from public.companies where id = 'e0000000-0000-4000-8000-000000000003'$$,
  'excluir a empresa inteira continua apagando suas reservas marketplace em cascata');
select is(
  (select count(*)::int from public.reservations where id = (select id from ident where name = 'mkt_c')),
  0, 'reserva marketplace da empresa excluída foi removida pela cascata');

-- ----------------------------------------------------------------------------
-- RPC (dono do banco) continua criando reserva marketplace normalmente
-- ----------------------------------------------------------------------------
set local role service_role;
insert into ident
  select 'new_after', booking_id from public.create_marketplace_booking(
    'c0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Novo', 'novo@local.test', null, null,
    'ident-key-new', 'ident-fp-new', 15, 'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_v1));
reset role;
select is(
  (select source from public.reservations where id = (select id from ident where name = 'new_after')),
  'marketplace', 'RPC (assinatura nova) continua criando reserva marketplace com a marca');
select ok(
  coalesce(current_setting('nauticflow.marketplace_booking_insert', true), '') = '',
  'a marca transacional é limpa logo depois do INSERT da RPC');
set local role service_role;
insert into ident
  select 'old_sig', booking_id from public.create_marketplace_booking(
    'c0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Antiga', 'antiga@local.test', null, null,
    'ident-key-old', 'ident-fp-old', 15);
reset role;
select is(
  (select source from public.reservations where id = (select id from ident where name = 'old_sig')),
  'marketplace', 'RPC (assinatura antiga, transição) também cria reserva marketplace com a marca');
select is(
  (select count(*)::int from public.reservations where source = 'marketplace' and idempotency_key like 'squat-key%'),
  0, 'nenhuma key "reservada" por INSERT/UPDATE fora da RPC');

select * from finish();
rollback;
