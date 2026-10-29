-- Migration 0090 -- captura durável de conflitos de transferência (TRANSFER_*).
-- Testado só no laboratório offline (ver supabase/tests/README.md). Fixtures
-- fictícias; tudo revertido no fim, inclusive a limpeza do estado prévio das
-- três tabelas novas e a política local de capacidade.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(60);

-- estado prévio do laboratório (ex.: cenários concorrentes commitados) fora desta transação
delete from public.marketplace_transfer_conflicts;
delete from public.marketplace_transfer_conflict_windows;
delete from public.marketplace_transfer_conflict_policy;

insert into public.companies (id, name) values
  ('f9000000-0000-4000-8000-0000000000c1', 'pgTAP 0090 A (ficticia)'),
  ('f9000000-0000-4000-8000-0000000000c2', 'pgTAP 0090 B (ficticia)');
insert into public.marketplace_withdrawals (id, company_id, amount_cents, status, provider_transfer_id) values
  ('f9000000-0000-4000-8000-0000000000a1', 'f9000000-0000-4000-8000-0000000000c1', 1000, 'pending', null),
  ('f9000000-0000-4000-8000-0000000000a2', 'f9000000-0000-4000-8000-0000000000c2', 2000, 'completed', 'tr_cc_dup'),
  ('f9000000-0000-4000-8000-0000000000a3', 'f9000000-0000-4000-8000-0000000000c1', 3000, 'processing', 'tr_cc_dup'),
  ('f9000000-0000-4000-8000-0000000000a4', 'f9000000-0000-4000-8000-0000000000c2', 4000, 'processing', 'tr_cc_solo'),
  ('f9000000-0000-4000-8000-0000000000a5', 'f9000000-0000-4000-8000-0000000000c1', 5000, 'processing', 'tr cc bad');
insert into auth.users (id, email, aud, role) values
  ('f9000000-0000-4000-8000-0000000000e1', 'pgtap-0090-super@local.test', 'authenticated', 'authenticated'),
  ('f9000000-0000-4000-8000-0000000000e2', 'pgtap-0090-admin@local.test', 'authenticated', 'authenticated');
insert into public.profiles (id, company_id, role) values
  ('f9000000-0000-4000-8000-0000000000e1', null, 'super_admin'),
  ('f9000000-0000-4000-8000-0000000000e2', 'f9000000-0000-4000-8000-0000000000c1', 'company_admin')
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role;

-- resultados das chamadas feitas sob service_role (a fila em si ele não lê)
create temp table r (label text primary key, outcome text, conflict_id uuid, n int);
grant select, insert on r to service_role;
-- impressão digital do que é financeiro, antes de qualquer captura
create temp table fp as select
  (select md5(string_agg(to_jsonb(w)::text, ',' order by w.id)) from public.marketplace_withdrawals w) as fw,
  (select md5(coalesce(string_agg(to_jsonb(l)::text, ',' order by l.id), '')) from public.marketplace_ledger_entries l) as fl,
  (select md5(coalesce(string_agg(to_jsonb(e)::text, ',' order by e.provider, e.event_key), '')) from public.processed_webhook_events e) as fe;

-- ---------------------------------------------------------------------------
-- estrutura e ACL declarada
-- ---------------------------------------------------------------------------
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.marketplace_transfer_conflicts'::regclass,
  'public.marketplace_transfer_conflict_policy'::regclass, 'public.marketplace_transfer_conflict_windows'::regclass)),
  'RLS ligada nas três tabelas novas');
select is((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'marketplace_transfer_conflicts'),
  (select array_agg(c order by c) from unnest(array['id', 'reason', 'event_type', 'event_key', 'event_key_class',
        'notification_id', 'notification_id_class', 'provider_transfer_id', 'provider_transfer_id_class', 'reference_class',
        'referenced_withdrawal_id', 'fee_class', 'fee_cents', 'first_observed_at', 'local_link_state',
        'local_withdrawal_ids', 'local_company_ids', 'local_withdrawal_statuses', 'local_link_bases',
        'occurrence_count', 'last_observed_at']) c),
  'colunas: campos normalizados + fotografia local; nenhum payload, referência bruta ou dado bancário');
