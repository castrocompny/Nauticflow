-- Corrige uma falha de autorização (IDOR) encontrada em auditoria de segurança:
-- as políticas de RLS em `reservations` e `passengers` só validam que a linha NOVA
-- tem o `company_id` do usuário logado — nunca checam se as referências estrangeiras
-- (departure_id, client_id, partner_id em reservations; reservation_id em passengers)
-- apontam pra um registro da MESMA empresa. Isso permitia que um usuário autenticado
-- de qualquer empresa criasse uma reserva ou um passageiro "grudado" numa saída/reserva
-- de OUTRA empresa, contanto que soubesse o UUID (ex: vazado por um link de voucher),
-- corrompendo a contagem de vagas/passageiros dela sem aparecer no painel da vítima
-- (RLS esconde, já que o company_id da linha nova é do atacante).
--
-- Esta correção reforça no banco (defesa em profundidade, além da checagem já
-- adicionada no app em reservas/actions.ts e passenger-actions.ts): agora nenhuma
-- FK pode apontar pra um registro de empresa diferente da própria linha.
--
-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query).

create or replace function public.check_reservation_fk_company()
returns trigger
language plpgsql
as $$
declare
  v_departure_company uuid;
  v_client_company uuid;
  v_partner_company uuid;
begin
  select company_id into v_departure_company from public.departures where id = new.departure_id;
  if v_departure_company is null or v_departure_company <> new.company_id then
    raise exception 'Saída inválida para esta empresa.';
  end if;

  select company_id into v_client_company from public.clients where id = new.client_id;
  if v_client_company is null or v_client_company <> new.company_id then
    raise exception 'Cliente inválido para esta empresa.';
  end if;

  if new.partner_id is not null then
    select company_id into v_partner_company from public.partners where id = new.partner_id;
    if v_partner_company is null or v_partner_company <> new.company_id then
      raise exception 'Parceiro inválido para esta empresa.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reservation_fk_company on public.reservations;
create trigger trg_reservation_fk_company
  before insert or update of departure_id, client_id, partner_id, company_id on public.reservations
  for each row execute function public.check_reservation_fk_company();

create or replace function public.check_passenger_fk_company()
returns trigger
language plpgsql
as $$
declare
  v_reservation_company uuid;
begin
  select company_id into v_reservation_company from public.reservations where id = new.reservation_id;
  if v_reservation_company is null or v_reservation_company <> new.company_id then
    raise exception 'Reserva inválida para esta empresa.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_passenger_fk_company on public.passengers;
create trigger trg_passenger_fk_company
  before insert or update of reservation_id, company_id on public.passengers
  for each row execute function public.check_passenger_fk_company();
