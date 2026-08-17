-- Corrige uma lacuna deixada pela migration 0015: aquela migration validou as FKs de
-- `reservations` e `passengers`, mas esqueceu `departures.vessel_id`/`departures.tour_id`.
-- Mesma classe de bug (IDOR): um usuário autenticado de qualquer empresa podia criar/editar
-- uma saída apontando pra uma embarcação ou passeio de OUTRA empresa, contanto que soubesse
-- o UUID -- corrompendo dados entre empresas sem aparecer no painel da vítima (RLS esconde,
-- já que o company_id da linha de `departures` é do atacante).
--
-- Reforça no banco a checagem que já foi adicionada no app em saidas/actions.ts
-- (createDeparture/updateDeparture).
--
-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query).

create or replace function public.check_departure_fk_company()
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

drop trigger if exists trg_departure_fk_company on public.departures;
create trigger trg_departure_fk_company
  before insert or update of vessel_id, tour_id, company_id on public.departures
  for each row execute function public.check_departure_fk_company();
