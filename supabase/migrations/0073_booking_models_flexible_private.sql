-- NAUTICFLOW — MODELOS DE RESERVA: HORÁRIO FIXO + PRIVATIVO FLEXÍVEL
--
-- Inspeção prévia (antes de escrever qualquer schema novo, pedido explícito):
-- confirmado lendo 0014/0039/0040/0063-0068/0072 que HOJE não existe nenhuma
-- primitive de "modelo operacional" -- category é comercial (0039),
-- price_type é forma de precificar (0039/0040), nenhum dos dois decide COMO
-- a reserva funciona. booking_model é um conceito novo e genuíno, não uma
-- duplicata de nada existente.
--
-- ============================================================================
-- PARTE 1 — booking_model em tours (fixed_schedule é o default -- nenhum
-- passeio existente muda de comportamento)
-- ============================================================================

alter table public.tours
  add column if not exists booking_model text not null default 'fixed_schedule'
    check (booking_model in ('fixed_schedule', 'flexible_private'));

comment on column public.tours.booking_model is
  'Regra OPERACIONAL de como a reserva funciona -- distinta de category (comercial) e price_type (forma de precificar). fixed_schedule = comportamento de sempre (agenda recorrente, departures compartilhadas, capacidade por passageiro). flexible_private = cliente escolhe início/fim, embarcação fica exclusiva (ver tour_flexible_booking_rules).';

-- ============================================================================
-- PARTE 2 — ends_at em departures (nullable -- compatibilidade com dados
-- antigos). Obrigatório nas NOVAS departures do fluxo privativo (aplicado em
-- create_flexible_counter_reservation, não como NOT NULL na coluna -- isso
-- quebraria toda departure fixa histórica).
-- ============================================================================

alter table public.departures
  add column if not exists ends_at timestamptz;

alter table public.departures
  add constraint departures_ends_at_after_start check (ends_at is null or ends_at > departs_at);

comment on column public.departures.ends_at is
  'Término real da saída. NULL em departures fixas antigas (sem duração conhecida) -- nunca inventado. Obrigatório nas novas departures criadas por create_flexible_counter_reservation (privativo flexível). Para fixas com tours.duration_minutes, o backfill desta migration preenche quando possível.';

-- Backfill seguro (pedido explícito, seção 9): só quando ends_at é NULL e o
-- tour tem duration_minutes > 0 -- nunca inventa duração. O número de linhas
-- afetadas foi medido em Staging ANTES de aplicar (ver DOCUMENTACAO.md).
update public.departures d
set ends_at = d.departs_at + (t.duration_minutes || ' minutes')::interval
from public.tours t
where t.id = d.tour_id
  and d.ends_at is null
  and t.duration_minutes is not null
  and t.duration_minutes > 0;

-- ============================================================================
-- PARTE 3 — remover a janela global 08:00-19:00 (pedido explícito, seção 5):
-- era uma regra HISTÓRICA de negócio (não uma trava de segurança), errada
-- como regra global -- um passeio de horário fixo pode ocorrer às 05:30, às
-- 22:00 etc. Mantém-se SÓ "não pode ser no passado". Horário permitido passa
-- a ser decidido pelo modelo/regra de cada passeio (fixed: livre; flexible:
-- window_start/window_end da própria regra), nunca mais um número fixo do
-- NauticFlow inteiro.
-- ============================================================================

create or replace function public.check_departure_schedule()
returns trigger
language plpgsql
as $$
begin
  if new.departs_at < now() then
    raise exception 'Não é possível criar uma saída em um horário que já passou.';
  end if;
  return new;
end;
$$;

-- Mesma correção na regra recorrente (fixed_schedule): dias/horários
-- duplicados continuam recusados, só a janela 08:00-19:00 sai.
create or replace function public.check_tour_schedule_rule_days_times()
returns trigger
language plpgsql
as $$
begin
  if cardinality(new.days_of_week) <> cardinality(array(select distinct d from unnest(new.days_of_week) d)) then
    raise exception 'Dias da semana duplicados.';
  end if;
  if cardinality(new.times) <> cardinality(array(select distinct t from unnest(new.times) t)) then
    raise exception 'Horários duplicados.';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- PARTE 4 — tour_schedule_rules pertence só a fixed_schedule (pedido
-- explícito, seção 24 -- backend recusa, não só a UI escondida).
-- ============================================================================

