-- ============================================================================
-- SIMPLIFICAÇÃO DO FLUXO DO OPERADOR -- agenda recorrente automatiza a
-- criação de `departures`, sem alterar `departures` como unidade real
-- vendável nem a autoridade de preço/capacidade/reserva (marketplace
-- continua lendo `departures.price_cents`/`departures.capacity`, exatamente
-- como antes -- ver src/app/api/marketplace/bookings/route.ts, inalterado).
--
-- `tour_schedule_rules` é SÓ o modo "Recorrente" (dias da semana + horários +
-- horizonte). O modo "Datas específicas" não precisa de tabela nova -- é
-- só a criação direta de uma `departure` avulsa (mesmo caminho que já existe
-- em src/app/(app)/saidas/actions.ts), exposta na própria página do passeio.
-- ============================================================================

create table public.tour_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  tour_id uuid not null references public.tours (id) on delete cascade,
  vessel_id uuid not null references public.vessels (id) on delete restrict,
  -- 0=domingo .. 6=sábado, mesma convenção de extract(dow from timestamp) do
  -- Postgres -- evita reinventar/reconverter em outro lugar.
  days_of_week smallint[] not null,
  -- horário local (São Paulo, sem tz) -- convertido pra UTC só no momento da
  -- geração/reconciliação, sempre via `AT TIME ZONE '-03:00'` (offset fixo),
  -- NUNCA `AT TIME ZONE 'America/Sao_Paulo'`. Decisão deliberada, avaliada e
  -- descartada em hardening: o resto do projeto (saoPauloToUTC(),
  -- src/lib/format.ts, usado por "Datas específicas"/createDeparture) já usa
  -- o offset fixo -03:00 -- os dois são numericamente idênticos HOJE (Brasil
  -- aboliu horário de verão em 2019), mas trocar só o lado SQL pro nome de
  -- zona introduziria uma DIVERGÊNCIA real entre os dois modos se o horário
  -- de verão algum dia voltar (já aconteceu antes no Brasil). Manter o
  -- mesmo offset fixo dos dois lados é estritamente mais seguro do que
  -- "modernizar" só um -- ver teste explícito de conversão na suíte desta
  -- migration (2026-09-20 10:00 local -> 2026-09-20T13:00:00Z).
  times time[] not null,
  horizon_days int not null default 90 check (horizon_days in (30, 60, 90)),
  capacity_override int check (capacity_override is null or capacity_override > 0),
  price_cents_override int check (price_cents_override is null or price_cents_override >= 0),
  auto_extend boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tour_schedule_rules_days_not_empty check (cardinality(days_of_week) > 0),
  -- CORRIGIDO em hardening: a versão anterior usava `check (not exists
  -- (select ... from unnest(...)))` -- Postgres REJEITA sub-selects dentro de
  -- CHECK constraint (não é uma limitação de estilo, é uma regra do banco --
  -- essa migration nunca teria conseguido nem ser aplicada). `<@` (contido
  -- por) é um operador de array puro, sem sub-select, válido em CHECK --
  -- expressa exatamente "todo elemento de days_of_week está em 0..6".
  constraint tour_schedule_rules_days_valid check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint tour_schedule_rules_times_not_empty check (cardinality(times) > 0),
  -- só UMA regra recorrente por passeio (modelo simples: "quando esse
  -- passeio acontece", não uma lista de agendas nomeadas) -- garantia de
  -- BANCO, não SELECT-before-INSERT (que teria uma corrida real entre duas
  -- chamadas concorrentes). O server action agora faz upsert nesse unique.
  constraint tour_schedule_rules_one_per_tour unique (tour_id)
);

create index on public.tour_schedule_rules (company_id);

alter table public.tour_schedule_rules enable row level security;

-- Mesmo idioma de RLS de tours/departures/vessels (company_id = current_company_id()),
-- ver 0000_init_schema.sql -- nenhuma variação nova.
create policy "agenda do passeio da empresa" on public.tour_schedule_rules
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

grant select, insert, update, delete on public.tour_schedule_rules to authenticated;

-- Mesmo padrão de check_departure_fk_company (0019) -- nunca confia em
-- vessel_id/tour_id vindos do formulário sem confirmar que pertencem à
-- MESMA company da regra (proteção contra IDOR cross-company).
create or replace function public.check_tour_schedule_rule_fk_company()
returns trigger
language plpgsql
as $$
declare
  v_vessel_company uuid;
  v_tour_company uuid;
