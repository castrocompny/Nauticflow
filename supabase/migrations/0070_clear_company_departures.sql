-- ============================================================================
-- LIMPEZA EM MASSA DE SAÍDAS -- "Excluir todas as saídas" em /saidas.
--
-- Migration nova (não editando nenhuma anterior): a operação combina 3
-- passos que precisam ser vistos como uma coisa só -- pausar toda agenda
-- recorrente ativa da empresa, apagar manifests técnicos das departures
-- removíveis, apagar as departures sem reserva -- potencialmente sobre
-- MUITAS linhas de uma vez (a empresa inteira, não os 25 da página atual).
-- Fazer isso em Server Actions com várias chamadas .from()/.rpc()
-- separadas não garante atomicidade real (uma falha no meio deixaria
-- agenda pausada mas departures não apagadas, ou vice-versa) -- por isso
-- vira uma função SQL única: uma chamada RPC = uma transação implícita do
-- Postgres, tudo ou nada, sem precisar de nenhuma coordenação do lado do
-- app.
--
-- REGRA DE SEGURANÇA MAIS IMPORTANTE (pedido explícito, espelha
-- deleteDeparture() em src/app/(app)/saidas/actions.ts byte a byte):
-- NENHUMA departure com QUALQUER linha em reservations (mesmo cancelada/
-- histórica -- não só reserva "ativa") pode ser apagada. `exists (select 1
-- from reservations where departure_id = d.id)` é exatamente a mesma
-- checagem que `deleteDeparture` já faz hoje pra uma exclusão individual --
-- não afrouxada, não reimplementada de outro jeito.
-- ============================================================================

-- Preview READ-ONLY -- mostra os contadores ANTES do operador confirmar,
-- com as MESMAS 3 consultas que a operação real usa (nunca reimplementadas
-- separadamente -- garante que o preview bate exatamente com o resultado
-- real, sem depender de semântica de contagem com JOIN do PostgREST no
-- lado do client).
create or replace function public.preview_company_departures_cleanup()
returns table (would_delete int, would_protect int, active_schedules int)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from public.profiles where id = auth.uid();
  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;

  select count(*) into would_delete
    from public.departures d
    where d.company_id = v_company_id
      and not exists (select 1 from public.reservations r where r.departure_id = d.id);

  select count(*) into would_protect
    from public.departures d
    where d.company_id = v_company_id
      and exists (select 1 from public.reservations r where r.departure_id = d.id);

  select count(*) into active_schedules
    from public.tour_schedule_rules
    where company_id = v_company_id and active = true;

  return next;
end;
$$;

revoke all on function public.preview_company_departures_cleanup() from public, anon, service_role;
grant execute on function public.preview_company_departures_cleanup() to authenticated;

-- ============================================================================
-- Operação real -- authenticated-scoped, deriva company_id de auth.uid()
-- (mesmo padrão de save_recurring_schedule/pause_recurring_schedule,
-- migration 0063 -- NUNCA aceita company_id como parâmetro vindo do
-- navegador). Toda a função roda dentro da transação implícita da chamada
-- RPC -- se qualquer passo falhar, o Postgres reverte tudo, nunca deixa
-- "agenda pausada mas nada apagado" ou o contrário.
-- ============================================================================
create or replace function public.clear_company_departures()
returns table (deleted_departures int, protected_departures int, paused_schedules int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_tour_id uuid;
  v_pause_result record;
  v_paused int := 0;
  v_deleted int := 0;
  v_protected int := 0;
begin
  select company_id into v_company_id from public.profiles where id = auth.uid();
  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;

  -- 1) pausa toda regra recorrente ATIVA da empresa -- reaproveita
  -- pause_recurring_schedule (0063) por passeio, sem duplicar a lógica de
  -- reconcile/proteção de reserva nenhuma. Isso é o que impede o cron
  -- (extend-schedules) de recriar as saídas removidas abaixo -- sem
  -- pausar primeiro, o próximo ciclo do cron geraria tudo de novo.
  --
  -- IMPORTANTE (achado real ao validar em staging): pause_recurring_
  -- schedule já apaga, por dentro, as departures da própria regra que não
  -- têm reserva (via reconcile_departures_for_schedule_rule) -- ela nunca
  -- chega até o DELETE do passo 4 abaixo, porque já não existe mais. Sem
  -- somar o `removed_count` que a própria RPC devolve, `deleted_
  -- departures` ficaria sistematicamente errado (contando só o que o
  -- passo 4 removeu, sem o que já tinha sido removido aqui) -- descoberto
  -- pela validação funcional desta migration (ver DOCUMENTACAO.md), não
  -- suposto.
  for v_tour_id in
    select tour_id from public.tour_schedule_rules
    where company_id = v_company_id and active = true
  loop
    select * into v_pause_result from public.pause_recurring_schedule(v_tour_id);
    v_deleted := v_deleted + coalesce(v_pause_result.removed_count, 0);
    v_paused := v_paused + 1;
  end loop;

  -- 2) conta o que vai ficar protegido -- QUALQUER departure da empresa com
  -- pelo menos 1 reserva vinculada, de qualquer status (mesma regra exata
  -- de deleteDeparture -- nunca mais frouxa que ela).
  select count(*) into v_protected
    from public.departures d
    where d.company_id = v_company_id
      and exists (select 1 from public.reservations r where r.departure_id = d.id);

  -- 3) remove o manifest técnico das departures REMOVÍVEIS (sem reserva
  -- nenhuma) -- mesmo padrão de deleteDeparture, antes de apagar a
  -- departure em si (redundante com o ON DELETE CASCADE de manifests.
  -- departure_id, mas mantém o mesmo padrão explícito já usado ali).
  delete from public.manifests m
  using public.departures d
  where m.departure_id = d.id
    and d.company_id = v_company_id
    and not exists (select 1 from public.reservations r where r.departure_id = d.id);

  -- 4) apaga as departures SEM reserva da empresa que SOBRARAM -- as
  -- ligadas a uma regra recém-pausada já foram removidas no passo 1 (por
  -- isso este DELETE não as encontra mais, e não é contado de novo); este
  -- passo cobre o resto: manuais ("datas específicas") e qualquer
  -- histórico (agendada/em_andamento/encerrada/cancelada). Nunca toca em
  -- reservations/clients/payments/vouchers -- nada disso é referenciado
  -- por uma departure sem reserva nenhuma, por definição.
  with removed as (
    delete from public.departures d
    where d.company_id = v_company_id
      and not exists (select 1 from public.reservations r where r.departure_id = d.id)
    returning d.id
  )
  select v_deleted + count(*) into v_deleted from removed;

  deleted_departures := v_deleted;
  protected_departures := v_protected;
  paused_schedules := v_paused;
  return next;
end;
$$;

-- ACL: só o operador autenticado da própria empresa pode chamar -- nenhum
-- grant amplo a role nenhuma além de authenticated (nem a helpers internos
-- -- pause_recurring_schedule já era authenticated-only desde 0063, nada
-- muda nela aqui).
revoke all on function public.clear_company_departures() from public, anon, service_role;
grant execute on function public.clear_company_departures() to authenticated;
