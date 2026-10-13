-- Migration 0080 -- snapshot imutável da política do marketplace na reserva.
-- Cobre H1 (imutabilidade/CHECK), H2 (assinaturas antiga e nova + ACL),
-- M2 (replay com/sem snapshot) e o erro MARKETPLACE_POLICY_CONFLICT que a
-- rota mapeia para 409 (M1). Roda só no Supabase local: `supabase test db`.
-- Tudo dentro de uma transação revertida no fim -- nenhum dado persiste.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(46);

-- ----------------------------------------------------------------------------
-- Fixtures: empresa A (dona da saída) e empresa B (outra empresa)
-- ----------------------------------------------------------------------------
insert into public.companies (id, name) values
  ('a0000000-0000-4000-8000-000000000001', 'pgTAP Empresa A'),
  ('b0000000-0000-4000-8000-000000000002', 'pgTAP Empresa B');
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'pgtap-a@local.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-0000000000b1', 'pgtap-b@local.test', 'authenticated', 'authenticated');
insert into public.profiles (id, company_id, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 'company_admin'),
  ('b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000002', 'company_admin')
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role;
insert into public.vessels (id, company_id, name, type, official_capacity) values
  ('a0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001', 'Escuna pgTAP', 'escuna', 50);
insert into public.tours (id, company_id, name, slug, active) values
  ('a0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000001', 'Passeio pgTAP', 'passeio-pgtap', true);
insert into public.departures (id, company_id, tour_id, vessel_id, departs_at, capacity, status, marketplace_sales_enabled) values
  ('a0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-0000000000f1',
   now() + interval '30 days', 40, 'agendada', true);

create temporary table policy_fixture (name text primary key, snapshot jsonb) on commit drop;
insert into policy_fixture values
  ('v1', '{"id":"toursflow-cancelamento","version":"2026-10-01","title":"Política de cancelamento","summary":"Cancelamento gratuito até 24h antes.","terms":["Reembolso integral até 24h antes."]}'),
  ('v1_reordered', '{"terms":["Reembolso integral até 24h antes."],"summary":"Cancelamento gratuito até 24h antes.","title":"Política de cancelamento","version":"2026-10-01","id":"toursflow-cancelamento"}'),
  ('v2', '{"id":"toursflow-cancelamento","version":"2026-11-01","title":"Política de cancelamento","summary":"Cancelamento gratuito até 48h antes.","terms":["Reembolso integral até 48h antes."]}'),
  ('empty_terms', '{"id":"toursflow-cancelamento","version":"2026-10-01","title":"Política","summary":"Resumo","terms":[]}'),
  ('extra_key', '{"id":"toursflow-cancelamento","version":"2026-10-01","title":"Política","summary":"Resumo","terms":["t"],"extra":"x"}');
grant select on policy_fixture to service_role, authenticated;

create temporary table results (name text primary key, booking_id uuid, is_replay boolean) on commit drop;
grant all on results to service_role, authenticated;

-- ----------------------------------------------------------------------------
-- Catálogo: assinaturas, SECURITY DEFINER, search_path, grants (H2)
-- ----------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role',
    'public.create_marketplace_booking(uuid,int,int,text,text,text,text,text,text,int)', 'EXECUTE'),
  'H2: assinatura antiga (10 params) continua executável por service_role durante a transição');
select ok(
  has_function_privilege('service_role',
    'public.create_marketplace_booking(uuid,int,int,text,text,text,text,text,text,int,text,text,jsonb)', 'EXECUTE'),
  'H2: assinatura nova (13 params) executável por service_role');
select ok(
  not has_function_privilege('anon', 'public.create_marketplace_booking(uuid,int,int,text,text,text,text,text,text,int)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_marketplace_booking(uuid,int,int,text,text,text,text,text,text,int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_marketplace_booking(uuid,int,int,text,text,text,text,text,text,int,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_marketplace_booking(uuid,int,int,text,text,text,text,text,text,int,text,text,jsonb)', 'EXECUTE'),
  'anon/authenticated não executam nenhuma das assinaturas públicas');
select ok(
  not has_function_privilege('service_role', 'public.create_marketplace_booking_internal(uuid,int,int,text,text,text,text,text,text,int,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_marketplace_booking_internal(uuid,int,int,text,text,text,text,text,text,int,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_marketplace_booking_internal(uuid,int,int,text,text,text,text,text,text,int,text,text,jsonb)', 'EXECUTE'),
  'núcleo interno não é executável por nenhum papel da API');