begin
  select company_id into v_vessel_company from public.vessels where id = new.vessel_id;
  if v_vessel_company is null or v_vessel_company <> new.company_id then
    raise exception 'Embarcação inválida para esta empresa.';
  end if;

  select company_id into v_tour_company from public.tours where id = new.tour_id;
  if v_tour_company is null or v_tour_company <> new.company_id then
    raise exception 'Passeio inválido para esta empresa.';
  end if;

  return new;
end;
$$;

-- Trigger function -- só invocada pelo mecanismo de trigger (referencia
-- NEW/OLD, chamada direta fora de um trigger simplesmente erra), mas
-- revogada explicitamente mesmo assim (achado de hardening: Supabase
-- concede EXECUTE em função nova pra anon/authenticated/service_role por
-- padrão, independente de "revoke ... from public" sozinho -- mesmo
-- achado já documentado em 0044 pra create_marketplace_booking). Custa
-- nada, remove qualquer dependência do comportamento padrão.
revoke all on function public.check_tour_schedule_rule_fk_company() from public, anon, authenticated, service_role;

create trigger trg_tour_schedule_rule_fk_company
  before insert or update of company_id, vessel_id, tour_id on public.tour_schedule_rules
  for each row execute function public.check_tour_schedule_rule_fk_company();

-- "não depender só de validação TypeScript" -- duplicatas e janela de
-- horário (08:00-19:00, mesma janela já usada por createDeparture,
-- saidas/actions.ts) validadas de novo aqui, no banco. Sub-selects/`array()`
-- SÃO permitidos dentro do CORPO de uma função PL/pgSQL (a restrição do
-- Postgres é só sobre a expressão de um CHECK constraint em si) -- por isso
-- isso vira trigger, não um CHECK.
create or replace function public.check_tour_schedule_rule_days_times()
returns trigger
language plpgsql
as $$
declare
  v_time time;
begin
  if cardinality(new.days_of_week) <> cardinality(array(select distinct d from unnest(new.days_of_week) d)) then
    raise exception 'Dias da semana duplicados.';
  end if;
  if cardinality(new.times) <> cardinality(array(select distinct t from unnest(new.times) t)) then
    raise exception 'Horários duplicados.';
  end if;

  foreach v_time in array new.times loop
    if v_time < time '08:00' or v_time > time '19:00' then
      raise exception 'O horário de saída deve ser entre 08:00 e 19:00.';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.check_tour_schedule_rule_days_times() from public, anon, authenticated, service_role;

create trigger trg_tour_schedule_rule_days_times
  before insert or update of days_of_week, times on public.tour_schedule_rules
  for each row execute function public.check_tour_schedule_rule_days_times();

-- Mesma regra de set_departure_capacity (0000): a capacidade nunca pode
-- passar da capacidade comercial da embarcação. Aqui validado no SAVE da
-- regra (erro amigável imediato), não só na geração -- evita o operador
-- salvar uma agenda que nunca vai conseguir gerar saída nenhuma.
create or replace function public.check_tour_schedule_rule_capacity()
returns trigger
language plpgsql
as $$
declare
  v_commercial_capacity int;
begin
  if new.capacity_override is null then
    return new;
  end if;

  select commercial_capacity into v_commercial_capacity from public.vessels where id = new.vessel_id;
  if v_commercial_capacity is not null and new.capacity_override > v_commercial_capacity then
    raise exception 'A capacidade informada excede a capacidade comercial da embarcação (%).', v_commercial_capacity;
  end if;

  return new;
end;
$$;

revoke all on function public.check_tour_schedule_rule_capacity() from public, anon, authenticated, service_role;

create trigger trg_tour_schedule_rule_capacity
  before insert or update of capacity_override, vessel_id on public.tour_schedule_rules
  for each row execute function public.check_tour_schedule_rule_capacity();

-- mesmo padrão nomeado de touch_payments_updated_at (0036) -- genérico, mas
-- uma função por tabela pra manter o nome autoexplicativo nos logs/erros.
create or replace function public.touch_tour_schedule_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_tour_schedule_rules_updated_at() from public, anon, authenticated, service_role;