select ok((select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig = array['search_path=""']
  from pg_proc p where p.oid = 'public.record_marketplace_transfer_conflict(text,text,text,text,text,text,uuid,text,integer)'::regprocedure),
  'RPC: SECURITY DEFINER, owner postgres, search_path vazio');
select ok(not has_function_privilege('anon', 'public.record_marketplace_transfer_conflict(text,text,text,text,text,text,uuid,text,integer)', 'execute'),
  'ACL: anon sem EXECUTE');
select ok(not has_function_privilege('authenticated', 'public.record_marketplace_transfer_conflict(text,text,text,text,text,text,uuid,text,integer)', 'execute'),
  'ACL: authenticated sem EXECUTE');
select ok(has_function_privilege('service_role', 'public.record_marketplace_transfer_conflict(text,text,text,text,text,text,uuid,text,integer)', 'execute'),
  'ACL: service_role com EXECUTE');

-- ---------------------------------------------------------------------------
-- política operacional (nenhuma vem da migration)
-- ---------------------------------------------------------------------------
set local role service_role;
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('terminal_outcome_conflict', 'TRANSFER_FAILED',
  'evt_cc_none', 'evt_cc_none', 'tr_cc_none', 'absent', null, 'absent', null) $$,
  'CONFLICT_CAPTURE_POLICY_MISSING', 'sem política: recusa explícita');
reset role;
select throws_ok($$ insert into public.marketplace_transfer_conflict_policy (capacity, window_seconds) values (0, 3600) $$,
  '23514', NULL, 'política: capacidade 0 recusada');
select throws_ok($$ insert into public.marketplace_transfer_conflict_policy (capacity, window_seconds) values (5, 0) $$,
  '23514', NULL, 'política: janela 0 recusada');
insert into public.marketplace_transfer_conflict_policy (capacity, window_seconds) values (6, 3600);
select throws_ok($$ insert into public.marketplace_transfer_conflict_policy (capacity, window_seconds) values (9, 60) $$,
  '23505', NULL, 'política: uma única linha');

-- ---------------------------------------------------------------------------
-- entrada inválida (antes de qualquer gravação)
-- ---------------------------------------------------------------------------
set local role service_role;
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('outro', 'TRANSFER_DONE',
  'evt_x', null, 'tr_x', 'absent', null, 'absent', null) $$, 'CONFLICT_CAPTURE_INVALID_INPUT', 'motivo desconhecido');
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('event_key_conflict', 'PAYMENT_RECEIVED',
  'evt_x', null, 'tr_x', 'absent', null, 'absent', null) $$, 'CONFLICT_CAPTURE_INVALID_INPUT', 'evento fora de TRANSFER_*');
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_x', null, 'tr_x', 'uuid', null, 'absent', null) $$, 'CONFLICT_CAPTURE_INVALID_INPUT', 'classe uuid sem UUID');
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_x', null, 'tr_x', 'invalid', 'f9000000-0000-4000-8000-0000000000a1', 'absent', null) $$, 'CONFLICT_CAPTURE_INVALID_INPUT', 'classe invalid com UUID');
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_x', null, 'tr_x', 'absent', null, 'valid', -1) $$, 'CONFLICT_CAPTURE_INVALID_INPUT', 'taxa válida negativa');
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_x', null, 'tr_x', 'absent', null, 'invalid', 150) $$, 'CONFLICT_CAPTURE_INVALID_INPUT', 'taxa inválida com valor');

-- ---------------------------------------------------------------------------
-- registro novo, rollback e agrupamento
-- ---------------------------------------------------------------------------
insert into r select 'a_none', * from public.record_marketplace_transfer_conflict('terminal_outcome_conflict', 'TRANSFER_FAILED',
  'evt_cc_none', 'evt_cc_none', 'tr_cc_none', 'absent', null, 'absent', null);
