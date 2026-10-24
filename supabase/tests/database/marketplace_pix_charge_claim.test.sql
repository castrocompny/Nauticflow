-- Migration 0082 -- reserva durável (claim) ANTES do POST /payments da cobrança
-- Pix do marketplace. PgTAP verificado (21 assertions) no DB efêmero desta
-- tarefa; não valida a chain Supabase completa. O teste de duas sessões foi
-- executado separadamente com fixture temporária; veja ADR 0007.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

insert into public.companies (id, name) values ('f2000000-0000-4000-8000-000000000001', 'pgTAP Claim A');
insert into public.vessels (id, company_id, name, type, official_capacity) values
  ('f2000000-0000-4000-8000-0000000000f1', 'f2000000-0000-4000-8000-000000000001', 'Escuna', 'escuna', 50);
insert into public.tours (id, company_id, name, slug, active) values
  ('f2000000-0000-4000-8000-0000000000e1', 'f2000000-0000-4000-8000-000000000001', 'Passeio', 'pgtap-claim-a', true);
insert into public.departures (id, company_id, tour_id, vessel_id, departs_at, capacity, status) values
  ('f2000000-0000-4000-8000-0000000000d1', 'f2000000-0000-4000-8000-000000000001',
   'f2000000-0000-4000-8000-0000000000e1', 'f2000000-0000-4000-8000-0000000000f1', now() + interval '60 days', 40, 'agendada');
insert into public.clients (id, company_id, name) values
  ('f2000000-0000-4000-8000-0000000000c1', 'f2000000-0000-4000-8000-000000000001', 'Cliente');
-- três reservas manuais (uma por cenário) -- payments_one_active_per_reservation
-- permite só um pending por reserva.
insert into public.reservations (id, company_id, departure_id, client_id, people_count, total_cents, status, source) values
  ('f2000000-0000-4000-8000-0000000000a1', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000d1', 'f2000000-0000-4000-8000-0000000000c1', 1, 15000, 'pendente', 'manual'),
  ('f2000000-0000-4000-8000-0000000000a2', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000d1', 'f2000000-0000-4000-8000-0000000000c1', 1, 15000, 'pendente', 'manual'),
  ('f2000000-0000-4000-8000-0000000000a3', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000d1', 'f2000000-0000-4000-8000-0000000000c1', 1, 15000, 'pendente', 'manual');
insert into public.payments (id, company_id, reservation_id, status, amount_cents) values
  ('f2000000-0000-4000-8000-0000000000b1', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000a1', 'pending', 15000),
  ('f2000000-0000-4000-8000-0000000000b2', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000a2', 'pending', 15000),
  ('f2000000-0000-4000-8000-0000000000b3', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-0000000000a3', 'pending', 15000);
-- b2 já tem o ID do provedor persistido e NUNCA foi reservado (estado legado)
update public.payments set provider_payment_id = 'pay_claim_legacy' where id = 'f2000000-0000-4000-8000-0000000000b2';

-- estrutura e privilégios
select has_column('public', 'payments', 'provider_charge_claimed_at', 'payments tem provider_charge_claimed_at');
select ok((select provider_charge_claimed_at is null from public.payments where id = 'f2000000-0000-4000-8000-0000000000b1'),
  'payment criado após a migration começa sem claim e pode receber a primeira reserva');
select ok(not has_function_privilege('anon', 'public.claim_marketplace_pix_charge_creation(uuid)', 'execute'), 'anon não executa o claim');
select ok(not has_function_privilege('authenticated', 'public.claim_marketplace_pix_charge_creation(uuid)', 'execute'), 'authenticated não executa o claim');
select ok(has_function_privilege('service_role', 'public.claim_marketplace_pix_charge_creation(uuid)', 'execute'), 'service_role executa o claim');
select ok((select prosecdef from pg_proc where oid = 'public.claim_marketplace_pix_charge_creation(uuid)'::regprocedure), 'claim é security definer');

set local role service_role;

-- 1) primeira chamada ganha; a segunda (replay/outro chamador) é bloqueada
select is((select outcome from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b1')),
  'claimed', 'primeira chamada recebe permissão para o POST');
select is((select outcome from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b1')),
  'blocked', 'segunda chamada sem provider id é bloqueada');
select is((select outcome from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b1')),
  'blocked', 'terceira chamada continua bloqueada (não libera sozinha)');
select is((select provider_payment_id from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b1')),
  null, 'bloqueado não devolve provider id');

reset role;

select ok((select provider_charge_claimed_at is not null from public.payments where id = 'f2000000-0000-4000-8000-0000000000b1'),
  'a reserva ficou gravada em payments');
select is((select status from public.payments where id = 'f2000000-0000-4000-8000-0000000000b1'), 'pending',
  'payment continua pending (claim não liquida nada)');

-- 2) falha ao persistir o ID não libera: continua bloqueado
set local role service_role;
select is((select outcome from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b1')),
  'blocked', 'sem mark do provider id, o estado segue bloqueado');

-- 3) ID já persistido (legado, nunca reservado) => linked, sem permissão de POST
select is((select outcome from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b2')),
  'linked', 'ID do provedor já persistido => linked');
select is((select provider_payment_id from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b2')),
  'pay_claim_legacy', 'linked devolve o ID persistido');

-- 4) depois do mark, o pagamento reservado passa a linked
select lives_ok(
  $$select * from public.mark_marketplace_payment_provider_created('f2000000-0000-4000-8000-0000000000b1', 'pay_claim_1')$$,
  'mark persiste o ID de um pagamento reservado');
select is((select outcome from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b1')),
  'linked', 'reservado + ID persistido => linked');

-- 5) erros
select throws_ok(
  $$select * from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000ff')$$,
  'PAYMENT_NOT_FOUND', 'payment inexistente é recusado');
reset role;

-- payment que não está mais pending nunca recebe permissão de POST
update public.payments set status = 'failed' where id = 'f2000000-0000-4000-8000-0000000000b3';
set local role service_role;
select throws_ok(
  $$select * from public.claim_marketplace_pix_charge_creation('f2000000-0000-4000-8000-0000000000b3')$$,
  'PAYMENT_NOT_PENDING', 'payment que não é pending é recusado');
reset role;

-- 6) cleanup por hold expirado NÃO libera um pagamento reservado sem ID
update public.payments set status = 'pending', provider_payment_id = null, provider_charge_claimed_at = now()
  where id = 'f2000000-0000-4000-8000-0000000000b3';
update public.reservations set hold_expires_at = now() - interval '1 minute' where id = 'f2000000-0000-4000-8000-0000000000a3';
set local role service_role;
select is((select was_cancelled from public.cancel_marketplace_pending_payment('f2000000-0000-4000-8000-0000000000b3')),
  false, 'cleanup não cancela pagamento reservado sem provider id');
reset role;
select is((select status from public.payments where id = 'f2000000-0000-4000-8000-0000000000b3'), 'pending',
  'pagamento reservado segue pending (slot não liberado)');

select * from finish();
rollback;