create trigger trg_tour_schedule_rules_updated_at
  before update on public.tour_schedule_rules
  for each row execute function public.touch_tour_schedule_rules_updated_at();

-- Rastreia de qual regra uma departure veio -- nullable (departures manuais
-- continuam sem isso, sempre válidas, NUNCA tocadas por reconciliação
-- automática). Usado pra idempotência da geração (junto com o unique de
-- vessel_id/departs_at que já existe desde 0000) e pra reconcile_departures_
-- for_schedule_rule saber quais departures pertencem a qual regra -- essa
-- reconciliação PODE remover uma departure automática (nunca uma manual),
-- mas só quando ela não tem reserva/hold relevante, ver função abaixo.
alter table public.departures
  add column if not exists schedule_rule_id uuid references public.tour_schedule_rules (id) on delete set null;

create index on public.departures (schedule_rule_id) where schedule_rule_id is not null;

-- "PRESERVAR a saída" é diferente de "CONTINUAR VENDENDO a saída" (achado
-- de hardening): uma departure protegida por reserva relevante nunca é
-- removida/alterada, mas se ela deixou de bater com a regra ATUAL (horário
-- mudou, regra pausada) ela NÃO pode continuar aceitando reserva NOVA.
-- Default true -- manual normal e automática recém-gerada sempre nascem
-- vendáveis; reconcile_departures_for_schedule_rule é o único lugar que
-- desliga isso (e só quando a departure é automática, protegida, e não
-- bate mais com a regra), nunca cancela a reserva/pagamento já existente.
alter table public.departures
  add column if not exists marketplace_sales_enabled boolean not null default true;

-- Unique adicional pedida explicitamente -- garante que a MESMA regra nunca
-- gera duas linhas pro mesmo instante, independente do unique(vessel_id,
-- departs_at) que já protege contra conflito de agenda do barco em si.
create unique index tour_schedule_rules_departure_unique
  on public.departures (schedule_rule_id, departs_at)
  where schedule_rule_id is not null;

-- Reserva "relevante" -- confirmada, ou pendente com hold ainda válido.
-- MESMA definição de "consome capacidade" já usada por check_departure_
-- capacity (trigger em reservations, 0042). Deliberadamente MAIS ESTREITA
-- que a checagem de deleteDeparture() (saidas/actions.ts -- bloqueia
-- remoção MANUAL por qualquer reserva histórica, mesmo cancelada): ação
-- humana explícita exige mais cautela que reconciliação automática de
-- agenda. Uma reserva cancelada, ou um hold vencido, nunca protege uma
-- departure de ser reconciliada.
create or replace function public.tour_schedule_departure_has_active_reservation(p_departure_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.reservations
    where departure_id = p_departure_id
      and (status = 'confirmada' or (status = 'pendente' and hold_expires_at > now()))
  );
$$;

revoke all on function public.tour_schedule_departure_has_active_reservation(uuid) from public, anon, authenticated;
grant execute on function public.tour_schedule_departure_has_active_reservation(uuid) to service_role;

