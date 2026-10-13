-- NAUTICFLOW — SNAPSHOT IMUTÁVEL DA POLÍTICA DO MARKETPLACE NA RESERVA
--
-- O ToursFlow é dono da política pública (cancelamento/reembolso); o
-- NauticFlow é dono da reserva e persiste uma cópia da política que o turista
-- aceitou, recebida só pela chamada server-to-server autenticada
-- (POST /api/marketplace/bookings).
--
-- Achados da revisão (2026-10-13) corrigidos aqui, antes de qualquer aplicação:
--
-- H1 -- imutabilidade de verdade, não só comentário. A policy "reservas da
--   empresa" (0000) deixa o authenticated da empresa fazer UPDATE em
--   qualquer coluna de reservations. Agora:
--   * o snapshot é gravado no PRÓPRIO INSERT da reserva (não num UPDATE
--     posterior) -- por isso o trigger pode recusar QUALQUER mudança das três
--     colunas em UPDATE, pra todo mundo, inclusive NULL -> valor (forjar
--     política numa reserva histórica) e service_role;
--   * no INSERT, anon/authenticated/service_role nunca enviam snapshot direto
--     -- só a RPC (security definer, roda como dono) grava;
--   * CHECK: as três colunas são todas NULL (reserva antiga/fora do
--     marketplace) ou todas preenchidas e coerentes entre si.
--
-- H2 -- deploy sem janela quebrada. A assinatura antiga (10 parâmetros)
--   CONTINUA executável por service_role nesta migration: a única chamadora
--   dela é a rota antiga do próprio NauticFlow (o ToursFlow chama HTTP, nunca
--   a RPC). Entre aplicar esta migration e publicar a rota nova, a rota antiga
--   segue criando reservas sem snapshot -- exatamente o comportamento de hoje,
--   aceito só durante essa transição. A revogação da assinatura antiga fica
--   para uma migration POSTERIOR, depois de confirmar que nenhum deploy ativo
--   ainda a usa (ordem segura em docs/PUBLIC-API-CONTRACT.md, seção 12).
--
-- M2 -- replay de reserva sem snapshot (criada antes desta migration ou pela
--   assinatura antiga) devolve o replay normalmente e o snapshot continua
--   NULL -- nunca grava depois do fato uma política que o turista não viu.
--
-- Revisão adversarial (2026-10-13) -- identidade da reserva do marketplace:
--   source/idempotency_key/request_fingerprint/company_id imutáveis, sem
--   conversão marketplace <-> outro canal, INSERT marketplace só pela RPC e
--   DELETE bloqueado (cancelamento lógico); ver trg_reservation_marketplace_
--   row_guard e trg_reservation_marketplace_delete_guard abaixo.
--
-- Segunda revisão (2026-10-13):
--   * INSERT de reserva marketplace exige marca transacional definida só pelo
--     núcleo da RPC (nauticflow.marketplace_booking_insert), em vez de uma
--     lista de papéis bloqueados -- função SECURITY DEFINER futura que não
--     passe pelo núcleo também é barrada;
--   * snapshot na forma canônica: title/summary/terms/id/version sem espaço
--     nas pontas (mesmo conjunto de String.prototype.trim da rota).
--
-- Corpo da criação idêntico ao de 0078 (lock por Idempotency-Key, fingerprint,
-- company suspensa, TOUR_ARCHIVED com `for share`, DEPARTURE_NOT_SELLABLE,
-- cliente + reserva atômicos), movido pra uma função interna que as duas
-- assinaturas públicas chamam -- nenhuma migration anterior editada.
-- ============================================================================

alter table public.reservations
  add column if not exists marketplace_policy_id text,
  add column if not exists marketplace_policy_version text,
  add column if not exists marketplace_policy_snapshot jsonb;

comment on column public.reservations.marketplace_policy_id is
  'ID estável da política do marketplace aceita no momento da reserva. NULL para reservas antigas ou fora do marketplace. Imutável (trg_reservation_marketplace_policy_guard).';
comment on column public.reservations.marketplace_policy_version is
  'Versão da política do marketplace aceita no momento da reserva. Imutável.';
