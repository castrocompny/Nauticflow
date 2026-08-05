-- Correções críticas da auditoria pré-lançamento (2026-08-01).
-- Rode este script no SQL Editor do Supabase, depois dos anteriores.

-- ============================================================================
-- 1) TRAVA DE CONCORRÊNCIA: impede overselling quando duas reservas chegam
--    ao mesmo tempo para a mesma saída.
--
-- Antes: a função lia soma(people_count) sem travar a linha da saída. Duas
-- transações simultâneas podiam ler "9 de 10 ocupadas" ao mesmo tempo, cada
-- uma inserir +1 achando que ainda cabia, e as duas commitarem — resultado:
-- 11 pessoas confirmadas numa saída de capacidade 10.
--
-- Agora: a primeira linha da função trava a linha de `departures` (FOR UPDATE)
-- até o fim da transação. A segunda reserva concorrente espera essa trava
-- liberar, e só então lê o número já atualizado de passageiros confirmados.
-- ============================================================================

create or replace function public.check_departure_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity int;
  v_booked int;
begin
  if new.status <> 'confirmada' then
    return new;
  end if;

  -- trava a saida ate o fim da transacao: serializa reservas concorrentes
  perform 1 from public.departures where id = new.departure_id for update;

  select capacity into v_capacity from public.departures where id = new.departure_id;

  select coalesce(sum(people_count), 0) into v_booked
    from public.reservations
    where departure_id = new.departure_id
      and status = 'confirmada'
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_booked + new.people_count > v_capacity then
    raise exception 'Capacidade excedida: % vaga(s) disponível(is), % solicitada(s).',
      greatest(v_capacity - v_booked, 0), new.people_count;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 2) CAPACIDADE NÃO PODE FICAR MENOR QUE O JÁ CONFIRMADO
--
-- Antes: dava pra editar uma saída com 8 passageiros confirmados e reduzir a
-- capacidade pra 5 — o sistema aceitava, e a saída ficava num estado
-- impossível (8 confirmados numa saída de capacidade 5).
--
-- Agora: ao editar (não ao criar) uma saída, a função soma os passageiros já
-- confirmados e recusa a mudança se a nova capacidade for menor que isso.
-- ============================================================================

create or replace function public.set_departure_capacity()
returns trigger
language plpgsql
as $$
declare
  v_commercial int;
  v_booked int;
begin
  select commercial_capacity into v_commercial from public.vessels where id = new.vessel_id;

  if new.capacity is null then
    new.capacity := v_commercial;
  elsif new.capacity > v_commercial then
    raise exception 'A capacidade informada excede a capacidade comercial da embarcação (%).', v_commercial;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(people_count), 0) into v_booked
      from public.reservations
      where departure_id = new.id
        and status = 'confirmada';

    if new.capacity < v_booked then
      raise exception 'A capacidade não pode ficar menor que os % passageiro(s) já confirmado(s) nesta saída.', v_booked;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 3) FECHA A BRECHA DE SEGURANÇA EM `profiles`
--
-- Antes: a política de RLS de UPDATE em profiles só garantia que o usuário
-- editava a própria linha (id = auth.uid()), mas não limitava QUAIS colunas
-- ele podia mudar. Como a anon key é pública, qualquer usuário autenticado
-- podia chamar a API do Supabase diretamente (sem passar pelo app) e trocar
-- o próprio `company_id` para o de OUTRA empresa — ganhando acesso de leitura
-- e escrita a todos os dados dessa empresa (toda RLS do sistema depende de
-- profiles.company_id).
--
-- Agora: a permissão de UPDATE em profiles fica restrita, a nível de coluna,
-- a `name` e `email` — as únicas que o app de fato precisa editar
-- (configuracoes/actions.ts). Uma tentativa de alterar company_id ou role
-- via API é recusada pelo Postgres antes mesmo de chegar na política de RLS.
-- ============================================================================

revoke update on public.profiles from authenticated;
grant update (name, email) on public.profiles to authenticated;