-- ============================================================================
-- GERAÇÃO IDEMPOTENTE DE SAÍDAS -- motor interno, service_role only. Chamado
-- por dois caminhos: (1) server action do operador, DEPOIS de confirmar via
-- RLS (client de sessão) que a regra pertence à empresa dele; (2) futuro cron
-- de auto-extensão (sem sessão de usuário, itera todas as regras
-- auto_extend=true). Nunca deriva autorização por conta própria -- quem
-- chama já validou o que precisava validar antes.
--
-- INSERT ... ON CONFLICT (vessel_id, departs_at) DO NOTHING -- reaproveita o
-- unique que já existe desde 0000 (nunca dois departures pro mesmo barco no
-- mesmo instante, seja de agenda ou manual). Idempotente: salvar/rodar a
-- mesma regra várias vezes nunca duplica.
--
-- was_conflict distingue os dois motivos de um slot não ter sido criado:
-- (a) já existe uma departure NOSSA nesse (vessel, horário) -- bookkeeping
-- normal de reconcile_departures_for_schedule_rule, nunca reportado ao
-- operador como problema; (b) já existe uma departure de OUTRA origem
-- (outra regra, ou manual) -- conflito real de agenda do barco, reportado
-- pra o server action mostrar ao operador (pedido explícito: "não quero
-- conflito silencioso na UX").
-- ============================================================================
create or replace function public.generate_departures_for_schedule_rule(p_schedule_rule_id uuid)
returns table (departure_id uuid, departs_at timestamptz, was_conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule record;
  v_tour record;
  v_effective_price_cents int;
  v_day date;
  v_horizon_end date;
  v_time time;
  v_local_ts timestamp;
  v_departs_at timestamptz;
  v_new_id uuid;
  v_existing_rule_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('tour_schedule_rule'), hashtext(p_schedule_rule_id::text));

  select * into v_rule from public.tour_schedule_rules where id = p_schedule_rule_id;
  if not found or not v_rule.active then
    return;
  end if;

  select base_price_cents, price_type into v_tour from public.tours where id = v_rule.tour_id;
  if not found then
    return;
  end if;

  v_effective_price_cents := coalesce(v_rule.price_cents_override, v_tour.base_price_cents);
  v_horizon_end := (now() at time zone '-03:00')::date + v_rule.horizon_days;

  v_day := (now() at time zone '-03:00')::date;
  while v_day <= v_horizon_end loop
    if extract(dow from v_day)::smallint = any (v_rule.days_of_week) then
      foreach v_time in array v_rule.times loop
        v_local_ts := v_day + v_time;
        v_departs_at := v_local_ts at time zone '-03:00';

        -- nunca gera no passado (mesmo se o horário de hoje já passou)
        if v_departs_at > now() then
          insert into public.departures (
            company_id, vessel_id, tour_id, departs_at, capacity, status,
            price_cents, price_type, schedule_rule_id
          ) values (
            v_rule.company_id, v_rule.vessel_id, v_rule.tour_id, v_departs_at, v_rule.capacity_override, 'agendada',
            v_effective_price_cents, v_tour.price_type, p_schedule_rule_id
          )
          on conflict (vessel_id, departs_at) do nothing
          returning id into v_new_id;

          if v_new_id is not null then
            departure_id := v_new_id;
            departs_at := v_departs_at;
            was_conflict := false;
            return next;
          else
            select d.schedule_rule_id into v_existing_rule_id
              from public.departures d
              where d.vessel_id = v_rule.vessel_id and d.departs_at = v_departs_at;

            if v_existing_rule_id is distinct from p_schedule_rule_id then
              departure_id := null;
              departs_at := v_departs_at;
              was_conflict := true;
              return next;
            end if;
            -- senão: já é uma departure DESTA regra (bookkeeping normal,
            -- reconcile_departures_for_schedule_rule já cuidou dela) -- nada
            -- a reportar.
          end if;
        end if;
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;

  return;
end;
$$;

revoke all on function public.generate_departures_for_schedule_rule(uuid) from public, anon, authenticated;
grant execute on function public.generate_departures_for_schedule_rule(uuid) to service_role;

-- ============================================================================
-- RECONCILIAÇÃO -- roda ANTES de generate_departures_for_schedule_rule (o
-- server action chama as duas em sequência). Pra cada departure AUTOMÁTICA
-- (schedule_rule_id = esta regra), FUTURA, ainda 'agendada' (nunca toca em
-- passada/encerrada/cancelada/manual -- o WHERE já exclui todas essas por
-- construção):
--
--   (a) tem reserva/hold RELEVANTE -> PROTEGIDA, nunca tocada, nunca removida;
--   (b) não tem, e ainda bate com os parâmetros ATUAIS da regra (mesma
--       embarcação, dia/horário dentro do horizonte, regra ativa) -> mantida,
--       mas preço/capacidade são reconciliados pra configuração atual;
--   (c) não tem, e NÃO bate mais (regra editada/pausada) -> removida de
--       verdade (mesmo mecanismo de deleteDeparture: apaga manifests
--       primeiro, depois a departure -- redundante com o ON DELETE CASCADE
--       de ambas FKs, mas mantém o mesmo padrão explícito já usado ali).
--
-- Regra PAUSADA (active=false) -> nenhum slot é "válido", então toda
-- departure automática sem reserva relevante é removida (retira da
-- disponibilidade), e nenhuma nova é gerada (generate_departures_for_
-- schedule_rule também já recusa regra inativa). Idempotente: rodar duas
-- vezes seguidas na segunda vez não encontra mais nada pra remover/atualizar
-- (o que sobrou já bate com a regra atual, ou está protegido).
-- ============================================================================
create or replace function public.reconcile_departures_for_schedule_rule(p_schedule_rule_id uuid)
returns table (removed_count int, updated_count int, protected_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule record;
  v_tour record;
  v_vessel record;
  v_effective_price_cents int;
  v_effective_capacity int;
  v_horizon_end date;
  v_removed int := 0;
  v_updated int := 0;
  v_protected int := 0;
  v_dep record;
  v_valid boolean;
  v_target_day date;
  v_target_time time;
begin
  perform pg_advisory_xact_lock(hashtext('tour_schedule_rule'), hashtext(p_schedule_rule_id::text));

  select * into v_rule from public.tour_schedule_rules where id = p_schedule_rule_id;
  if not found then
    removed_count := 0;
    updated_count := 0;
    protected_count := 0;
    return next;
    return;
  end if;

  select base_price_cents into v_tour from public.tours where id = v_rule.tour_id;
  select commercial_capacity into v_vessel from public.vessels where id = v_rule.vessel_id;
  v_effective_price_cents := coalesce(v_rule.price_cents_override, v_tour.base_price_cents);
  -- comparação justa contra v_dep.capacity (nunca null) -- se a regra não
  -- tem override, o valor "certo" é a capacidade comercial da embarcação
  -- ATUAL (pode ter mudado desde a última geração), mesma fonte que trg_
  -- departure_capacity (0000) usaria.
  v_effective_capacity := coalesce(v_rule.capacity_override, v_vessel.commercial_capacity);
  v_horizon_end := (now() at time zone '-03:00')::date + v_rule.horizon_days;

  for v_dep in
    select id, vessel_id, departs_at, capacity, price_cents, marketplace_sales_enabled, status
    from public.departures
    where schedule_rule_id = p_schedule_rule_id
      and status = 'agendada'
      and departs_at > now()
    for update
  loop
    -- "válida" é calculada SEMPRE, protegida ou não -- preservar a saída
    -- (nunca remover/tocar reserva) é uma decisão separada de continuar
    -- vendendo ela (marketplace_sales_enabled).
    v_valid := false;
    if v_rule.active and v_dep.vessel_id = v_rule.vessel_id then
      v_target_day := (v_dep.departs_at at time zone '-03:00')::date;
      v_target_time := (v_dep.departs_at at time zone '-03:00')::time;
      if v_target_day <= v_horizon_end
         and extract(dow from v_target_day)::smallint = any (v_rule.days_of_week)
         and v_target_time = any (v_rule.times)
      then
        v_valid := true;
      end if;
    end if;

    if public.tour_schedule_departure_has_active_reservation(v_dep.id) then
      v_protected := v_protected + 1;
      -- PROTEGIDA: nunca removida, nunca tem preço/capacidade alterados
      -- (contrato já formado com o cliente é intocável) -- mas a
      -- VENDABILIDADE reflete se ela ainda faz parte da regra atual. Deixou
      -- de bater (regra editada/pausada) -> fecha pra novas vendas, mantém
      -- a reserva/saída existente operacional. Voltou a bater (regra
      -- reativada com os mesmos parâmetros) -> reabre.
      if v_dep.marketplace_sales_enabled is distinct from v_valid then
        update public.departures set marketplace_sales_enabled = v_valid where id = v_dep.id;
        v_updated := v_updated + 1;
      end if;
      continue;
    end if;

    if v_valid then
      if v_dep.price_cents is distinct from v_effective_price_cents
         or v_dep.capacity is distinct from v_effective_capacity
         or not v_dep.marketplace_sales_enabled
      then
        update public.departures
          set price_cents = v_effective_price_cents,
              capacity = v_effective_capacity,
              marketplace_sales_enabled = true
          where id = v_dep.id;
        v_updated := v_updated + 1;
      end if;
    else
      delete from public.manifests where departure_id = v_dep.id;
      delete from public.departures where id = v_dep.id;
      v_removed := v_removed + 1;
    end if;
  end loop;

  removed_count := v_removed;
  updated_count := v_updated;
  protected_count := v_protected;
  return next;
end;
$$;

revoke all on function public.reconcile_departures_for_schedule_rule(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_departures_for_schedule_rule(uuid) to service_role;

-- ============================================================================
-- Chamada quando tours.base_price_cents muda (updateTourFull, passeios/
-- actions.ts) -- reconcilia TODAS as regras do passeio de uma vez. Nenhuma
-- lógica de preço nova aqui: reconcile_departures_for_schedule_rule já
-- recalcula effective_price_cents = coalesce(price_cents_override,
-- tour.base_price_cents) sozinha -- rodar reconcile de novo, pra cada
-- regra, é suficiente. Regra com price_cents_override preenchido
-- corretamente NÃO muda (o coalesce ignora o novo base_price), satisfaz
-- "schedule override não é sobrescrito pelo base price" sem nenhum código
-- extra. Falha em uma regra nunca impede as demais.
-- ============================================================================
create or replace function public.reconcile_departures_for_tour(p_tour_id uuid)
returns table (schedule_rule_id uuid, removed_count int, updated_count int, protected_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id uuid;
  v_result record;
begin
  for v_rule_id in select id from public.tour_schedule_rules where tour_id = p_tour_id loop
    select * into v_result from public.reconcile_departures_for_schedule_rule(v_rule_id);
    schedule_rule_id := v_rule_id;
    removed_count := v_result.removed_count;
    updated_count := v_result.updated_count;
    protected_count := v_result.protected_count;
    return next;
  end loop;
  return;
end;
$$;

revoke all on function public.reconcile_departures_for_tour(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_departures_for_tour(uuid) to service_role;

-- ============================================================================
-- EXTENSÃO de validate_tour_for_publishing (0039/0044) -- "sem agenda" passa
-- de warning pra error. Mesmo código NO_FUTURE_DEPARTURES, só a severidade e
-- a mensagem mudam -- continua checando departures futuras de verdade
-- (manuais OU geradas por regra, tanto faz a origem), nunca checa
-- tour_schedule_rules diretamente (uma regra sem nenhuma departure gerada
-- ainda -- ex: horizonte mal configurado -- corretamente continua
-- bloqueando publicação, é o comportamento certo).
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

  -- EXTENSÃO (0063): "sem agenda" agora BLOQUEIA publicação (era warning).
  -- price_cents is not null é obrigatório aqui -- uma departure futura sem
  -- preço configurado NÃO é vendável de verdade (create_marketplace_booking,
  -- 0042, recusa com PRICE_NOT_CONFIGURED) -- contar ela como "agenda válida"
  -- deixaria o passeio publicar sem nenhum jeito real de ser comprado.
  select count(*) into v_future_departure_count
    from public.departures
    where tour_id = p_tour_id and status <> 'cancelada' and departs_at > now() and price_cents is not null;
  if v_future_departure_count = 0 then
    return query select 'NO_FUTURE_DEPARTURES', 'departures', 'Escolha quando esse passeio acontece -- adicione uma agenda ou pelo menos uma data.', 'error';
  end if;

  -- warning (nunca bloqueia)
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

comment on table public.tour_schedule_rules is
  'Camada de automação de agenda ("modo Recorrente") -- nunca substitui departures como unidade vendável real. Editar/pausar a regra reconcilia (reconcile_departures_for_schedule_rule) as departures automáticas futuras SEM reserva/hold relevante pra bater com os novos parâmetros -- pode remover as que saíram da regra, nunca remove/altera as que têm reserva relevante, nunca toca em passadas/encerradas/canceladas/manuais.';
comment on function public.generate_departures_for_schedule_rule(uuid) is
  'Motor de geração idempotente -- INSERT ... ON CONFLICT (vessel_id, departs_at) DO NOTHING. Chamado pelo server action do operador (após validar dono via RLS) e pelo futuro cron de auto-extensão, sempre DEPOIS de reconcile_departures_for_schedule_rule. was_conflict distingue bookkeeping normal (mesma regra) de conflito real de agenda do barco (outra origem).';
comment on function public.reconcile_departures_for_schedule_rule(uuid) is
  'Remove/atualiza departures automáticas futuras que não têm reserva/hold relevante e não batem mais com os parâmetros atuais da regra (ou com a regra pausada). Protege qualquer departure com reserva confirmada ou hold ainda válido -- nunca remove, nunca altera preço/capacidade dela.';