select results_eq($$ select outcome, n from r where label = 'a_none' $$, $$ values ('recorded'::text, 1) $$,
  'registro novo: recorded, contador 1');

savepoint sp_rb;
insert into r select 'z_rb', * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_cc_rb', 'evt_cc_rb', 'tr_cc_rb', 'absent', null, 'absent', null);
rollback to savepoint sp_rb;
reset role;
select is((select count(*)::int from public.marketplace_transfer_conflicts where event_key = 'evt_cc_rb'), 0,
  'rollback do chamador desfaz o registro');
select is((select sum(used)::int from public.marketplace_transfer_conflict_windows), 1,
  'rollback do chamador devolve a vaga');

set local role service_role;
insert into r select 'b_single', * from public.record_marketplace_transfer_conflict('transfer_identity_unproven', 'TRANSFER_DONE',
  'TRANSFER_DONE:tr_cc_x', null, 'tr_cc_x', 'uuid', 'f9000000-0000-4000-8000-0000000000a1', 'valid', 150);
insert into r select 'c_multi', * from public.record_marketplace_transfer_conflict('provider_transfer_id_mismatch', 'TRANSFER_PENDING',
  'evt_cc_multi', 'evt_cc_multi', 'tr_cc_dup', 'uuid', 'f9000000-0000-4000-8000-0000000000a1', 'absent', null);
insert into r select 'd_transfer_only', * from public.record_marketplace_transfer_conflict('reference_mismatch', 'TRANSFER_CREATED',
  null, null, 'tr_cc_dup', 'absent', null, 'absent', null);
insert into r select 'e_solo', * from public.record_marketplace_transfer_conflict('reference_mismatch', 'TRANSFER_BLOCKED',
  null, null, 'tr_cc_solo', 'invalid', null, 'absent', null);
insert into r select 'f_fee_invalid', * from public.record_marketplace_transfer_conflict('terminal_outcome_conflict', 'TRANSFER_FAILED',
  'evt_cc_none', 'evt_cc_none', 'tr_cc_none', 'absent', null, 'invalid', null);
select results_eq($$ select label, outcome, n from r order by label $$,
  $$ values ('a_none'::text, 'recorded'::text, 1), ('b_single', 'recorded', 1), ('c_multi', 'recorded', 1),
            ('d_transfer_only', 'recorded', 1), ('e_solo', 'recorded', 1), ('f_fee_invalid', 'recorded', 1) $$,
  'seis grupos distintos gravados (taxa ausente x inválida não se agrupam)');
select is((select count(distinct conflict_id)::int from r), 6, 'cada grupo tem ID próprio');

-- capacidade cheia (6/6): grupo novo recusado, repetição aceita sem nova vaga
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('withdrawal_not_found', 'TRANSFER_DONE',
  'evt_cc_over', 'evt_cc_over', 'tr_cc_over', 'uuid', 'f9000000-0000-4000-8000-0000000000ff', 'absent', null) $$,
  'CONFLICT_CAPTURE_CAPACITY_EXCEEDED', 'capacidade esgotada: grupo novo recusado');
insert into r select 'g_repeat_none', * from public.record_marketplace_transfer_conflict('terminal_outcome_conflict', 'TRANSFER_FAILED',
  'evt_cc_none', 'evt_cc_none', 'tr_cc_none', 'absent', null, 'absent', null);
select results_eq($$ select outcome, n, conflict_id = (select conflict_id from r where label = 'a_none') from r where label = 'g_repeat_none' $$,
  $$ values ('repeated'::text, 2, true) $$, 'repetição com capacidade cheia: repeated, mesmo ID, contador 2');

reset role;
select is((select sum(used)::int from public.marketplace_transfer_conflict_windows), 6,
  'vagas: só os seis grupos novos (repetição e recusas não consomem)');