create or replace function public.check_tour_schedule_rule_fk_company()
returns trigger
language plpgsql
as $$
declare
  v_vessel_company uuid;
  v_tour_company uuid;
  v_booking_model text;
begin
  select company_id into v_vessel_company from public.vessels where id = new.vessel_id;
  if v_vessel_company is null or v_vessel_company <> new.company_id then
    raise exception 'Embarcação inválida para esta empresa.';
  end if;

  select company_id, booking_model into v_tour_company, v_booking_model from public.tours where id = new.tour_id;
  if v_tour_company is null or v_tour_company <> new.company_id then
    raise exception 'Passeio inválido para esta empresa.';
  end if;
  if v_booking_model <> 'fixed_schedule' then
    raise exception 'TOUR_NOT_FIXED_SCHEDULE';
  end if;

  return new;
end;
$$;

-- ============================================================================
-- PARTE 5 — troca de booking_model não pode apagar/reconciliar estado
-- silenciosamente (pedido explícito, seção 23) -- bloqueia nos dois sentidos
-- se houver saída futura não cancelada, ou agenda/regra ativa do modelo que
-- está saindo. Dados históricos nunca são tocados/apagados por este gatilho
-- -- ele só BLOQUEIA a troca, nunca limpa nada sozinho.
-- ============================================================================

create or replace function public.check_tour_booking_model_transition()
returns trigger
language plpgsql
as $$
declare
  v_future_departures int;
begin
  if new.booking_model = old.booking_model then
    return new;
  end if;

  select count(*) into v_future_departures
    from public.departures
    where tour_id = new.id and status <> 'cancelada' and departs_at > now();
  if v_future_departures > 0 then
    raise exception 'BOOKING_MODEL_HAS_FUTURE_DEPARTURES';
  end if;

  if old.booking_model = 'fixed_schedule' and exists (
    select 1 from public.tour_schedule_rules where tour_id = new.id and active = true
  ) then
    raise exception 'BOOKING_MODEL_HAS_ACTIVE_SCHEDULE_RULE';
  end if;

  if old.booking_model = 'flexible_private' and exists (
    select 1 from public.tour_flexible_booking_rules where tour_id = new.id and active = true
  ) then
    raise exception 'BOOKING_MODEL_HAS_ACTIVE_FLEXIBLE_RULE';
  end if;

  return new;
end;
$$;

revoke all on function public.check_tour_booking_model_transition() from public, anon, authenticated, service_role;

create trigger trg_tour_booking_model_transition
  before update of booking_model on public.tours
  for each row execute function public.check_tour_booking_model_transition();

-- ============================================================================
-- PARTE 6 — tour_flexible_booking_rules (uma regra por passeio, mesmo
-- espírito de tour_schedule_rules).
-- ============================================================================

create table public.tour_flexible_booking_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  tour_id uuid not null references public.tours (id) on delete cascade,
  vessel_id uuid not null references public.vessels (id) on delete restrict,
  -- 0=domingo..6=sábado, mesma convenção de tour_schedule_rules/extract(dow)
  days_of_week smallint[] not null,
  window_start time not null,
  window_end time not null,
  min_duration_minutes int not null,
  max_duration_minutes int not null,
  -- conjunto inicial suportado (pedido explícito) -- mesmo padrão já usado
  -- em tour_schedule_rules.horizon_days (check ... in (30,60,90)): a
  -- primitive já nasce restrita ao conjunto realmente suportado, não uma
  -- checagem genérica ">0" que a UI teria que promessa sozinha.
  slot_interval_minutes int not null default 30 check (slot_interval_minutes in (15, 30, 60)),
  pricing_mode text not null default 'fixed' check (pricing_mode in ('fixed', 'per_hour')),
  hourly_price_cents int check (hourly_price_cents is null or hourly_price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tour_flexible_booking_rules_one_per_tour unique (tour_id),
  constraint tour_flexible_booking_rules_days_not_empty check (cardinality(days_of_week) > 0),
  -- duplicata de dias verificada em TRIGGER, não aqui: Postgres rejeita
  -- sub-select (array(select ...)) dentro da expressão de um CHECK
  -- constraint de tabela -- mesmo achado já documentado em 0063 pra
  -- tour_schedule_rules (ver check_flexible_booking_rule_days() abaixo).
  constraint tour_flexible_booking_rules_days_valid check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint tour_flexible_booking_rules_window_check check (window_end > window_start),
  constraint tour_flexible_booking_rules_min_duration_check check (min_duration_minutes > 0),
  constraint tour_flexible_booking_rules_max_duration_check check (max_duration_minutes >= min_duration_minutes),
  constraint tour_flexible_booking_rules_hourly_price_required check (
    pricing_mode <> 'per_hour' or hourly_price_cents is not null
  )
);

