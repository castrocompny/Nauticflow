-- ============================================================================
-- BUG REAL em Production, confirmado ao vivo (não suposição): a mesma
-- classe de erro já documentada e corrigida por 0065/0066 voltou a
-- acontecer -- desta vez não porque o CÓDIGO da correção estivesse errado,
-- mas porque a FUNÇÃO LIVE em Production tinha DIVERGIDO do corpo final
-- de 0065/0066, sem que a migration history acusasse nada (0063-0067
-- seguiam "applied" o tempo todo).
--
--   QUICK_SCHEDULE_DEBUG | code=42702 | message=column reference
--   "departs_at" is ambiguous | details=It could refer to either a
--   PL/pgSQL variable or a table column.
--
-- DIAGNÓSTICO READ-ONLY feito ANTES de qualquer alteração (nenhum repair,
-- nenhuma suposição de "só rodar 0065 de novo"): leitura de
-- pg_get_functiondef() ao vivo, comparando staging e Production com o
-- conteúdo exato dos arquivos 0065/0066 deste repositório.
--
--   STAGING (ddlgkrpjzmtgmoucangh): generate_departures_for_schedule_rule
--   E reconcile_departures_for_schedule_rule já estavam no corpo FINAL
--   correto (ON CONFLICT ON CONSTRAINT departures_vessel_id_departs_at_key,
--   America/Sao_Paulo nas duas) -- staging nunca regrediu, PASS confirmado
--   de novo agora.
--
--   PRODUCTION (gggpihphjjxndpfntnvm): as DUAS funções estavam com o corpo
--   ORIGINAL da 0063 -- `on conflict (vessel_id, departs_at) do nothing`
--   (a forma ambígua que 0065 existe pra eliminar) E `at time zone
--   '-03:00'` (a semântica errada que 0066 existe pra eliminar) --
--   byte-idênticas ao texto de 0063_tour_schedule_rules.sql, não ao de
--   0065/0066. `save_recurring_schedule` (nunca tocada por 0065/0066)
--   conferida também, e essa sim batia com o esperado -- só as duas
--   funções que 0065/0066 corrigiram tinham regredido.
--
-- CAUSA RAIZ DA DIVERGÊNCIA: não determinada com certeza a partir daqui
-- (fora do escopo pedido -- "provar qual função LIVE está gerando a
-- ambiguidade", não investigar como o banco chegou nesse estado) -- migration
-- history nunca indicou isso (0063-0067 sempre "applied"), e nenhuma
-- migration deste repositório reaplica 0063 sozinha depois de 0065/0066.
-- Registrado como fato observado, não como suposição.
--
-- CORREÇÃO: recria as DUAS funções com o corpo EXATO e final de
-- 0066_fix_schedule_timezone_semantics.sql (que já continha o fix de 0065
-- preservado integralmente) -- nenhuma linha reescrita/simplificada, só
-- reafirmando em Production (e, defensivamente, em qualquer ambiente) o
-- mesmo texto que já é o correto em staging. 0065 e 0066 NÃO são reabertas
-- -- migration nova, mesmo padrão de sempre nesta cadeia (0043/0064/0065/
-- 0066/0067). ACLs, SECURITY DEFINER e search_path preservados idênticos.
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
          insert into public.departures (
            company_id, vessel_id, tour_id, departs_at, capacity, status,
            price_cents, price_type, schedule_rule_id
          ) values (
            v_rule.company_id, v_rule.vessel_id, v_rule.tour_id, v_departs_at, v_rule.capacity_override, 'agendada',
            v_effective_price_cents, v_tour.price_type, p_schedule_rule_id
          )
          on conflict on constraint departures_vessel_id_departs_at_key do nothing
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
  v_effective_capacity := coalesce(v_rule.capacity_override, v_vessel.commercial_capacity);
  v_horizon_end := (now() at time zone 'America/Sao_Paulo')::date + v_rule.horizon_days;

  for v_dep in
    select id, vessel_id, departs_at, capacity, price_cents, marketplace_sales_enabled, status
    from public.departures
    where schedule_rule_id = p_schedule_rule_id
      and status = 'agendada'
      and departs_at > now()
    for update
  loop
    v_valid := false;
    if v_rule.active and v_dep.vessel_id = v_rule.vessel_id then
      v_target_day := (v_dep.departs_at at time zone 'America/Sao_Paulo')::date;
      v_target_time := (v_dep.departs_at at time zone 'America/Sao_Paulo')::time;
      if v_target_day <= v_horizon_end
         and extract(dow from v_target_day)::smallint = any (v_rule.days_of_week)
         and v_target_time = any (v_rule.times)
      then
        v_valid := true;
      end if;
    end if;

    if public.tour_schedule_departure_has_active_reservation(v_dep.id) then
      v_protected := v_protected + 1;
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