select is((select count(*)::int from public.marketplace_transfer_conflicts), 6, 'recusa por capacidade não grava nada');

-- fotografia local da primeira observação (derivada do banco)
select results_eq($$ select local_link_state, local_withdrawal_ids, local_company_ids, local_withdrawal_statuses, local_link_bases
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'a_none') $$,
  $$ values ('none'::text, '{}'::uuid[], '{}'::uuid[], '{}'::text[], '{}'::text[]) $$, 'sem vínculo local');
select results_eq($$ select local_link_state, local_withdrawal_ids, local_company_ids, local_withdrawal_statuses, local_link_bases
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'b_single') $$,
  $$ values ('single'::text, '{f9000000-0000-4000-8000-0000000000a1}'::uuid[], '{f9000000-0000-4000-8000-0000000000c1}'::uuid[],
             '{pending}'::text[], '{reference}'::text[]) $$, 'um vínculo, pela referência');
select results_eq($$ select local_link_state, local_withdrawal_ids, local_company_ids, local_withdrawal_statuses, local_link_bases
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'c_multi') $$,
  $$ values ('multiple'::text,
    '{f9000000-0000-4000-8000-0000000000a1,f9000000-0000-4000-8000-0000000000a2,f9000000-0000-4000-8000-0000000000a3}'::uuid[],
    '{f9000000-0000-4000-8000-0000000000c1,f9000000-0000-4000-8000-0000000000c2,f9000000-0000-4000-8000-0000000000c1}'::uuid[],
    '{pending,completed,processing}'::text[], '{reference,transfer,transfer}'::text[]) $$,
  'múltiplos vínculos, todos registrados, nenhum escolhido');
select results_eq($$ select local_link_state, local_withdrawal_ids, local_link_bases
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'd_transfer_only') $$,
  $$ values ('multiple'::text, '{f9000000-0000-4000-8000-0000000000a2,f9000000-0000-4000-8000-0000000000a3}'::uuid[],
    '{transfer,transfer}'::text[]) $$, 'vínculos só pela transferência');
select results_eq($$ select local_link_state, local_withdrawal_ids, local_link_bases, reference_class, referenced_withdrawal_id
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'e_solo') $$,
  $$ values ('single'::text, '{f9000000-0000-4000-8000-0000000000a4}'::uuid[], '{transfer}'::text[], 'invalid'::text, null::uuid) $$,
  'referência inválida: só a classe é guardada; vínculo pela transferência');
select results_eq($$ select reason, event_type, event_key, event_key_class, notification_id, notification_id_class,
  provider_transfer_id, provider_transfer_id_class, reference_class, referenced_withdrawal_id, fee_class, fee_cents
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'b_single') $$,
  $$ values ('transfer_identity_unproven'::text, 'TRANSFER_DONE'::text, 'TRANSFER_DONE:tr_cc_x'::text, 'accepted'::text,
    null::text, 'absent'::text, 'tr_cc_x'::text, 'accepted'::text,
    'uuid'::text, 'f9000000-0000-4000-8000-0000000000a1'::uuid, 'valid'::text, 150) $$,
  'campos normalizados preservados; identificador aceito guardado exatamente');
select results_eq($$ select fee_class, fee_cents from public.marketplace_transfer_conflicts
  where id in (select conflict_id from r where label in ('a_none', 'f_fee_invalid')) order by fee_class $$,
  $$ values ('absent'::text, null::int), ('invalid', null) $$, 'taxa ausente e inválida: classe distinta, sem conteúdo');
select ok((select occurrence_count = 2 and last_observed_at > first_observed_at from public.marketplace_transfer_conflicts
  where id = (select conflict_id from r where label = 'a_none')), 'repetição atualiza só contador e última observação');

-- nenhum efeito financeiro
select ok((select fp.fw = (select md5(string_agg(to_jsonb(w)::text, ',' order by w.id)) from public.marketplace_withdrawals w) from fp),
  'saques intactos');