create index on public.tour_flexible_booking_rules (company_id);
create index on public.tour_flexible_booking_rules (vessel_id);

alter table public.tour_flexible_booking_rules enable row level security;

-- Mesmo idioma de RLS de tour_schedule_rules -- nenhuma variação nova.
create policy "disponibilidade privativa da empresa" on public.tour_flexible_booking_rules
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Mesmo padrão de tour_schedule_rules (0063, hardening): só leitura direta
-- pra authenticated -- escrita exclusivamente via save_flexible_booking_rule/
-- set_flexible_booking_rule_active (abaixo, SECURITY DEFINER).
grant select on public.tour_flexible_booking_rules to authenticated;

create or replace function public.check_flexible_booking_rule_fk_company()
returns trigger
language plpgsql
as $$
declare
  v_vessel_company uuid;
  v_tour_company uuid;
  v_booking_model text;
begin
  select company_id into v_vessel_company from public.vessels where id = new.vessel_id;
  if v_vessel_company is null or v_vessel_company <> new.company_id then
    raise exception 'Embarcação inválida para esta empresa.';
  end if;

  select company_id, booking_model into v_tour_company, v_booking_model from public.tours where id = new.tour_id;
  if v_tour_company is null or v_tour_company <> new.company_id then
    raise exception 'Passeio inválido para esta empresa.';
  end if;
  if v_booking_model <> 'flexible_private' then
    raise exception 'TOUR_NOT_FLEXIBLE';
  end if;

  return new;
end;
$$;

revoke all on function public.check_flexible_booking_rule_fk_company() from public, anon, authenticated, service_role;

create trigger trg_flexible_booking_rule_fk_company
  before insert or update of company_id, vessel_id, tour_id on public.tour_flexible_booking_rules
  for each row execute function public.check_flexible_booking_rule_fk_company();

-- Sub-select é permitido dentro do CORPO de uma função PL/pgSQL (a restrição
-- do Postgres é só sobre a expressão de um CHECK constraint em si) -- mesmo
-- motivo de check_tour_schedule_rule_days_times (0063) existir como trigger.
create or replace function public.check_flexible_booking_rule_days()
returns trigger
language plpgsql
as $$
begin
  if cardinality(new.days_of_week) <> cardinality(array(select distinct d from unnest(new.days_of_week) d)) then
    raise exception 'Dias da semana duplicados.';
  end if;
  return new;
end;
$$;

revoke all on function public.check_flexible_booking_rule_days() from public, anon, authenticated, service_role;

create trigger trg_flexible_booking_rule_days
  before insert or update of days_of_week on public.tour_flexible_booking_rules
  for each row execute function public.check_flexible_booking_rule_days();

create or replace function public.touch_tour_flexible_booking_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_tour_flexible_booking_rules_updated_at() from public, anon, authenticated, service_role;

create trigger trg_tour_flexible_booking_rules_updated_at
  before update on public.tour_flexible_booking_rules
  for each row execute function public.touch_tour_flexible_booking_rules_updated_at();

-- ============================================================================
-- PARTE 7 — reserva privativa é exclusiva (pedido explícito, seção 18):
-- estendendo o MESMO gatilho compartilhado de capacidade (nunca duplicado,
-- nunca contornado) -- fixed_schedule continua exatamente como sempre foi.
-- ============================================================================

create or replace function public.check_departure_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity int;
  v_booking_model text;
  v_booked int;
  v_active_count int;
  v_new_consumes boolean;