comment on column public.reservations.marketplace_policy_snapshot is
  'Cópia imutável da política exibida ao turista ({id, version, title, summary, terms}); gravada só no INSERT pela RPC create_marketplace_booking, nunca substituída.';

-- ----------------------------------------------------------------------------
-- Validador único do formato -- usado pelo CHECK e pela RPC. IFs sequenciais
-- (não um OR gigante): SQL não garante ordem de avaliação, e jsonb_array_
-- length/jsonb_array_elements falham em valor que não é array.
-- Executável por todos (padrão do Postgres): o CHECK roda com o privilégio de
-- quem faz o INSERT, inclusive authenticated em reserva manual -- é função
-- pura, sem leitura de tabela.
-- ----------------------------------------------------------------------------
create or replace function public.is_valid_marketplace_policy_snapshot(
  p_id text,
  p_version text,
  p_snapshot jsonb
) returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_term jsonb;
  -- mesmo conjunto de String.prototype.trim (WhiteSpace + LineTerminator do
  -- ECMAScript): a rota apara com trim() e o banco exige exatamente essa forma
  -- -- o mesmo texto nunca chega com bordas diferentes e vira falso
  -- MARKETPLACE_POLICY_CONFLICT no replay.
  v_ws constant text := E' \t\n\u000b\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
