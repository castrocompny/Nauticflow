-- NAUTICFLOW — NF2-001: PASSEIO ARQUIVADO NÃO PODE RECEBER NOVA RESERVA DE BALCÃO
--
-- Causa confirmada pela auditoria funcional (parte 2): nem create_counter_
-- reservation (0072) nem create_flexible_counter_reservation (0073) checam
-- tours.active -- um passeio "excluído" (active=false) continuava aceitando
-- reserva de balcão nova via chamada direta da RPC (mitigado só pelo picker
-- de /reservas filtrar active=true na UI, nunca no backend). Reproduzido em
-- Staging para os dois modelos.
--
-- Nenhuma migration anterior editada (0072/0073/0074 intactas) -- ambas as
-- RPCs redefinidas aqui via `create or replace function`, corpo idêntico ao
-- original + a checagem nova, mesmo padrão já usado neste projeto sempre
-- que uma regra precisa endurecer uma RPC existente sem duplicá-la.
--
-- ============================================================================
-- PARTE 1 — create_counter_reservation (fixed_schedule): agora também
-- carrega tour_id/active da departure e rejeita ANTES de criar cliente
-- rápido ou reservation, com o mesmo código canônico 'TOUR_ARCHIVED' usado
-- na RPC flexible abaixo -- um único texto de erro pras duas Server Actions
-- traduzirem, nunca duas mensagens divergentes pro mesmo conceito.
-- ============================================================================
create or replace function public.create_counter_reservation(
  p_departure_id uuid,
  p_people_count int,
  p_total_cents int,
  p_client_id uuid default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_origin_name text default null
)
returns table (reservation_id uuid, client_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_departure record;
  v_tour_active boolean;
  v_client_id uuid;
  v_reservation_id uuid;
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

  -- saida precisa ser da MESMA empresa e ainda estar em estado reservavel --
  -- validado ANTES de criar cliente nenhum, pra nunca deixar um cliente
  -- orfao no ar se a saida em si ja for invalida.
  select id, company_id, tour_id, status into v_departure
    from public.departures
    where id = p_departure_id;

  if v_departure.id is null or v_departure.company_id <> v_company_id then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;
  if v_departure.status in ('cancelada', 'encerrada') then
    raise exception 'DEPARTURE_NOT_BOOKABLE';
  end if;

  -- NF2-001: passeio arquivado (active=false) nunca aceita reserva nova,
  -- mesmo que a departure em si continue existindo (histórico preservado,
  -- nunca apagado -- só não pode crescer). Checado ANTES de qualquer
  -- criação de cliente/reserva, mesmo espírito de DEPARTURE_NOT_BOOKABLE
  -- acima.
  select active into v_tour_active from public.tours where id = v_departure.tour_id;
  if not coalesce(v_tour_active, false) then
    raise exception 'TOUR_ARCHIVED';
  end if;

  if p_client_id is not null then
    select id into v_client_id from public.clients
      where id = p_client_id and company_id = v_company_id;
    if v_client_id is null then
      raise exception 'CLIENT_NOT_FOUND';
    end if;
  else
    if p_client_name is null or btrim(p_client_name) = '' then
      raise exception 'CLIENT_NAME_REQUIRED';
    end if;
    -- cliente rapido: so nome (obrigatorio) + telefone (opcional) -- CPF/
    -- e-mail/cidade continuam podendo ser completados depois em /clientes
    -- (colunas ja nullable desde 0000, nenhum schema novo necessario aqui).
    insert into public.clients (company_id, name, phone)
      values (v_company_id, btrim(p_client_name), nullif(btrim(coalesce(p_client_phone, '')), ''))
      returning id into v_client_id;
  end if;

  -- nasce 'confirmada' (ocupa vaga real, sem hold -- pedido explicito: balcao
  -- nao cria hold nesta etapa) e source='manual' (== "balcao", ver nota 2
  -- acima). O INSERT abaixo dispara trg_reservation_capacity normalmente --
  -- MESMO gatilho que protege reservas manuais e do ToursFlow hoje, nao
  -- duplicado nem contornado: se a capacidade real (sob lock de linha da
  -- propria departure) ja tiver sido consumida por outra venda concorrente
  -- entre a consulta de vagas exibida na UI e este INSERT, o gatilho recusa
  -- e a transacao INTEIRA (inclusive um cliente rapido recem-criado acima)
  -- eh revertida -- nunca fica cliente orfao, nunca ha overbooking.
  insert into public.reservations (
    company_id, departure_id, client_id, people_count, total_cents,
    status, source, origin_name, created_by
  ) values (
    v_company_id, p_departure_id, v_client_id, p_people_count, p_total_cents,
    'confirmada', 'manual', nullif(btrim(coalesce(p_origin_name, '')), ''), auth.uid()
  )
  returning id into v_reservation_id;

  reservation_id := v_reservation_id;
  client_id := v_client_id;
  return next;
end;
$$;

comment on function public.create_counter_reservation is
  'Reserva de balcão (operador NauticFlow) -- cliente existente OU criação rápida de cliente + reserva confirmada na MESMA transação (atômico: capacidade excedida ou passeio arquivado revertem tudo, nunca deixa cliente órfão). company_id sempre derivado de auth.uid(), nunca recebido do browser. Consome o MESMO estoque (departures.capacity + trg_reservation_capacity) usado por create_marketplace_booking (ToursFlow) -- nenhum estoque paralelo. Recusa TOUR_ARCHIVED (migration 0075) quando o passeio da departure está arquivado (tours.active=false), mesmo que a departure em si ainda exista.';

revoke all on function public.create_counter_reservation(uuid, int, int, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.create_counter_reservation(uuid, int, int, uuid, text, text, text) to authenticated;

-- ============================================================================
-- PARTE 2 — create_flexible_counter_reservation (flexible_private): já
-- carregava o tour (company_id, booking_model) -- só passa a carregar
-- também `active` e rejeitar ANTES de criar quick client/departure/
-- reservation. Corpo idêntico ao de 0073 fora dessa checagem nova.
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
  v_tour_active boolean;
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

  select company_id, booking_model, active into v_tour_company_id, v_booking_model, v_tour_active
    from public.tours where id = p_tour_id;
  if v_tour_company_id is null or v_tour_company_id <> v_company_id then
    raise exception 'TOUR_NOT_FOUND';
  end if;
  if v_booking_model <> 'flexible_private' then
    raise exception 'TOUR_NOT_FLEXIBLE';
  end if;
  -- NF2-001: passeio arquivado nunca aceita reserva nova -- checado ANTES
  -- de ler a regra de disponibilidade, criar quick client, departure ou
  -- reservation. Uma regra flexível ainda `active=true` de um passeio
  -- arquivado (estado que a migration 0075 também corrige de raiz, ver
  -- archiveTour) nunca chega a ser usada pra vender de novo.
  if not coalesce(v_tour_active, false) then
    raise exception 'TOUR_ARCHIVED';
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
  'Reserva de balcão para passeio flexible_private -- cria a departure (nunca pré-gerada) e a reservation confirmada na MESMA transação atômica. Overlap de embarcação validado sob advisory lock contra QUALQUER departure ativa (fixa ou privativa); exclusividade da reserva e capacidade real da embarcação validadas pelo MESMO gatilho compartilhado (check_departure_capacity) usado por fixed_schedule e ToursFlow. Recusa TOUR_ARCHIVED (migration 0075) quando o passeio está arquivado (tours.active=false), mesmo que a regra de disponibilidade ainda esteja active=true.';