begin
  v_new_consumes := new.status = 'confirmada'
    or (new.status = 'pendente' and new.hold_expires_at is not null and new.hold_expires_at > now());

  if not v_new_consumes then
    return new;
  end if;

  -- trava a saida ate o fim da transacao: serializa reservas/holds concorrentes
  -- pela ULTIMA vaga (mesmo mecanismo da 0003, agora cobrindo tambem o hold)
  perform 1 from public.departures where id = new.departure_id for update;

  select d.capacity, t.booking_model into v_capacity, v_booking_model
    from public.departures d
    join public.tours t on t.id = d.tour_id
    where d.id = new.departure_id;

  -- privativo flexível: só UMA reserva ativa por departure -- não basta
  -- people_count < capacity (isso deixaria outro cliente entrar na mesma
  -- lancha privativa). Prepara também pro futuro hold do marketplace, que
  -- deve ser igualmente exclusivo quando o ToursFlow ganhar suporte a este
  -- modelo (ainda não integrado nesta etapa).
  if v_booking_model = 'flexible_private' then
    select count(*) into v_active_count
      from public.reservations
      where departure_id = new.departure_id
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (
          status = 'confirmada'
          or (status = 'pendente' and hold_expires_at is not null and hold_expires_at > now())
        );
    if v_active_count > 0 then
      raise exception 'Esta saída privativa já possui uma reserva ativa.';
    end if;
  end if;

  select coalesce(sum(people_count), 0) into v_booked
    from public.reservations
    where departure_id = new.departure_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and (
        status = 'confirmada'
        or (status = 'pendente' and hold_expires_at is not null and hold_expires_at > now())
      );

  if v_booked + new.people_count > v_capacity then
    raise exception 'Capacidade excedida: % vaga(s) disponível(is), % solicitada(s).',
      greatest(v_capacity - v_booked, 0), new.people_count;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- PARTE 8 — validate_tour_for_publishing: enquanto o ToursFlow não suporta
-- flexible_private (pedido explícito, seção 29), passeio nesse modelo nunca
-- passa na validação de publicação -- defesa em profundidade no MESMO lugar
-- que já bloqueia qualquer outra tentativa de publicar via API direta,
-- ignorando a UI. Corpo integral reproduzido de 0044 (nenhuma checagem
-- existente removida), só a nova checagem adicionada logo no início, junto
-- das outras condições estruturais (suspensão/inatividade).
-- ============================================================================

create or replace function public.validate_tour_for_publishing(p_tour_id uuid)
returns table (code text, field text, message text, severity text)
language plpgsql
stable
as $$
declare
  v_tour record;
  v_cover record;
  v_content_violation text;
  v_approved_photo_count int;
  v_future_departure_count int;
  v_duplicate_count int;