begin
  if p_id is null or length(p_id) = 0 or length(p_id) > 100 or p_id <> btrim(p_id, v_ws) then
    return false;
  end if;
  if p_version is null or length(p_version) = 0 or length(p_version) > 50 or p_version <> btrim(p_version, v_ws) then
    return false;
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    return false;
  end if;
  -- só os campos conhecidos -- nada arbitrário vindo de fora vira "política"
  if (p_snapshot - array['id', 'version', 'title', 'summary', 'terms']) <> '{}'::jsonb then
    return false;
  end if;
  if p_snapshot->'id' is distinct from to_jsonb(p_id)
     or p_snapshot->'version' is distinct from to_jsonb(p_version) then
    return false;
  end if;
  if jsonb_typeof(p_snapshot->'title') is distinct from 'string'
     or length(p_snapshot->>'title') = 0
     or p_snapshot->>'title' <> btrim(p_snapshot->>'title', v_ws)
     or length(p_snapshot->>'title') > 200 then
    return false;
  end if;
  if jsonb_typeof(p_snapshot->'summary') is distinct from 'string'
     or length(p_snapshot->>'summary') = 0
     or p_snapshot->>'summary' <> btrim(p_snapshot->>'summary', v_ws)
     or length(p_snapshot->>'summary') > 2000 then
    return false;
  end if;
  if jsonb_typeof(p_snapshot->'terms') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_snapshot->'terms') < 1 or jsonb_array_length(p_snapshot->'terms') > 20 then
    return false;
  end if;
  for v_term in select value from jsonb_array_elements(p_snapshot->'terms') loop
    if jsonb_typeof(v_term) <> 'string'
       or length(v_term #>> '{}') = 0
       or v_term #>> '{}' <> btrim(v_term #>> '{}', v_ws)
       or length(v_term #>> '{}') > 1000 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.reservations
  drop constraint if exists reservations_marketplace_policy_consistent;
alter table public.reservations
  add constraint reservations_marketplace_policy_consistent check (
    (marketplace_policy_id is null
      and marketplace_policy_version is null
      and marketplace_policy_snapshot is null)
    or public.is_valid_marketplace_policy_snapshot(
      marketplace_policy_id, marketplace_policy_version, marketplace_policy_snapshot
    )
  );

-- ----------------------------------------------------------------------------
-- Guarda de imutabilidade (H1). Sem SECURITY DEFINER: current_user é quem
-- executa o statement -- 'authenticated'/'anon'/'service_role' via PostgREST,
-- ou o dono da função dentro da RPC security definer abaixo.
-- Correção de dado real exige SQL direto com o trigger desabilitado,
-- conscientemente -- nunca pela aplicação.
-- ----------------------------------------------------------------------------
create or replace function public.check_reservation_marketplace_policy_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.marketplace_policy_id, new.marketplace_policy_version, new.marketplace_policy_snapshot)
       is distinct from
       (old.marketplace_policy_id, old.marketplace_policy_version, old.marketplace_policy_snapshot) then
      raise exception 'MARKETPLACE_POLICY_IMMUTABLE'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT
  if new.marketplace_policy_snapshot is not null
     or new.marketplace_policy_id is not null
     or new.marketplace_policy_version is not null then
    if new.source is distinct from 'marketplace' then
      raise exception 'MARKETPLACE_POLICY_ONLY_FOR_MARKETPLACE'
        using errcode = '42501';
    end if;
    -- quem pode inserir reserva marketplace (e portanto snapshot) é decidido
    -- pela marca da RPC em trg_reservation_marketplace_row_guard
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reservation_marketplace_policy_guard on public.reservations;
create trigger trg_reservation_marketplace_policy_guard
  before insert or update on public.reservations
  for each row execute function public.check_reservation_marketplace_policy_guard();

revoke all on function public.check_reservation_marketplace_policy_guard() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Identidade da reserva do marketplace (achado da revisão adversarial,
-- 2026-10-13). A mesma policy ampla de 0000 deixava a empresa trocar source
-- (marketplace -> manual), idempotency_key ou request_fingerprint: a linha
-- saía do índice parcial reservations_marketplace_idempotency_key_unique e o
-- replay do ToursFlow com a MESMA key criava uma SEGUNDA reserva/hold/cobrança.
--
-- Congelados quando a linha é (ou passaria a ser) do marketplace: source,
-- idempotency_key, request_fingerprint, company_id -- pra todo mundo,
-- inclusive service_role. Campos operacionais (status, outcome, hold, valores,
-- saída, cliente, origin_name, partner_id...) continuam livres: é por eles que
-- o operador cancela/edita e que a liquidação (0059) e o outcome (0055)
-- escrevem. Nenhuma escrita legítima existente muda essas quatro colunas.
--
-- INSERT com source='marketplace' só pelas RPCs autorizadas -- sem isso a
-- empresa "reservaria" uma Idempotency-Key futura do ToursFlow por fora.
-- Autorização positiva, não lista de papéis: create_marketplace_booking_
-- internal (chamada pelas DUAS assinaturas públicas) grava a marca local
-- nauticflow.marketplace_booking_insert = '<txid>:<idempotency_key>' só em
-- volta do próprio INSERT e limpa logo depois. O trigger exige a marca da
-- transação atual E da mesma key, E current_user = dono do núcleo (só dentro
-- da RPC SECURITY DEFINER). Quem chama pela API não consegue definir GUC
-- nauticflow.* (PostgREST só expõe request.*) e, mesmo com set_config numa
-- sessão SQL, current_user seria o próprio papel -- barrado. Função SECURITY
-- DEFINER futura sem a marca também é barrada. O dono do banco continua
-- podendo tudo (inclusive desabilitar trigger) -- isso não é defesa contra ele.
-- Nome com 'r' > 'p': dispara depois de trg_reservation_marketplace_policy_
-- guard, que continua dando o erro específico do snapshot.
-- ----------------------------------------------------------------------------
create or replace function public.check_reservation_marketplace_row_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'marketplace'
       and (
         current_setting('nauticflow.marketplace_booking_insert', true) is distinct from
           txid_current()::text || ':' || coalesce(new.idempotency_key, '')
         or current_user is distinct from (
           select pg_get_userbyid(p.proowner)::text from pg_proc p
           where p.oid = to_regprocedure(
             'public.create_marketplace_booking_internal(uuid,integer,integer,text,text,text,text,text,text,integer,text,text,jsonb)')
         )
       ) then
      raise exception 'MARKETPLACE_BOOKING_RPC_REQUIRED'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (old.source = 'marketplace' or new.source = 'marketplace')
     and (new.source, new.idempotency_key, new.request_fingerprint, new.company_id)
         is distinct from
         (old.source, old.idempotency_key, old.request_fingerprint, old.company_id) then
    raise exception 'MARKETPLACE_RESERVATION_IDENTITY_IMMUTABLE'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reservation_marketplace_row_guard on public.reservations;
create trigger trg_reservation_marketplace_row_guard
  before insert or update on public.reservations
  for each row execute function public.check_reservation_marketplace_row_guard();

revoke all on function public.check_reservation_marketplace_row_guard() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- DELETE de reserva do marketplace: apagar liberava a Idempotency-Key (replay
-- criava outra reserva), levava payments junto (on delete cascade, 0036) e o
-- snapshot da política. Cancelamento é lógico (status = 'cancelada').
-- Única exceção: a EMPRESA inteira sendo excluída (exclusão de conta/admin) --
-- na cascata a linha de companies já não é visível. SECURITY DEFINER só pra
-- essa checagem não depender da RLS de companies de quem executa.
-- ----------------------------------------------------------------------------
create or replace function public.check_reservation_marketplace_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.source = 'marketplace'
     and exists (select 1 from public.companies where id = old.company_id) then
    raise exception 'MARKETPLACE_RESERVATION_DELETE_FORBIDDEN'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_reservation_marketplace_delete_guard on public.reservations;
create trigger trg_reservation_marketplace_delete_guard
  before delete on public.reservations
  for each row execute function public.check_reservation_marketplace_delete_guard();

revoke all on function public.check_reservation_marketplace_delete_guard() from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Núcleo interno: corpo de 0078 + snapshot no INSERT + comparação no replay.
-- p_marketplace_policy_* NULL = chamada pela assinatura antiga (transição).
-- Nunca executável de fora -- só pelos dois wrappers security definer.
-- ----------------------------------------------------------------------------
create or replace function public.create_marketplace_booking_internal(
  p_departure_id uuid,
  p_quantity int,
  p_total_cents int,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_cpf text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_hold_minutes int,
  p_marketplace_policy_id text,
  p_marketplace_policy_version text,
  p_marketplace_policy_snapshot jsonb
) returns table (
  booking_id uuid,
  hold_expires_at timestamptz,
  people_count int,
  total_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_tour_id uuid;
  v_tour_active boolean;
  v_departure_status text;
  v_sales_enabled boolean;
  v_client_id uuid;
  v_existing record;
  v_new_id uuid;
  v_hold timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('marketplace_booking'), hashtext(p_idempotency_key));

  select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint,
         r.marketplace_policy_snapshot
    into v_existing
    from public.reservations r
    where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    -- replay (M2): reserva já com snapshot exige o MESMO snapshot; reserva
    -- sem snapshot (histórica/assinatura antiga) continua sem -- nada é gravado.
    if p_marketplace_policy_snapshot is not null
       and v_existing.marketplace_policy_snapshot is not null
       and v_existing.marketplace_policy_snapshot is distinct from p_marketplace_policy_snapshot then
      raise exception 'MARKETPLACE_POLICY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
    return;
  end if;

  select company_id, tour_id, status, marketplace_sales_enabled
    into v_company_id, v_tour_id, v_departure_status, v_sales_enabled
    from public.departures where id = p_departure_id;
  if v_company_id is null then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  if exists (select 1 from public.companies where id = v_company_id and suspended_at is not null) then
    raise exception 'COMPANY_NOT_AVAILABLE';
  end if;

  -- defesa em profundidade (0078), `for share` contra archiveTour concorrente
  select active into v_tour_active from public.tours where id = v_tour_id for share;
  if not coalesce(v_tour_active, false) then
    raise exception 'TOUR_ARCHIVED';
  end if;

  -- defesa em profundidade (0063)
  if v_departure_status <> 'agendada' or not v_sales_enabled then
    raise exception 'DEPARTURE_NOT_SELLABLE';
  end if;

  begin
    if p_customer_cpf is not null then
      insert into public.clients (company_id, name, cpf, phone, email)
      values (v_company_id, p_customer_name, p_customer_cpf, p_customer_phone, p_customer_email)
      on conflict (company_id, cpf) do update set cpf = excluded.cpf
      returning id into v_client_id;
    else
      insert into public.clients (company_id, name, phone, email)
      values (v_company_id, p_customer_name, p_customer_phone, p_customer_email)
      returning id into v_client_id;
    end if;

    v_hold := now() + make_interval(mins => p_hold_minutes);

    -- marca transacional (trg_reservation_marketplace_row_guard): vale só
    -- para esta transação e esta key, e é limpa logo depois do INSERT.
    -- Num erro, o rollback do bloco desfaz o set_config junto.
    perform set_config('nauticflow.marketplace_booking_insert',
      txid_current()::text || ':' || p_idempotency_key, true);

    insert into public.reservations (
      company_id, departure_id, client_id, people_count, total_cents,
      status, source, origin_name, created_by, partner_id,
      hold_expires_at, idempotency_key, request_fingerprint,
      marketplace_policy_id, marketplace_policy_version, marketplace_policy_snapshot
    ) values (
      v_company_id, p_departure_id, v_client_id, p_quantity, p_total_cents,
      'pendente', 'marketplace', 'ToursFlow', null, null,
      v_hold, p_idempotency_key, p_request_fingerprint,
      p_marketplace_policy_id, p_marketplace_policy_version, p_marketplace_policy_snapshot
    )
    returning id into v_new_id;

    perform set_config('nauticflow.marketplace_booking_insert', '', true);

    return query select v_new_id, v_hold, p_quantity, p_total_cents, false;
    return;
  exception
    when unique_violation then
      if sqlerrm not like '%reservations_marketplace_idempotency_key_unique%' then
        raise;
      end if;

      select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint,
             r.marketplace_policy_snapshot
        into v_existing
        from public.reservations r
        where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;
      if v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      if p_marketplace_policy_snapshot is not null
         and v_existing.marketplace_policy_snapshot is not null
         and v_existing.marketplace_policy_snapshot is distinct from p_marketplace_policy_snapshot then
        raise exception 'MARKETPLACE_POLICY_CONFLICT';
      end if;

      return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
      return;
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- Assinatura ANTIGA (10 parâmetros) -- mantida durante a transição (H2).
-- Mesmo comportamento de 0078: cria reserva sem snapshot.
-- ----------------------------------------------------------------------------
create or replace function public.create_marketplace_booking(
  p_departure_id uuid,
  p_quantity int,
  p_total_cents int,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_cpf text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_hold_minutes int
) returns table (
  booking_id uuid,
  hold_expires_at timestamptz,
  people_count int,
  total_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select * from public.create_marketplace_booking_internal(
    p_departure_id, p_quantity, p_total_cents, p_customer_name, p_customer_email,
    p_customer_phone, p_customer_cpf, p_idempotency_key, p_request_fingerprint,
    p_hold_minutes, null, null, null
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Assinatura NOVA (13 parâmetros) -- usada pela rota atual. Snapshot
-- obrigatório e validado antes de qualquer escrita.
-- ----------------------------------------------------------------------------
create or replace function public.create_marketplace_booking(
  p_departure_id uuid,
  p_quantity int,
  p_total_cents int,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_cpf text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_hold_minutes int,
  p_marketplace_policy_id text,
  p_marketplace_policy_version text,
  p_marketplace_policy_snapshot jsonb
) returns table (
  booking_id uuid,
  hold_expires_at timestamptz,
  people_count int,
  total_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_valid_marketplace_policy_snapshot(
    p_marketplace_policy_id, p_marketplace_policy_version, p_marketplace_policy_snapshot
  ) then
    raise exception 'INVALID_MARKETPLACE_POLICY_SNAPSHOT';
  end if;

  return query select * from public.create_marketplace_booking_internal(
    p_departure_id, p_quantity, p_total_cents, p_customer_name, p_customer_email,
    p_customer_phone, p_customer_cpf, p_idempotency_key, p_request_fingerprint,
    p_hold_minutes, p_marketplace_policy_id, p_marketplace_policy_version,
    p_marketplace_policy_snapshot
  );
end;
$$;

-- ACL (mesmo achado de 0044: revoke from public sozinho não basta, o Supabase
-- concede EXECUTE direto a anon/authenticated/service_role em função nova).
revoke all on function public.create_marketplace_booking_internal(
  uuid, int, int, text, text, text, text, text, text, int, text, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.create_marketplace_booking(
  uuid, int, int, text, text, text, text, text, text, int
) from public, anon, authenticated;
grant execute on function public.create_marketplace_booking(
  uuid, int, int, text, text, text, text, text, text, int
) to service_role;

revoke all on function public.create_marketplace_booking(
  uuid, int, int, text, text, text, text, text, text, int, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_marketplace_booking(
  uuid, int, int, text, text, text, text, text, text, int, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