select ok((select fp.fl = (select md5(coalesce(string_agg(to_jsonb(l)::text, ',' order by l.id), '')) from public.marketplace_ledger_entries l) from fp),
  'ledger intacto');
select ok((select fp.fe = (select md5(coalesce(string_agg(to_jsonb(e)::text, ',' order by e.provider, e.event_key), '')) from public.processed_webhook_events e) from fp),
  'processed_webhook_events intacta');

-- fotografia imutável: o saque muda, a repetição não reescreve a primeira observação
update public.marketplace_withdrawals set status = 'processing' where id = 'f9000000-0000-4000-8000-0000000000a1';
set local role service_role;
insert into r select 'h_repeat_single', * from public.record_marketplace_transfer_conflict('transfer_identity_unproven', 'TRANSFER_DONE',
  'TRANSFER_DONE:tr_cc_x', null, 'tr_cc_x', 'uuid', 'f9000000-0000-4000-8000-0000000000a1', 'valid', 150);
reset role;
select results_eq($$ select outcome, n from r where label = 'h_repeat_single' $$, $$ values ('repeated'::text, 2) $$,
  'repetição depois da mudança do saque');
select is((select local_withdrawal_statuses from public.marketplace_transfer_conflicts
  where id = (select conflict_id from r where label = 'b_single')), '{pending}'::text[],
  'fotografia continua a da primeira observação');

-- ---------------------------------------------------------------------------
-- identificadores: ausente / aceito / inválido / excessivo (só a classe sem conteúdo)
-- ---------------------------------------------------------------------------
update public.marketplace_transfer_conflict_policy set capacity = 20;
set local role service_role;
insert into r select 'i_invalid', * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt bad/1', 'evt bad/1', 'tr_cc_cls', 'absent', null, 'absent', null);
insert into r select 'j_invalid_other', * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_other bad!', 'pix chave@x.com', 'tr_cc_cls', 'absent', null, 'absent', null);
insert into r select 'k_excessive', * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  repeat('a', 257), null, 'tr_cc_cls', 'absent', null, 'absent', null);
insert into r select 'l_empty', * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  '', null, 'tr_cc_cls', 'absent', null, 'absent', null);
insert into r select 'm_tr_invalid', * from public.record_marketplace_transfer_conflict('reference_mismatch', 'TRANSFER_PENDING',
  null, null, 'tr cc bad', 'absent', null, 'absent', null);
insert into r select 'n_tr_absent', * from public.record_marketplace_transfer_conflict('reference_mismatch', 'TRANSFER_PENDING',
  null, null, null, 'absent', null, 'absent', null);
reset role;
select results_eq($$ select label, outcome, n, conflict_id = (select conflict_id from r where label = 'i_invalid') from r
  where label in ('i_invalid', 'j_invalid_other', 'k_excessive', 'l_empty', 'm_tr_invalid', 'n_tr_absent') order by label $$,
  $$ values ('i_invalid'::text, 'recorded'::text, 1, true), ('j_invalid_other', 'repeated', 2, true), ('k_excessive', 'recorded', 1, false),
            ('l_empty', 'recorded', 1, false), ('m_tr_invalid', 'recorded', 1, false), ('n_tr_absent', 'recorded', 1, false) $$,
  'identificador fora do formato não recusa a captura; inválidos diferentes caem no mesmo grupo');
select results_eq($$ select event_key, event_key_class, notification_id, notification_id_class, provider_transfer_id, provider_transfer_id_class
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'i_invalid') $$,
  $$ values (null::text, 'invalid'::text, null::text, 'invalid'::text, 'tr_cc_cls'::text, 'accepted'::text) $$,
  'inválido: só a classe; aceito no mesmo registro guardado exatamente');
select results_eq($$ select event_key, event_key_class, notification_id_class
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'k_excessive') $$,
  $$ values (null::text, 'excessive'::text, 'absent'::text) $$, 'acima de 256: classe excessive, sem conteúdo');