begin
  select t.*, c.suspended_at as company_suspended_at
    into v_tour
    from public.tours t
    join public.companies c on c.id = t.company_id
    where t.id = p_tour_id;

  if not found then
    return query select 'TOUR_NOT_FOUND'::text, null::text, 'Passeio não encontrado.'::text, 'error'::text;
    return;
  end if;

  if v_tour.marketplace_suspended_at is not null then
    return query select 'ADMIN_SUSPENDED', null::text, 'Este passeio está com a publicação suspensa pelo administrador.', 'error';
  end if;
  if v_tour.company_suspended_at is not null then
    return query select 'COMPANY_SUSPENDED', null::text, 'A conta do operador está suspensa.', 'error';
  end if;
  if not v_tour.active then
    return query select 'TOUR_INACTIVE', null::text, 'Este passeio está inativo.', 'error';
  end if;

  -- NOVO (esta migration): ToursFlow ainda não sabe vender/exibir
  -- disponibilidade de horário flexível/privativo -- nunca deixar publicar
  -- incorretamente até o marketplace ganhar suporte oficial.
  if v_tour.booking_model = 'flexible_private' then
    return query select 'FLEXIBLE_PRIVATE_NOT_SUPPORTED', null::text,
      'Passeios com horário flexível ainda não estão habilitados para publicação no ToursFlow.', 'error';
  end if;

  if v_tour.name is null or btrim(v_tour.name) = '' then
    return query select 'MISSING_TITLE', 'name', 'Informe o título do passeio.', 'error';
  elsif length(btrim(v_tour.name)) < 5 then
    return query select 'TITLE_TOO_SHORT', 'name', 'O título é muito curto.', 'error';
  elsif length(v_tour.name) > 120 then
    return query select 'TITLE_TOO_LONG', 'name', 'O título é muito longo.', 'error';
  end if;

  if v_tour.short_description is null or btrim(v_tour.short_description) = '' then
    return query select 'MISSING_SHORT_DESCRIPTION', 'short_description', 'Informe a descrição curta.', 'error';
  end if;

  if v_tour.description is null or length(btrim(v_tour.description)) < 40 then
    return query select 'DESCRIPTION_TOO_SHORT', 'description', 'A descrição completa precisa ter pelo menos 40 caracteres.', 'error';
  end if;

  if v_tour.destination is null or btrim(v_tour.destination) = '' then
    return query select 'MISSING_DESTINATION', 'destination', 'Informe o destino.', 'error';
  end if;

  if v_tour.category is null then
    return query select 'MISSING_CATEGORY', 'category', 'Selecione a categoria.', 'error';
  end if;

  if v_tour.duration_minutes is null or v_tour.duration_minutes <= 0 then
    return query select 'MISSING_DURATION', 'duration_minutes', 'Informe a duração do passeio.', 'error';
  end if;

  if v_tour.price_type is null then
    return query select 'MISSING_PRICE_TYPE', 'price_type', 'Selecione o tipo de preço.', 'error';
  end if;

  if v_tour.boarding_name is null or btrim(v_tour.boarding_name) = ''
     or v_tour.boarding_address is null or btrim(v_tour.boarding_address) = ''
     or v_tour.boarding_city is null or btrim(v_tour.boarding_city) = '' then
    return query select 'MISSING_BOARDING_INFO', 'boarding', 'Preencha o local de embarque (nome, endereço e cidade).', 'error';
  end if;

  if v_tour.boarding_latitude is not null and (v_tour.boarding_latitude < -90 or v_tour.boarding_latitude > 90) then
    return query select 'INVALID_LATITUDE', 'boarding_latitude', 'Latitude inválida.', 'error';
  end if;
  if v_tour.boarding_longitude is not null and (v_tour.boarding_longitude < -180 or v_tour.boarding_longitude > 180) then
    return query select 'INVALID_LONGITUDE', 'boarding_longitude', 'Longitude inválida.', 'error';
  end if;

  v_content_violation := public.check_tour_public_content_violation(
    v_tour.name, v_tour.description, v_tour.short_description, v_tour.itinerary,
    v_tour.included, v_tour.not_included, v_tour.important_information,
    v_tour.boarding_instructions, v_tour.boarding_reference
  );
  if v_content_violation is not null then
    return query select
      v_content_violation,
      case when v_content_violation = 'EXTERNAL_CONTACT_IN_TITLE' then 'name' else 'description' end,
      case v_content_violation
        when 'EXTERNAL_CONTACT_IN_TITLE' then 'Remova informações de contato ou links externos do título.'
        when 'EXTERNAL_LINK_IN_DESCRIPTION' then 'Remova links externos da descrição.'
        when 'EMAIL_IN_DESCRIPTION' then 'Remova o e-mail da descrição.'
        when 'WHATSAPP_IN_DESCRIPTION' then 'Remova menções a WhatsApp da descrição.'
        when 'SOCIAL_MEDIA_IN_DESCRIPTION' then 'Remova menções a redes sociais externas da descrição.'
        when 'PIX_IN_DESCRIPTION' then 'Remova menções a PIX da descrição.'
        when 'DIRECT_BOOKING_BYPASS' then 'Remova convites para reservar fora do ToursFlow.'
        when 'PHONE_IN_DESCRIPTION' then 'Remova telefones da descrição.'
        else 'Revise o conteúdo do passeio.'
      end,
      'error';
  end if;

  select count(*) into v_approved_photo_count
    from public.tour_photos
    where tour_id = p_tour_id and moderation_status in ('approved', 'legacy_approved', 'manual_approved');
  if v_approved_photo_count = 0 then
    return query select 'NO_APPROVED_PHOTO', 'photos', 'Adicione pelo menos uma foto aprovada.', 'error';
  end if;

  select * into v_cover from public.tour_photos where tour_id = p_tour_id and is_cover = true limit 1;
  if not found then
    return query select 'NO_COVER_PHOTO', 'photos', 'Defina uma foto de capa.', 'error';
  else
    if v_cover.moderation_status = 'rejected' then
      return query select 'COVER_PHOTO_REJECTED', 'photos', 'Esta imagem não atende às regras de publicação. Remova ou substitua a imagem para continuar.', 'error';
    elsif v_cover.moderation_status = 'pending' then
      return query select 'COVER_PHOTO_PENDING', 'photos', 'Uma imagem ainda está sendo verificada. Tente novamente em alguns minutos.', 'error';
    elsif v_cover.moderation_status = 'moderation_unavailable' then
      return query select 'COVER_PHOTO_MODERATION_UNAVAILABLE', 'photos', 'Não foi possível verificar esta imagem agora. Tente novamente em alguns minutos.', 'error';
    elsif v_cover.width is not null and v_cover.height is not null and (v_cover.width < 800 or v_cover.height < 600) then
      return query select 'LOW_RESOLUTION_COVER', 'photos', 'A foto de capa está com resolução abaixo do mínimo recomendado (800x600).', 'error';
    end if;
  end if;

  select count(*) into v_future_departure_count
    from public.departures
    where tour_id = p_tour_id and status <> 'cancelada' and departs_at > now();
  if v_future_departure_count = 0 then
    return query select 'NO_FUTURE_DEPARTURES', 'departures', 'Este passeio ainda não tem nenhuma saída futura cadastrada.', 'warning';
  end if;

  select count(*) into v_duplicate_count
    from public.tours t2
    where t2.company_id = v_tour.company_id
      and t2.id <> p_tour_id
      and lower(btrim(t2.name)) = lower(btrim(v_tour.name))
      and t2.destination is not distinct from v_tour.destination
      and t2.category is not distinct from v_tour.category;
  if v_duplicate_count > 0 then
    return query select 'POSSIBLE_DUPLICATE_TOUR', null::text, 'Já existe outro passeio muito parecido nesta empresa.', 'warning';
  end if;

  return;
