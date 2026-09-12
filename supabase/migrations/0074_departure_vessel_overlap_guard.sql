-- NAUTICFLOW — NF-001: REGRA CANÔNICA DE OVERLAP DE EMBARCAÇÃO
--
-- Causa confirmada pela auditoria funcional (BUG NF-001): a checagem de
-- overlap de embarcação existia SÓ dentro de create_flexible_counter_
-- reservation (migration 0073, fluxo de balcão do modelo privativo).
-- createDeparture, updateDeparture e generate_departures_for_schedule_rule
-- (agenda recorrente) nunca verificavam overlap nenhum -- só o unique
-- (vessel_id, departs_at), que barra apenas timestamp EXATAMENTE igual, não
-- um intervalo sobreposto. Reproduzido em Staging (fixture isolada, ROLLBACK):
-- a mesma embarcação aceitava 10:00-14:00 E 12:00-16:00 sem erro nenhum.
--
-- Pré-condição confirmada ANTES desta migration (pedido explícito, "se
-- encontrar overlap existente, PARE"): zero overlaps já materializados em
-- Staging E Production (consulta com o MESMO fallback conservador usado
-- abaixo, rodada nos dois ambientes antes de escrever este arquivo).
--
-- ============================================================================
-- GUARDA DE SEGURANÇA -- aborta a migration inteira se, entre a checagem
-- manual acima e a aplicação real, algum overlap tiver sido criado (nunca
-- aplica o gatilho por cima de dado já inconsistente).
-- ============================================================================
do $$
declare
  v_existing_overlaps int;
begin
  with eff as (
    select d.id, d.vessel_id, d.departs_at,
      coalesce(
        d.ends_at,
        case when t.duration_minutes is not null and t.duration_minutes > 0
          then d.departs_at + (t.duration_minutes || ' minutes')::interval
          else null
        end,
        (date_trunc('day', d.departs_at at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo'
      ) as effective_end
    from public.departures d
    join public.tours t on t.id = d.tour_id
    where d.status <> 'cancelada'
  )
  select count(*) into v_existing_overlaps
    from eff a join eff b on a.vessel_id = b.vessel_id and a.id < b.id
    where a.departs_at < b.effective_end and b.departs_at < a.effective_end;

  if v_existing_overlaps > 0 then
    raise exception 'NF001_ABORT: % overlap(s) de embarcação já existem nos dados -- migration abortada, corrigir manualmente antes de reaplicar.', v_existing_overlaps;
  end if;
end $$;

-- ============================================================================
-- PARTE 1 — departure_effective_end: primitive canônica única do "término
-- efetivo" de uma saída, reproduzindo EXATAMENTE o mesmo fallback já usado e
-- testado em create_flexible_counter_reservation (0073) -- nunca uma regra
-- nova/divergente:
--   1. ends_at, quando existe;
--   2. senão, departs_at + tour.duration_minutes, quando a duração é conhecida;
--   3. senão (fallback CONSERVADOR -- nunca finge que a embarcação está
--      livre quando o término real é desconhecido), fim do dia civil em
--      Brasília.
-- language sql (não plpgsql) -- pura função de data, sem acesso a tabela,
-- então pode ser chamada tanto pelo novo gatilho quanto (no futuro, se
-- necessário) de qualquer outro lugar sem repetir a expressão.
-- ============================================================================
create or replace function public.departure_effective_end(
  p_departs_at timestamptz,
  p_ends_at timestamptz,
  p_duration_minutes int
) returns timestamptz
language sql
stable
as $$
  select coalesce(
    p_ends_at,
    case when p_duration_minutes is not null and p_duration_minutes > 0
      then p_departs_at + (p_duration_minutes || ' minutes')::interval
      else null
    end,
    (date_trunc('day', p_departs_at at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo'
  );
$$;

revoke all on function public.departure_effective_end(timestamptz, timestamptz, int) from public, anon, service_role;
-- authenticated precisa poder chamar: o gatilho abaixo NÃO é security definer
-- (mesmo padrão de check_departure_fk_company/set_departure_capacity -- só
-- precisa da MESMA leitura de vessels/tours que o próprio operador já tem via
-- RLS), então a chamada explícita a esta função roda com o papel de quem
-- disparou o INSERT/UPDATE em departures.
grant execute on function public.departure_effective_end(timestamptz, timestamptz, int) to authenticated;

comment on function public.departure_effective_end is
  'Término efetivo de uma saída para fins de overlap de embarcação -- ends_at > departs_at+duration_minutes (quando conhecida) > fim do dia civil em Brasília (fallback conservador, nunca finge saída livre com término desconhecido). Regra canônica única, usada pelo gatilho trg_departure_vessel_overlap (0074) -- create_flexible_counter_reservation (0073) mantém sua própria checagem inline intacta (não foi tocada, para preservar sem risco a semântica já testada), redundante mas nunca conflitante com esta.';

-- ============================================================================
-- PARTE 2 — check_departure_vessel_overlap: gatilho canônico único em
-- departures. Cobre TODO caminho de INSERT/UPDATE (saída avulsa manual,
-- edição, agenda recorrente, balcão fixo e privativo) -- nenhuma Server
-- Action nem RPC precisa reimplementar overlap por conta própria daqui pra
-- frente. Faz DUAS coisas, nesta ordem:
--   (a) preenche ends_at automaticamente pra fixed_schedule quando a duração
--       é conhecida e ninguém informou um valor explícito (nunca inventa
--       duração quando duration_minutes é NULL/<=0, nunca sobrescreve um
--       ends_at que a própria instrução do caller mudou de verdade);
--   (b) verifica overlap contra qualquer outra saída ativa (status <>
--       'cancelada' -- MESMA semântica já usada em create_flexible_counter_
--       reservation, nunca uma lista divergente) da MESMA embarcação, sob
--       advisory lock (mesmo padrão 'vessel_schedule' já usado em 0073).
-- ============================================================================
create or replace function public.check_departure_vessel_overlap()
returns trigger
language plpgsql
as $$
declare
  v_tour record;
  v_ends_at_explicit boolean;
  v_departs_or_tour_changed boolean;
  v_new_end timestamptz;
  v_conflict_id uuid;
begin
  select duration_minutes, booking_model into v_tour from public.tours where id = new.tour_id;

  -- (a) ends_at automático só para fixed_schedule com duração conhecida, só
  -- quando o próprio UPDATE/INSERT não tocou ends_at explicitamente com um
  -- valor diferente do que já existia (edição só de status, por exemplo,
  -- nunca reescreve ends_at de uma saída histórica à toa -- pedido
  -- explícito, "não alterar departures históricas desnecessariamente").
  -- Numa edição que MUDA departs_at/tour_id sem tocar ends_at no SET, o
  -- Postgres carrega o valor ANTIGO em new.ends_at (não fica NULL) -- por
  -- isso a condição é "não é distinto do antigo", não "é NULL": sem isso, um
  -- ends_at auto-preenchido na criação ficaria desatualizado (stale) depois
  -- de editar só o horário de início, quebrando a checagem de overlap em (b).
  v_ends_at_explicit := (tg_op = 'UPDATE' and new.ends_at is distinct from old.ends_at)
                     or (tg_op = 'INSERT' and new.ends_at is not null);
  v_departs_or_tour_changed := tg_op = 'INSERT'
                     or new.departs_at is distinct from old.departs_at
                     or new.tour_id is distinct from old.tour_id;

  if not v_ends_at_explicit
     and v_departs_or_tour_changed
     and v_tour.booking_model = 'fixed_schedule'
     and v_tour.duration_minutes is not null and v_tour.duration_minutes > 0
  then
    new.ends_at := new.departs_at + (v_tour.duration_minutes || ' minutes')::interval;
  end if;

  -- saída cancelada nunca ocupa a embarcação -- mesma semântica de status já
  -- usada em create_flexible_counter_reservation (status <> 'cancelada').
  if new.status = 'cancelada' then
    return new;
  end if;

  v_new_end := public.departure_effective_end(new.departs_at, new.ends_at, v_tour.duration_minutes);

  -- trava por embarcação até o fim da transação -- MESMO padrão já validado
  -- em create_flexible_counter_reservation (0073); reentrante na mesma
  -- transação (uma chamada dessa RPC que insere em departures reaquire o
  -- mesmo lock que ela mesma já segura, sem autodeadlock).
  perform pg_advisory_xact_lock(hashtext('vessel_schedule'), hashtext(new.vessel_id::text));

  -- d.departs_at <> new.departs_at: um timestamp EXATAMENTE igual já é
  -- resolvido pelo unique(vessel_id, departs_at) de sempre (migration 0000)
  -- -- que a geração de agenda recorrente usa via `on conflict ... do
  -- nothing` para re-rodar idempotente sem erro nenhum. Esta checagem nova
  -- cuida só do caso que o unique NUNCA cobriu: horários DIFERENTES cujo
  -- intervalo se sobrepõe -- nunca disputa com o caminho de duplicata exata
  -- já testado.
  select d.id into v_conflict_id
    from public.departures d
    join public.tours t2 on t2.id = d.tour_id
    where d.vessel_id = new.vessel_id
      and d.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and d.status <> 'cancelada'
      and d.departs_at <> new.departs_at
      and public.departure_effective_end(d.departs_at, d.ends_at, t2.duration_minutes) > new.departs_at
      and d.departs_at < v_new_end
    limit 1;

  if v_conflict_id is not null then
    raise exception 'VESSEL_OVERLAP';
  end if;

  return new;
end;
$$;

revoke all on function public.check_departure_vessel_overlap() from public, anon, authenticated, service_role;

-- nome escolhido de propósito para ordenar (alfabeticamente, ordem real de
-- execução de múltiplos gatilhos BEFORE no Postgres) DEPOIS de
-- trg_departure_fk_company -- garante que vessel_id/tour_id já foram
-- confirmados como da própria empresa antes desta checagem rodar.
drop trigger if exists trg_departure_vessel_overlap on public.departures;
create trigger trg_departure_vessel_overlap
  before insert or update of vessel_id, tour_id, departs_at, ends_at, status on public.departures
  for each row execute function public.check_departure_vessel_overlap();

comment on trigger trg_departure_vessel_overlap on public.departures is
  'NF-001: regra canônica única de overlap de embarcação -- cobre saída avulsa manual, edição, agenda recorrente e balcão (fixo e privativo). Boundary [início,fim): terminar às 14:00 e começar outra às 14:00 é permitido.';

-- ============================================================================
-- PARTE 3 — generate_departures_for_schedule_rule: redefinida (corpo
-- idêntico ao de 0068, nenhuma outra regra tocada) só para não deixar o novo
-- VESSEL_OVERLAP do gatilho acima derrubar a geração inteira da agenda por
-- causa de UM slot conflitante -- achado ao validar esta migration em
-- Staging (o gatilho abortava a função inteira, inclusive os dias sem
-- nenhum conflito, na primeira tentativa). Mesmo contrato de sempre
-- (`was_conflict boolean` por linha) -- antes cobria só duplicata de
-- timestamp exato (via `on conflict ... do nothing` + checagem de
-- `schedule_rule_id`), agora cobre TAMBÉM overlap de intervalo (captura o
-- `VESSEL_OVERLAP` do gatilho por INSERT, isolado num sub-bloco próprio --
-- só aquele slot vira conflito, os demais dias continuam sendo processados
-- normalmente). Qualquer OUTRO erro inesperado continua propagando (nunca
-- silenciado).
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
  v_horizon_end := (now() at time zone 'America/Sao_Paulo')::date + v_rule.horizon_days;

  v_day := (now() at time zone 'America/Sao_Paulo')::date;
  while v_day <= v_horizon_end loop
    if extract(dow from v_day)::smallint = any (v_rule.days_of_week) then
      foreach v_time in array v_rule.times loop
        v_local_ts := v_day + v_time;
        v_departs_at := v_local_ts at time zone 'America/Sao_Paulo';

        if v_departs_at > now() then
          v_new_id := null;
          begin
            insert into public.departures (
              company_id, vessel_id, tour_id, departs_at, capacity, status,
              price_cents, price_type, schedule_rule_id
            ) values (
              v_rule.company_id, v_rule.vessel_id, v_rule.tour_id, v_departs_at, v_rule.capacity_override, 'agendada',
              v_effective_price_cents, v_tour.price_type, p_schedule_rule_id
            )
            on conflict on constraint departures_vessel_id_departs_at_key do nothing
            returning id into v_new_id;
          exception when others then
            -- só VESSEL_OVERLAP (trg_departure_vessel_overlap, 0074) vira
            -- "conflito" deste slot -- qualquer outro erro é real e precisa
            -- continuar subindo, nunca mascarado.
            if sqlerrm = 'VESSEL_OVERLAP' then
              v_new_id := null;
            else
              raise;
            end if;
          end;

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