select results_eq($$ select event_key, event_key_class
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'l_empty') $$,
  $$ values (null::text, 'invalid'::text) $$, 'vazio é presente e inválido, não ausente');
select results_eq($$ select provider_transfer_id, provider_transfer_id_class, local_link_state, local_withdrawal_ids, local_link_bases
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'm_tr_invalid') $$,
  $$ values (null::text, 'invalid'::text, 'single'::text, '{f9000000-0000-4000-8000-0000000000a5}'::uuid[], '{transfer}'::text[]) $$,
  'transfer id inválido: vínculo derivado do banco, valor não guardado');
select results_eq($$ select provider_transfer_id_class, local_link_state
  from public.marketplace_transfer_conflicts where id = (select conflict_id from r where label = 'n_tr_absent') $$,
  $$ values ('absent'::text, 'none'::text) $$, 'ausente e inválido não se agrupam');
select is((select count(*)::int from public.marketplace_transfer_conflicts c
  where to_jsonb(c)::text like '%bad%' or to_jsonb(c)::text like '%chave@%' or to_jsonb(c)::text like '%aaaaaaaaaaaaaaaa%'), 0,
  'nenhum conteúdo inválido/excessivo gravado');

-- ---------------------------------------------------------------------------
-- acesso efetivo por papel e aal
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from public.marketplace_transfer_conflicts $$, '42501', NULL, 'anon: SELECT negado');
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_x', null, 'tr_x', 'absent', null, 'absent', null) $$, '42501', NULL, 'anon: RPC negada');
reset role;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"f9000000-0000-4000-8000-0000000000e2","role":"authenticated","aal":"aal2"}', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.marketplace_transfer_conflicts), 0, 'authenticated não super_admin (aal2): zero linhas');
select throws_ok($$ insert into public.marketplace_transfer_conflicts (reason) values ('event_key_conflict') $$, '42501', NULL,
  'authenticated: INSERT negado');
select throws_ok($$ select count(*) from public.marketplace_transfer_conflict_policy $$, '42501', NULL, 'authenticated: política ilegível');
select throws_ok($$ select count(*) from public.marketplace_transfer_conflict_windows $$, '42501', NULL, 'authenticated: janelas ilegíveis');
select throws_ok($$ select * from public.record_marketplace_transfer_conflict('event_key_conflict', 'TRANSFER_DONE',
  'evt_x', null, 'tr_x', 'absent', null, 'absent', null) $$, '42501', NULL, 'authenticated: RPC negada');
reset role;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"f9000000-0000-4000-8000-0000000000e1","role":"authenticated","aal":"aal1"}', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.marketplace_transfer_conflicts), 0, 'super_admin com aal1: zero linhas');
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"f9000000-0000-4000-8000-0000000000e1","role":"authenticated","aal":"aal2"}', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.marketplace_transfer_conflicts), 11, 'super_admin com aal2: lê a fila');
select throws_ok($$ update public.marketplace_transfer_conflicts set occurrence_count = 99 $$, '42501', NULL, 'super_admin aal2: UPDATE negado');
reset role;
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;

set local role service_role;
select throws_ok($$ select count(*) from public.marketplace_transfer_conflicts $$, '42501', NULL, 'service_role: SELECT direto negado');
select throws_ok($$ insert into public.marketplace_transfer_conflicts (reason) values ('event_key_conflict') $$, '42501', NULL,
  'service_role: INSERT direto negado (só a RPC grava)');
select throws_ok($$ select count(*) from public.marketplace_transfer_conflict_policy $$, '42501', NULL, 'service_role: política ilegível');
select throws_ok($$ update public.marketplace_transfer_conflict_policy set capacity = 1000 $$, '42501', NULL, 'service_role: política não alterável');
select throws_ok($$ select count(*) from public.marketplace_transfer_conflict_windows $$, '42501', NULL, 'service_role: janelas ilegíveis');
reset role;

select * from finish();
rollback;