end;
$$;

-- ============================================================================
-- PARTE 9 — RPCs autenticadas do privativo flexível (mesmo padrão de
-- save_recurring_schedule/create_counter_reservation: company_id sempre
-- derivado de auth.uid(), nunca do browser).
-- ============================================================================

create or replace function public.save_flexible_booking_rule(
  p_tour_id uuid,
  p_vessel_id uuid,
  p_days_of_week smallint[],
  p_window_start time,
  p_window_end time,
  p_min_duration_minutes int,
  p_max_duration_minutes int,
  p_slot_interval_minutes int,
  p_pricing_mode text,
  p_hourly_price_cents int
) returns table (rule_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_booking_model text;
  v_rule_id uuid;
begin
  select company_id into v_company_id from public.profiles where id = auth.uid();
  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;

  select booking_model into v_booking_model from public.tours where id = p_tour_id and company_id = v_company_id;
  if v_booking_model is null then
    raise exception 'TOUR_NOT_FOUND';
  end if;
  if v_booking_model <> 'flexible_private' then
    raise exception 'TOUR_NOT_FLEXIBLE';
  end if;

  if not exists (select 1 from public.vessels where id = p_vessel_id and company_id = v_company_id) then
    raise exception 'VESSEL_NOT_FOUND';
  end if;

  insert into public.tour_flexible_booking_rules (
    company_id, tour_id, vessel_id, days_of_week, window_start, window_end,
    min_duration_minutes, max_duration_minutes, slot_interval_minutes,
    pricing_mode, hourly_price_cents, active
  ) values (
    v_company_id, p_tour_id, p_vessel_id, p_days_of_week, p_window_start, p_window_end,
    p_min_duration_minutes, p_max_duration_minutes, p_slot_interval_minutes,
    p_pricing_mode, p_hourly_price_cents, true
  )
  on conflict (tour_id) do update set
    vessel_id = excluded.vessel_id,
    days_of_week = excluded.days_of_week,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    min_duration_minutes = excluded.min_duration_minutes,
    max_duration_minutes = excluded.max_duration_minutes,
    slot_interval_minutes = excluded.slot_interval_minutes,
    pricing_mode = excluded.pricing_mode,
    hourly_price_cents = excluded.hourly_price_cents,
    active = true
  returning id into v_rule_id;

  rule_id := v_rule_id;
  return next;
end;
$$;

revoke all on function public.save_flexible_booking_rule(uuid, uuid, smallint[], time, time, int, int, int, text, int) from public, anon, service_role;
grant execute on function public.save_flexible_booking_rule(uuid, uuid, smallint[], time, time, int, int, int, text, int) to authenticated;

create or replace function public.set_flexible_booking_rule_active(p_tour_id uuid, p_active boolean)
returns table (rule_id uuid, active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_rule_id uuid;
begin
  select company_id into v_company_id from public.profiles where id = auth.uid();
  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;

  update public.tour_flexible_booking_rules
    set active = p_active
    where tour_id = p_tour_id and company_id = v_company_id
    returning id into v_rule_id;

  if v_rule_id is null then
    raise exception 'FLEXIBLE_RULE_NOT_FOUND';
  end if;

  rule_id := v_rule_id;
  active := p_active;
  return next;
end;
$$;

revoke all on function public.set_flexible_booking_rule_active(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_flexible_booking_rule_active(uuid, boolean) to authenticated;

-- ============================================================================
-- PARTE 10 — create_flexible_counter_reservation: RPC atômica do balcão pra
-- flexible_private. Cria a DEPARTURE (nunca pré-gerada -- pedido explícito,
-- seção 15) + a RESERVATION confirmada na MESMA transação. Qualquer falha
-- (overlap, capacidade, validação) reverte tudo -- nunca cliente órfão,
-- nunca departure órfã.
-- ============================================================================

create or replace function public.create_flexible_counter_reservation(
  p_tour_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_people_count int,
  p_total_cents int,
  p_client_id uuid default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_origin_name text default null
) returns table (reservation_id uuid, departure_id uuid, client_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_tour_company_id uuid;
  v_booking_model text;
  v_rule record;
  v_client_id uuid;
  v_departure_id uuid;
  v_reservation_id uuid;
  v_local_start time;
  v_local_dow int;
  v_start_minutes int;
  v_duration_minutes numeric;
  v_overlap_count int;
begin
  select company_id into v_company_id from public.profiles where id = auth.uid();
  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;

  if p_people_count is null or p_people_count < 1 then
    raise exception 'INVALID_PEOPLE_COUNT';
  end if;
  if p_total_cents is null or p_total_cents < 0 then
    raise exception 'INVALID_TOTAL_CENTS';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_PERIOD';
  end if;
  if p_starts_at < now() then
    raise exception 'PERIOD_IN_PAST';
  end if;

  select company_id, booking_model into v_tour_company_id, v_booking_model
    from public.tours where id = p_tour_id;
  if v_tour_company_id is null or v_tour_company_id <> v_company_id then
    raise exception 'TOUR_NOT_FOUND';
  end if;
  if v_booking_model <> 'flexible_private' then
    raise exception 'TOUR_NOT_FLEXIBLE';
  end if;

  select * into v_rule from public.tour_flexible_booking_rules
    where tour_id = p_tour_id and active = true;
  if v_rule.id is null then
    raise exception 'FLEXIBLE_RULE_NOT_FOUND';
  end if;

  -- dia da semana permitido (0=domingo..6=sabado, mesma convencao de
  -- tour_schedule_rules/extract(dow))
  v_local_dow := extract(dow from (p_starts_at at time zone 'America/Sao_Paulo'));
  if not (v_local_dow = any(v_rule.days_of_week)) then
    raise exception 'DAY_NOT_ALLOWED';
  end if;

  v_local_start := (p_starts_at at time zone 'America/Sao_Paulo')::time;
  if v_local_start < v_rule.window_start then
    raise exception 'START_BEFORE_WINDOW';
  end if;

  -- fim precisa caber na janela do MESMO dia civil do inicio -- nenhuma
  -- janela cruza a virada do dia nesta etapa, entao um fim em outro dia
  -- civil (ou depois de window_end) sempre excede a janela.
  if (p_ends_at at time zone 'America/Sao_Paulo')::date <> (p_starts_at at time zone 'America/Sao_Paulo')::date
     or (p_ends_at at time zone 'America/Sao_Paulo')::time > v_rule.window_end then
    raise exception 'END_AFTER_WINDOW';
  end if;

  v_duration_minutes := extract(epoch from (p_ends_at - p_starts_at)) / 60;
  if v_duration_minutes < v_rule.min_duration_minutes then
    raise exception 'DURATION_TOO_SHORT';
  end if;
  if v_duration_minutes > v_rule.max_duration_minutes then
    raise exception 'DURATION_TOO_LONG';
  end if;

  v_start_minutes := extract(hour from v_local_start)::int * 60 + extract(minute from v_local_start)::int;
  if v_start_minutes % v_rule.slot_interval_minutes <> 0 then
    raise exception 'INVALID_SLOT';
  end if;

  if p_client_id is not null then
    select id into v_client_id from public.clients where id = p_client_id and company_id = v_company_id;
    if v_client_id is null then
      raise exception 'CLIENT_NOT_FOUND';
    end if;
  else
    if p_client_name is null or btrim(p_client_name) = '' then
      raise exception 'CLIENT_NAME_REQUIRED';
    end if;
  end if;

  -- lock por embarcacao (mesmo padrao de pg_advisory_xact_lock ja usado em
  -- create_marketplace_booking, 0042/0063) -- serializa tentativas
  -- concorrentes pra MESMA embarcacao dentro da transacao, liberado
  -- automaticamente no commit/rollback.
  perform pg_advisory_xact_lock(hashtext('vessel_schedule'), hashtext(v_rule.vessel_id::text));

  -- overlap contra QUALQUER departure ativa (fixa ou privativa) da MESMA
  -- embarcacao -- semantica [inicio, fim): terminar as 14:00 e comecar outra
  -- as 14:00 e permitido (>, nao >=). Fixa com ends_at conhecido usa esse
  -- valor; sem ends_at mas com tour.duration_minutes, infere o termino;
  -- sem NENHUMA forma confiavel de saber o termino, trata como ocupada ate
  -- o fim do dia civil em Brasilia -- NUNCA finge que esta livre quando o
  -- termino real e desconhecido (pedido explicito, secao 12).
  select count(*) into v_overlap_count
    from public.departures d
    join public.tours t2 on t2.id = d.tour_id
    where d.vessel_id = v_rule.vessel_id
      and d.status <> 'cancelada'
      and coalesce(
        d.ends_at,
        case when t2.duration_minutes is not null and t2.duration_minutes > 0
          then d.departs_at + (t2.duration_minutes || ' minutes')::interval
          else null
        end,
        (date_trunc('day', d.departs_at at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo'
      ) > p_starts_at
      and d.departs_at < p_ends_at;

  if v_overlap_count > 0 then
    raise exception 'VESSEL_OVERLAP';
  end if;

  if p_client_id is null then
    insert into public.clients (company_id, name, phone)
      values (v_company_id, btrim(p_client_name), nullif(btrim(coalesce(p_client_phone, '')), ''))
      returning id into v_client_id;
  end if;

  -- capacity NULL: trg_departure_capacity (0000/0003) preenche sozinha com a
  -- capacidade comercial da embarcacao -- MESMA autoridade de sempre, nunca
  -- uma capacidade artificial derivada de people_count (pedido explicito,
  -- secao 19).
  insert into public.departures (company_id, vessel_id, tour_id, departs_at, ends_at, status)
    values (v_company_id, v_rule.vessel_id, p_tour_id, p_starts_at, p_ends_at, 'agendada')
    returning id into v_departure_id;

  -- dispara trg_reservation_capacity (check_departure_capacity, PARTE 7
  -- acima) -- exclusividade (flexible_private) e capacidade real da
  -- embarcacao validadas ali, MESMO gatilho compartilhado com o balcao
  -- fixed_schedule e (no futuro) o ToursFlow -- nunca duplicado aqui.
  insert into public.reservations (
    company_id, departure_id, client_id, people_count, total_cents,
    status, source, origin_name, created_by
  ) values (
    v_company_id, v_departure_id, v_client_id, p_people_count, p_total_cents,
    'confirmada', 'manual', nullif(btrim(coalesce(p_origin_name, '')), ''), auth.uid()
  )
  returning id into v_reservation_id;

  reservation_id := v_reservation_id;
  departure_id := v_departure_id;
  client_id := v_client_id;
  return next;
end;
$$;

revoke all on function public.create_flexible_counter_reservation(uuid, timestamptz, timestamptz, int, int, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.create_flexible_counter_reservation(uuid, timestamptz, timestamptz, int, int, uuid, text, text, text) to authenticated;

comment on function public.create_flexible_counter_reservation is
  'Reserva de balcão para passeio flexible_private -- cria a departure (nunca pré-gerada) e a reservation confirmada na MESMA transação atômica. Overlap de embarcação validado sob advisory lock contra QUALQUER departure ativa (fixa ou privativa); exclusividade da reserva e capacidade real da embarcação validadas pelo MESMO gatilho compartilhado (check_departure_capacity) usado por fixed_schedule e ToursFlow.';