select is(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('create_marketplace_booking', 'create_marketplace_booking_internal')
      and prosecdef and proconfig @> array['search_path=public']),
  3,
  'as três funções de criação são SECURITY DEFINER com search_path=public');
select ok(
  not has_function_privilege('authenticated', 'public.check_reservation_marketplace_policy_guard()', 'EXECUTE'),
  'função do trigger não é executável por authenticated');
select is(
  (select tgenabled::text from pg_trigger where tgname = 'trg_reservation_marketplace_policy_guard'
     and tgrelid = 'public.reservations'::regclass),
  'O',
  'H1: trigger de imutabilidade existe e está habilitado');

-- ----------------------------------------------------------------------------
-- Reserva nova com snapshot válido
-- ----------------------------------------------------------------------------
set local role service_role;
insert into results
  select 'new', booking_id, is_replay from public.create_marketplace_booking(
    'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
    'pgtap-key-new', 'fp-new', 15,
    'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_fixture where name = 'v1'));
reset role;

select is((select is_replay from results where name = 'new'), false, 'reserva nova: is_replay = false');
select is(
  (select marketplace_policy_snapshot from public.reservations where id = (select booking_id from results where name = 'new')),
  (select snapshot from policy_fixture where name = 'v1'),
  'reserva nova: snapshot gravado no INSERT');
select is(
  (select marketplace_policy_id || '|' || marketplace_policy_version from public.reservations
    where id = (select booking_id from results where name = 'new')),
  'toursflow-cancelamento|2026-10-01',
  'reserva nova: id e versão coerentes com o snapshot');

-- ----------------------------------------------------------------------------
-- Snapshot inválido: erro antes de qualquer escrita (rollback)
-- ----------------------------------------------------------------------------
set local role service_role;
select throws_ok(
  $$select * from public.create_marketplace_booking(
      'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
      'pgtap-key-invalid', 'fp-invalid', 15,
      'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_fixture where name = 'empty_terms'))$$,
  'P0001', 'INVALID_MARKETPLACE_POLICY_SNAPSHOT',
  'snapshot com terms vazio é recusado');
select throws_ok(
  $$select * from public.create_marketplace_booking(
      'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
      'pgtap-key-invalid', 'fp-invalid', 15,
      'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_fixture where name = 'extra_key'))$$,
  'P0001', 'INVALID_MARKETPLACE_POLICY_SNAPSHOT',
  'snapshot com campo fora da allowlist é recusado');
select throws_ok(
  $$select * from public.create_marketplace_booking(
      'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
      'pgtap-key-invalid', 'fp-invalid', 15,
      'outra-politica', '2026-10-01', (select snapshot from policy_fixture where name = 'v1'))$$,
  'P0001', 'INVALID_MARKETPLACE_POLICY_SNAPSHOT',
  'p_marketplace_policy_id divergente do snapshot é recusado');
select throws_ok(
  $$select * from public.create_marketplace_booking(
      'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
      'pgtap-key-invalid', 'fp-invalid', 15, null, null, null)$$,
  'P0001', 'INVALID_MARKETPLACE_POLICY_SNAPSHOT',
  'assinatura nova com snapshot NULL é recusada');
reset role;
select is(
  (select count(*)::int from public.reservations where idempotency_key = 'pgtap-key-invalid'),
  0, 'snapshot inválido: nenhuma reserva gravada');
select is(
  (select count(*)::int from public.clients where email = 'maria@local.test'
     and company_id = 'a0000000-0000-4000-8000-000000000001'),
  1, 'snapshot inválido é recusado antes de qualquer escrita (nenhum cliente extra)');

-- rollback de verdade: o cliente É inserido e a falha vem depois, no INSERT da
-- reserva (capacidade 40 < 41 pedidas, trg_reservation_capacity)
set local role service_role;
select throws_like(
  $$select * from public.create_marketplace_booking(
      'a0000000-0000-4000-8000-0000000000d1', 41, 410000, 'Rollback', 'rollback@local.test', null, '52998224725',
      'pgtap-key-rollback', 'fp-rollback', 15,
      'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_fixture where name = 'v1'))$$,
  'Capacidade excedida%',
  'falha depois do INSERT do cliente (capacidade) aborta a RPC');
reset role;
select is(
  (select count(*)::int from public.clients where email = 'rollback@local.test'),
  0, 'rollback: o cliente inserido antes da falha não permanece');
select is(
  (select count(*)::int from public.reservations where idempotency_key = 'pgtap-key-rollback'),
  0, 'rollback: nenhuma reserva gravada');

-- ----------------------------------------------------------------------------
-- Replay (M2)
-- ----------------------------------------------------------------------------
set local role service_role;
insert into results
  select 'replay_same', booking_id, is_replay from public.create_marketplace_booking(
    'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
    'pgtap-key-new', 'fp-new', 15,
    'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_fixture where name = 'v1_reordered'));
select throws_ok(
  $$select * from public.create_marketplace_booking(
      'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
      'pgtap-key-new', 'fp-new', 15,
      'toursflow-cancelamento', '2026-11-01', (select snapshot from policy_fixture where name = 'v2'))$$,
  'P0001', 'MARKETPLACE_POLICY_CONFLICT',
  'replay com política diferente -> MARKETPLACE_POLICY_CONFLICT (rota: 409)');
select throws_ok(
  $$select * from public.create_marketplace_booking(
      'a0000000-0000-4000-8000-0000000000d1', 3, 30000, 'Maria', 'maria@local.test', null, null,
      'pgtap-key-new', 'fp-outro', 15,
      'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_fixture where name = 'v1'))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT',
  'mesma key com fingerprint diferente continua IDEMPOTENCY_CONFLICT');
-- reserva sem snapshot criada pela assinatura antiga (equivale a reserva pré-0080)
insert into results
  select 'legacy', booking_id, is_replay from public.create_marketplace_booking(
    'a0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Joao', 'joao@local.test', null, null,
    'pgtap-key-legacy', 'fp-legacy', 15);
insert into results
  select 'legacy_replay', booking_id, is_replay from public.create_marketplace_booking(
    'a0000000-0000-4000-8000-0000000000d1', 1, 10000, 'Joao', 'joao@local.test', null, null,
    'pgtap-key-legacy', 'fp-legacy', 15,
    'toursflow-cancelamento', '2026-10-01', (select snapshot from policy_fixture where name = 'v1'));
insert into results
  select 'replay_old_sig', booking_id, is_replay from public.create_marketplace_booking(
    'a0000000-0000-4000-8000-0000000000d1', 2, 20000, 'Maria', 'maria@local.test', null, null,
    'pgtap-key-new', 'fp-new', 15);
reset role;

select ok(
  (select is_replay from results where name = 'replay_same')
  and (select booking_id from results where name = 'replay_same') = (select booking_id from results where name = 'new'),
  'replay com a mesma política (ordem de chaves diferente) devolve a mesma reserva');
select is(
  (select marketplace_policy_version from public.reservations where id = (select booking_id from results where name = 'new')),
  '2026-10-01', 'replay com política diferente não troca o snapshot gravado');
select is(
  (select count(*)::int from public.reservations where idempotency_key = 'pgtap-key-new'),
  1, 'replays não criam reserva duplicada');
select is((select is_replay from results where name = 'legacy'), false,
  'H2: assinatura antiga ainda cria reserva (transição)');
select ok(
  (select is_replay from results where name = 'legacy_replay')
  and (select booking_id from results where name = 'legacy_replay') = (select booking_id from results where name = 'legacy'),
  'M2: replay de reserva sem snapshot devolve a reserva original');
select ok(
  (select marketplace_policy_id is null and marketplace_policy_version is null and marketplace_policy_snapshot is null
     from public.reservations where id = (select booking_id from results where name = 'legacy')),
  'M2: replay nunca grava snapshot depois do fato numa reserva antiga');
select ok(
  (select is_replay from results where name = 'replay_old_sig')
  and (select booking_id from results where name = 'replay_old_sig') = (select booking_id from results where name = 'new'),
  'replay pela assinatura antiga de reserva com snapshot devolve a reserva (rota antiga durante o deploy)');

-- ----------------------------------------------------------------------------
-- Imutabilidade (H1): UPDATE autenticado, NULL -> valor, service_role, INSERT
-- ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

select throws_ok(
  format($$update public.reservations set marketplace_policy_snapshot = %L::jsonb,
            marketplace_policy_version = '2026-11-01' where id = %L$$,
         (select snapshot from policy_fixture where name = 'v2'),
         (select booking_id from results where name = 'new')),
  '42501', 'MARKETPLACE_POLICY_IMMUTABLE',
  'H1: empresa dona não consegue trocar o snapshot via UPDATE');
select throws_ok(
  format($$update public.reservations set marketplace_policy_id = null, marketplace_policy_version = null,
            marketplace_policy_snapshot = null where id = %L$$,
         (select booking_id from results where name = 'new')),
  '42501', 'MARKETPLACE_POLICY_IMMUTABLE',
  'H1: empresa dona não consegue apagar o snapshot');
select throws_ok(
  format($$update public.reservations set marketplace_policy_id = 'toursflow-cancelamento',
            marketplace_policy_version = '2026-10-01', marketplace_policy_snapshot = %L::jsonb where id = %L$$,
         (select snapshot from policy_fixture where name = 'v1'),
         (select booking_id from results where name = 'legacy')),
  '42501', 'MARKETPLACE_POLICY_IMMUTABLE',
  'H1: não dá para forjar política (NULL -> valor) em reserva antiga');
select lives_ok(
  format($$update public.reservations set status = 'confirmada' where id = %L$$,
         (select booking_id from results where name = 'new')),
  'UPDATE de outras colunas da reserva com snapshot continua funcionando');
select throws_ok(
  format($$insert into public.reservations (company_id, departure_id, client_id, people_count, source,
            marketplace_policy_id, marketplace_policy_version, marketplace_policy_snapshot)
          values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000d1',
            (select client_id from public.reservations where id = %L), 1, 'marketplace',
            'toursflow-cancelamento', '2026-10-01', %L::jsonb)$$,
         (select booking_id from results where name = 'new'),
         (select snapshot from policy_fixture where name = 'v1')),
  '42501', 'MARKETPLACE_BOOKING_RPC_REQUIRED',
  'H1: authenticated não insere reserva com snapshot direto (só a RPC grava)');
select throws_ok(
  format($$insert into public.reservations (company_id, departure_id, client_id, people_count, source,
            marketplace_policy_id, marketplace_policy_version, marketplace_policy_snapshot)
          values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000d1',
            (select client_id from public.reservations where id = %L), 1, 'manual',
            'toursflow-cancelamento', '2026-10-01', %L::jsonb)$$,
         (select booking_id from results where name = 'new'),
         (select snapshot from policy_fixture where name = 'v1')),
  '42501', 'MARKETPLACE_POLICY_ONLY_FOR_MARKETPLACE',
  'H1: snapshot só existe em reserva de origem marketplace');

-- outra empresa: RLS esconde a linha, UPDATE não afeta nada
select set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is_empty(
  format($$update public.reservations set marketplace_policy_snapshot = null,
            marketplace_policy_id = null, marketplace_policy_version = null
          where id = %L returning id$$,
         (select booking_id from results where name = 'new')),
  'empresa B não altera (nem enxerga) a reserva da empresa A');
reset role;

-- o Supabase local recente não expõe tabela nova ao service_role; em produção
-- ele tem DML. Concede só nesta transação para provar que é o TRIGGER que barra.
grant select, update on public.reservations to service_role;
set local role service_role;
select throws_ok(
  format($$update public.reservations set marketplace_policy_version = '2026-11-01' where id = %L$$,
         (select booking_id from results where name = 'new')),
  '42501', 'MARKETPLACE_POLICY_IMMUTABLE',
  'H1: nem service_role troca o snapshot');
reset role;

select is(
  (select marketplace_policy_snapshot from public.reservations where id = (select booking_id from results where name = 'new')),
  (select snapshot from policy_fixture where name = 'v1'),
  'snapshot permanece idêntico ao original depois de todas as tentativas');

-- ----------------------------------------------------------------------------
-- Consistência das três colunas (CHECK), mesmo para o dono do banco. Só o
-- dono consegue forjar a marca da RPC (ele pode tudo, inclusive desabilitar
-- trigger) -- aqui ela é usada só pra chegar até o CHECK.
-- ----------------------------------------------------------------------------
select set_config('nauticflow.marketplace_booking_insert', txid_current()::text || ':', true);
select throws_ok(
  format($$insert into public.reservations (company_id, departure_id, client_id, people_count, source,
            marketplace_policy_id, marketplace_policy_version, marketplace_policy_snapshot)
          values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000d1',
            (select client_id from public.reservations where id = %L), 1, 'marketplace',
            'toursflow-cancelamento', null, null)$$,
         (select booking_id from results where name = 'new')),
  '23514', 'new row for relation "reservations" violates check constraint "reservations_marketplace_policy_consistent"',
  'CHECK: só o id preenchido (sem versão/snapshot) é recusado');
select throws_ok(
  format($$insert into public.reservations (company_id, departure_id, client_id, people_count, source,
            marketplace_policy_id, marketplace_policy_version, marketplace_policy_snapshot)
          values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000d1',
            (select client_id from public.reservations where id = %L), 1, 'marketplace',
            'toursflow-cancelamento', '2026-11-01', %L::jsonb)$$,
         (select booking_id from results where name = 'new'),
         (select snapshot from policy_fixture where name = 'v1')),
  '23514', 'new row for relation "reservations" violates check constraint "reservations_marketplace_policy_consistent"',
  'CHECK: versão da coluna divergente da versão do snapshot é recusada');
select set_config('nauticflow.marketplace_booking_insert', '', true);
select ok(
  public.is_valid_marketplace_policy_snapshot('toursflow-cancelamento', '2026-10-01',
    (select snapshot from policy_fixture where name = 'v1'))
  and not public.is_valid_marketplace_policy_snapshot(' toursflow-cancelamento', '2026-10-01',
    (select snapshot from policy_fixture where name = 'v1'))
  and not public.is_valid_marketplace_policy_snapshot('toursflow-cancelamento', '2026-10-01', '[]'::jsonb),
  'validador: aceita o formato canônico, recusa id com espaço e snapshot que não é objeto');
-- forma canônica: o banco exige o mesmo trim da rota (String.prototype.trim)
select ok(
  not public.is_valid_marketplace_policy_snapshot('toursflow-cancelamento', '2026-10-01',
    jsonb_set((select snapshot from policy_fixture where name = 'v1'), '{title}', to_jsonb(' Política de cancelamento'::text))),
  'validador: title com espaço na ponta é recusado');
select ok(
  not public.is_valid_marketplace_policy_snapshot('toursflow-cancelamento', '2026-10-01',
    jsonb_set((select snapshot from policy_fixture where name = 'v1'), '{summary}', to_jsonb(E'Resumo\n'::text))),
  'validador: summary com quebra de linha na ponta é recusado');
select ok(
  not public.is_valid_marketplace_policy_snapshot('toursflow-cancelamento', '2026-10-01',
    jsonb_set((select snapshot from policy_fixture where name = 'v1'), '{terms}', to_jsonb(array[E'\u00a0Termo'::text]))),
  'validador: termo com NBSP na ponta é recusado');
select ok(
  not public.is_valid_marketplace_policy_snapshot(E'toursflow-cancelamento\t', '2026-10-01',
    jsonb_set((select snapshot from policy_fixture where name = 'v1'), '{id}', to_jsonb(E'toursflow-cancelamento\t'::text))),
  'validador: id com tab na ponta é recusado');
select ok(
  public.is_valid_marketplace_policy_snapshot('toursflow-cancelamento', '2026-10-01',
    jsonb_set((select snapshot from policy_fixture where name = 'v1'), '{title}', to_jsonb(repeat('🚤', 200))))
  and not public.is_valid_marketplace_policy_snapshot('toursflow-cancelamento', '2026-10-01',
    jsonb_set((select snapshot from policy_fixture where name = 'v1'), '{title}', to_jsonb(repeat('🚤', 201)))),
  'validador: conta emoji como um caractere (200 aceito, 201 recusado), igual à rota');

select is(
  (select count(*)::int from public.reservations
    where not (
      (marketplace_policy_id is null and marketplace_policy_version is null and marketplace_policy_snapshot is null)
      or (marketplace_policy_id is not null and marketplace_policy_version is not null and marketplace_policy_snapshot is not null))),
  0, 'nenhuma reserva com as três colunas parcialmente preenchidas');

select * from finish();
rollback;
