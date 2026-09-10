-- ============================================================================
-- SEGUNDO BUG REAL encontrado durante a validação funcional de 0063/0064/
-- 0065 num Postgres real (Supabase STAGING, ddlgkrpjzmtgmoucangh) -- não
-- suposição de revisão de código, erro genuinamente reproduzido depois que
-- 0065 já tinha corrigido o 42702:
--
--   ERROR P0001: O horário de saída deve ser entre 08:00 e 19:00
--   (horário de Brasília).
--
-- gerando uma agenda configurada para as 10:00 -- bem no meio da janela
-- permitida, não um caso de borda.
--
-- CAUSA RAIZ: `generate_departures_for_schedule_rule`/`reconcile_
-- departures_for_schedule_rule` (0063) convertem hora local <-> UTC usando
-- `AT TIME ZONE '-03:00'` (um OFFSET NUMÉRICO), enquanto `check_departure_
-- schedule()` (0014, a trigger que valida a janela 08:00-19:00, continua
-- vigente e não foi tocada) usa `AT TIME ZONE 'America/Sao_Paulo'` (um
-- NOME de zona IANA). A decisão original (documentada em 0063 e no ADR
-- 0008) tratava os dois como "numericamente idênticos hoje" -- essa
-- afirmação está ERRADA, e o motivo é uma diferença real de semântica do
-- Postgres pra `AT TIME ZONE` com um argumento que é um OFFSET NUMÉRICO
-- puro (não um nome de zona nem uma abreviação da tabela `pg_timezone_
-- abbrevs`): pra esse caso, o Postgres cai no mesmo caminho de parsing
-- usado por especificações de fuso no ESTILO POSIX, cuja convenção de
-- sinal é INVERTIDA em relação à ISO-8601 -- POSIX trata "positivo" como
-- OESTE de Greenwich (o oposto do que qualquer pessoa razoavelmente
-- assumiria, e o oposto do que o próprio Postgres usa pra nomes de zona
-- IANA normais como `America/Sao_Paulo`, que seguem ISO-8601 -- positivo é
-- LESTE). `'America/Sao_Paulo'`, sendo um NOME reconhecido em `pg_
-- timezone_names`, nunca passa por esse parsing de offset numérico -- é
-- resolvido direto pela base de dados IANA/Olson, sem ambiguidade
-- nenhuma. Só o offset NUMÉRICO `'-03:00'` está sujeito a essa inversão.
--
-- PROVA (derivação a partir da semântica documentada do Postgres --
-- consistente com o erro real observado; recomenda-se rodar a query de
-- verificação abaixo no próprio staging pra confirmação direta, sem
-- depender só desta análise):
--
--   -- se o parsing de offset numérico do Postgres aplicar a convenção
--   -- POSIX (sinal invertido) a uma string como '-03:00', o resultado
--   -- efetivo é equivalente a tratar o horário local como se estivesse em
--   -- UTC+03:00 (oposto de UTC-03:00):
--   select timestamp '2026-09-20 10:00' at time zone '-03:00';
--   -- esperado, SE a inversão ocorrer: 2026-09-20 07:00:00+00
--   -- (10:00 tratado como UTC+3 -> UTC = local - 3)
--   -- em vez do 2026-09-20 13:00:00+00 que a intenção original (offset
--   -- ISO-8601 "normal", UTC-3 -> UTC = local + 3) assumia.
--
--   select timestamp '2026-09-20 10:00' at time zone 'America/Sao_Paulo';
--   -- 2026-09-20 13:00:00+00 -- América/São_Paulo é UTC-3 o ano inteiro
--   -- (sem horário de verão desde 2019), resolvido corretamente via nome
--   -- IANA, sem ambiguidade de sinal.
--
--   -- convertendo os dois resultados de volta pra hora local de Brasília
--   -- (a MESMA conversão que check_departure_schedule() faz de verdade):
--   select (timestamp '2026-09-20 10:00' at time zone '-03:00')
--            at time zone 'America/Sao_Paulo';
--   -- SE a inversão ocorrer: 2026-09-20 04:00:00 -- FORA de 08:00-19:00,
--   -- exatamente o tipo de rejeição observada de verdade em staging (uma
--   -- agenda configurada pra 10:00 sendo recusada).
--
--   select (timestamp '2026-09-20 10:00' at time zone 'America/Sao_Paulo')
--            at time zone 'America/Sao_Paulo';
--   -- 2026-09-20 10:00:00 -- exatamente o horário configurado, dentro da
--   -- janela, sem surpresa nenhuma.
--
-- A decisão anterior (0063, seção "geração/reconciliação... sempre via AT
-- TIME ZONE '-03:00'... os dois são numericamente idênticos HOJE") está
-- registrada como INCORRETA -- ver correção em DOCUMENTACAO.md seção 106
-- e ADR 0008. O raciocínio original (evitar reintrodução de horário de
-- verão) não estava errado como PREOCUPAÇÃO, mas a CONCLUSÃO (offset fixo
-- seria mais seguro que o nome de zona) estava invertida: é exatamente o
-- NOME de zona IANA que é resolvido sem ambiguidade nenhuma pelo Postgres
-- -- o offset numérico é que introduz um risco real de inversão de sinal.
--
-- CORREÇÃO: troca `AT TIME ZONE '-03:00'` por `AT TIME ZONE
-- 'America/Sao_Paulo'` em TODO ponto de cálculo de horário civil de
-- Brasília dentro da automação de agenda -- a MESMA zona que check_
-- departure_schedule() (0014) já usa, eliminando a divergência
-- estruturalmente (as duas conversões passam a ser literalmente a mesma
-- chamada). check_departure_schedule() em si NÃO foi tocada -- já estava
-- correta. 0063 e 0065 NÃO foram reabertas -- correção como migration
-- nova, mesmo padrão já usado em toda essa cadeia (0043/0064/0065).
-- ============================================================================

-- ============================================================================
-- generate_departures_for_schedule_rule -- corpo idêntico ao da 0065
-- (que já tinha corrigido o ON CONFLICT ambíguo, 42702), trocando as 3
-- ocorrências de '-03:00' por 'America/Sao_Paulo'.
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
  -- CORREÇÃO (0066): 'America/Sao_Paulo' -- mesma zona que check_departure_
  -- schedule() (0014) usa pra validar -- nunca mais offset numérico aqui.
  v_horizon_end := (now() at time zone 'America/Sao_Paulo')::date + v_rule.horizon_days;

  v_day := (now() at time zone 'America/Sao_Paulo')::date;
  while v_day <= v_horizon_end loop
    if extract(dow from v_day)::smallint = any (v_rule.days_of_week) then
      foreach v_time in array v_rule.times loop
        v_local_ts := v_day + v_time;
        -- CORREÇÃO (0066): idem -- constrói o instante UTC a partir do
        -- horário civil de Brasília usando a MESMA zona nomeada que a
        -- trigger de validação usa pra ler de volta. Elimina a divergência
        -- de convenção de sinal do offset numérico (ver prova no topo
        -- desta migration).
        v_departs_at := v_local_ts at time zone 'America/Sao_Paulo';

        if v_departs_at > now() then
          insert into public.departures (
            company_id, vessel_id, tour_id, departs_at, capacity, status,
            price_cents, price_type, schedule_rule_id
          ) values (
            v_rule.company_id, v_rule.vessel_id, v_rule.tour_id, v_departs_at, v_rule.capacity_override, 'agendada',
            v_effective_price_cents, v_tour.price_type, p_schedule_rule_id
          )
          -- ON CONFLICT ainda pela constraint nomeada -- fix da 0065,
          -- preservado integralmente, não reaberto aqui.
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

-- ============================================================================
-- reconcile_departures_for_schedule_rule -- corpo idêntico ao da 0063,
-- trocando as 3 ocorrências de '-03:00' por 'America/Sao_Paulo'. Toda a
-- lógica de reconciliação (protegida/vendável, herança de preço/
-- capacidade, remoção de obsoletas) permanece byte-idêntica -- só a
-- conversão de fuso muda.
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
  v_effective_capacity := coalesce(v_rule.capacity_override, v_vessel.commercial_capacity);
  -- CORREÇÃO (0066): 'America/Sao_Paulo' -- ver comentário no topo desta
  -- migration.
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
      -- CORREÇÃO (0066): idem -- ler o dia/horário civil de Brasília de
      -- uma departure existente precisa da MESMA zona que a trigger usa
      -- pra validar, senão a comparação contra v_rule.days_of_week/times
      -- (configurados pelo operador em horário civil) fica sistematicamente
      -- errada.
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

-- ============================================================================
-- AUDITORIA (item pedido explicitamente): reconcile_departures_for_tour
-- não tem NENHUM cálculo de fuso próprio -- só itera as regras de um
-- passeio e chama reconcile_departures_for_schedule_rule (já corrigida
-- acima) pra cada uma. Nenhuma alteração necessária, não recriada aqui.
--
-- Nenhuma outra função da automação de agenda usa AT TIME ZONE '-03:00'
-- (confirmado por busca em todo o arquivo 0063: as únicas ocorrências
-- fora das duas funções acima são comentários explicando a decisão
-- ANTERIOR, agora corrigida por esta migration e pela atualização de
-- DOCUMENTACAO.md/ADR 0008 -- os comentários do arquivo 0063 em si não
-- são alterados, a correção fica registrada aqui e na documentação, não
-- editando histórico).
-- ============================================================================
