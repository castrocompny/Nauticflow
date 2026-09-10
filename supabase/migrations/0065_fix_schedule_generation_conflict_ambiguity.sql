-- ============================================================================
-- BUG REAL encontrado durante a validação funcional de 0063/0064 num
-- Postgres real (Supabase STAGING, ddlgkrpjzmtgmoucangh) -- não uma
-- suposição de revisão de código, um erro genuinamente reproduzido:
--
--   ERROR: 42702: column reference "departs_at" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--   CONTEXT: PL/pgSQL function generate_departures_for_schedule_rule(uuid)
--            line 38 at SQL statement
--
-- CAUSA RAIZ: `generate_departures_for_schedule_rule` (0063) é declarada
-- `returns table (departure_id uuid, departs_at timestamptz, was_conflict
-- boolean)` -- em PL/pgSQL, cada coluna de RETURNS TABLE vira uma variável
-- OUT implícita no escopo da função, com o mesmo nome da coluna. A função
-- também insere na tabela `departures`, que tem uma coluna real chamada
-- `departs_at`. O INSERT em si (`insert into departures (..., departs_at,
-- ...)`) NÃO é ambíguo -- a lista de colunas de um INSERT só aceita nomes
-- de coluna pela própria gramática SQL, PL/pgSQL nunca tenta substituir
-- variável ali. O problema é especificamente o alvo do ON CONFLICT:
--
--   on conflict (vessel_id, departs_at) do nothing
--
-- Postgres resolve essa lista de colunas do ON CONFLICT de um jeito que
-- FICA sujeito à mesma checagem de ambiguidade que uma referência de
-- coluna comum -- e como existe uma variável OUT `departs_at` E uma coluna
-- `departures.departs_at`, a referência bate nos dois ao mesmo tempo, e o
-- Postgres recusa (42702) em vez de adivinhar qual foi a intenção.
--
-- Esta migration NÃO reabre/edita 0063 (já aplicada e registrada em
-- staging) -- corrige cirurgicamente como migration nova, mesmo padrão já
-- usado nesta cadeia pra achados pós-aplicação (0043 sobre EXECUTE, 0064
-- sobre GRANT de tabela).
-- ============================================================================

-- ============================================================================
-- CONSTRAINT USADA NO FIX -- confirmada no schema, não suposta.
--
-- 0000_init_schema.sql declara a tabela departures com:
--   unique (vessel_id, departs_at)
-- sem nome explícito. Postgres nomeia constraints UNIQUE sem nome
-- explicitamente de forma determinística: `<tabela>_<coluna(s)>_key` -- ou
-- seja, `departures_vessel_id_departs_at_key`. Confirmado por leitura de
-- TODO o histórico de migrations (0000 até 0064): nenhuma migration
-- posterior dropa, renomeia ou recria essa constraint -- é a MESMA desde a
-- criação da tabela, o nome é garantido estável.
--
-- Referenciar a constraint PELO NOME (`on conflict on constraint
-- departures_vessel_id_departs_at_key`) elimina o problema pela raiz: o
-- identificador depois de `on constraint` é o NOME da constraint, um
-- namespace totalmente diferente do de colunas/variáveis -- não há
-- like nenhuma com a variável OUT `departs_at`, então a ambiguidade nunca
-- pode ocorrer, em vez de só "seria improvável".
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
          -- CORREÇÃO (achado real em staging, ver comentário no topo desta
          -- migration): era `on conflict (vessel_id, departs_at)` -- ambíguo
          -- contra a variável OUT `departs_at` desta função (42702).
          -- Referenciar a constraint pelo NOME em vez da lista de colunas
          -- resolve sem ambiguidade nenhuma, mesma proteção real de
          -- corrida/duplicidade (é a MESMA constraint, só referenciada de
          -- outro jeito -- nenhuma mudança de comportamento).
          on conflict on constraint departures_vessel_id_departs_at_key do nothing
          returning id into v_new_id;

          if v_new_id is not null then
            departure_id := v_new_id;
            departs_at := v_departs_at;
            was_conflict := false;
            return next;
          else
            -- já qualificado por alias (d.departs_at) -- nunca ambíguo,
            -- referência com alias nunca colide com variável OUT.
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

-- ============================================================================
-- AUDITORIA (item pedido explicitamente): resto do corpo revisado
-- procurando outras referências que poderiam colidir com os 3 parâmetros
-- de RETURNS TABLE (departure_id, departs_at, was_conflict). Nenhuma outra
-- encontrada:
--   - lista de colunas do INSERT (`insert into departures (..., departs_at,
--     ...)`) -- gramática de INSERT só aceita nome de coluna ali, PL/pgSQL
--     nunca tenta substituir variável nessa posição, nunca foi ambíguo.
--   - `d.departs_at` (dentro do SELECT que resolve v_existing_rule_id) --
--     já vem qualificado pelo alias `d`, referência qualificada nunca
--     colide com variável PL/pgSQL (só identificador NU é candidato a
--     substituição).
--   - `departure_id := ...`, `departs_at := ...`, `was_conflict := ...` --
--     atribuições PL/pgSQL diretas às próprias variáveis OUT, sintaxe
--     correta e obrigatória (é assim que se popula RETURNS TABLE), não é
--     SQL embutido, não tem ambiguidade possível.
--   - `v_departs_at` (variável local, nome DIFERENTE do parâmetro
--     `departs_at`) -- usada em toda parte interna da função exatamente
--     pra evitar colisão de nome; já era a prática correta antes desta
--     correção, só o ON CONFLICT tinha escapado dela.
-- Nenhuma outra função desta migration chain declara RETURNS TABLE com
-- coluna cujo nome colida com coluna de tabela usada em ON CONFLICT
-- (reconcile_departures_for_schedule_rule/reconcile_departures_for_tour
-- não têm ON CONFLICT nenhum; save_recurring_schedule usa `on conflict
-- (tour_id) do update` mas suas colunas de saída são schedule_rule_id/
-- generated_count/updated_count/removed_count/protected_count/
-- conflict_count -- nenhuma se chama tour_id).
-- ============================================================================

-- ACL reafirmada explicitamente (não depender de default privileges do
-- projeto -- mesma lição já documentada em 0043/0064: CREATE OR REPLACE
-- preserva OID e portanto o GRANT que já existia, mas isso é reafirmado
-- aqui mesmo assim, defesa em profundidade, sem custo).
revoke all on function public.generate_departures_for_schedule_rule(uuid) from public, anon, authenticated;
grant execute on function public.generate_departures_for_schedule_rule(uuid) to service_role;
