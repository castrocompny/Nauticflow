-- NAUTICFLOW — DEFESA EM PROFUNDIDADE: create_marketplace_booking (ToursFlow)
-- TAMBÉM RECUSA PASSEIO ARQUIVADO, NÃO SÓ A ROTA
--
-- Achado na auditoria de prontidão ToursFlow (2026-09-24): a migration 0075
-- (NF2-001) fechou create_counter_reservation e create_flexible_counter_
-- reservation contra reserva nova em passeio arquivado (tours.active=false),
-- mas create_marketplace_booking (0042/0044/0063) ficou de fora -- a única
-- checagem de tour.active pro fluxo do ToursFlow vivia em TypeScript
-- (src/app/api/marketplace/bookings/route.ts, SELECT antes de chamar a RPC),
-- sem revalidação na MESMA transação que cria a reserva. Mesma classe de
-- janela de corrida que a 0063 já fechou pra DEPARTURE_NOT_SELLABLE
-- (marketplace_sales_enabled/status): rota lê active=true, passeio é
-- arquivado, rota chama a RPC, RPC cria a reserva mesmo assim.
--
-- Nenhuma migration anterior editada (0042/0044/0063/0064 intactas) --
-- create_marketplace_booking redefinida aqui via `create or replace
-- function`, corpo idêntico ao de 0063 + a checagem nova, mesmo padrão já
-- usado neste projeto (ver 0063 e 0075).
--
-- Contrato externo INALTERADO: a rota já responde DEPARTURE_NOT_FOUND (404
-- genérico) pra passeio arquivado -- arquivado é tratado como "não existe" de
-- propósito (nunca revela o motivo real pro ToursFlow, ver comentário em
-- route.ts). O erro interno da RPC usa o mesmo texto canônico 'TOUR_ARCHIVED'
-- já usado nas RPCs de balcão (0075) -- route.ts passa a reconhecer esse
-- texto e traduzir pra DEPARTURE_NOT_FOUND, igual já faz pra
-- DEPARTURE_NOT_FOUND/COMPANY_NOT_AVAILABLE vindos da RPC.
--
-- Nenhum booking válido (passeio ativo e publicado) é afetado -- a checagem
-- só dispara quando tours.active=false, que já é bloqueado hoje na camada de
-- aplicação; isto só fecha a janela de corrida entre a leitura da rota e o
-- INSERT.
-- ============================================================================
create or replace function public.create_marketplace_booking(
  p_departure_id uuid,
  p_quantity int,
  p_total_cents int,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_cpf text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_hold_minutes int
) returns table (
  booking_id uuid,
  hold_expires_at timestamptz,
  people_count int,
  total_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_tour_id uuid;
  v_tour_active boolean;
  v_departure_status text;
  v_sales_enabled boolean;
  v_client_id uuid;
  v_existing record;
  v_new_id uuid;
  v_hold timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('marketplace_booking'), hashtext(p_idempotency_key));

  select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint
    into v_existing
    from public.reservations r
    where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
    return;
  end if;

  select company_id, tour_id, status, marketplace_sales_enabled
    into v_company_id, v_tour_id, v_departure_status, v_sales_enabled
    from public.departures where id = p_departure_id;
  if v_company_id is null then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  if exists (select 1 from public.companies where id = v_company_id and suspended_at is not null) then
    raise exception 'COMPANY_NOT_AVAILABLE';
  end if;

  -- defesa em profundidade (0078) -- mesma checagem já feita em route.ts
  -- ANTES de chamar esta RPC, revalidada aqui dentro da MESMA transação que
  -- cria a reserva, fechando a janela de corrida entre a leitura da rota e
  -- este INSERT. Mesmo texto canônico 'TOUR_ARCHIVED' usado pelas RPCs de
  -- balcão (0075).
  --
  -- `for share` -- achado da revisão adversarial (2026-09-24): um SELECT
  -- puro não serializa contra o UPDATE de archiveTour (src/app/(app)/
  -- passeios/actions.ts), então um arquivamento concorrente podia commitar
  -- entre esta leitura e o INSERT da reserva abaixo, deixando uma reserva
  -- nova num passeio arquivado. `for share` prende o lock da linha até o
  -- fim desta transação -- o UPDATE de archiveTour (single-statement,
  -- exige lock incompatível com `for share`) bloqueia até esta transação
  -- commitar/reverter, e vice-versa: nunca as duas coisas acontecem
  -- intercaladas na mesma linha. archiveTour não toca departures/
  -- reservations, então não há risco de deadlock por ordem cruzada de
  -- locks com o restante desta função.
  select active into v_tour_active from public.tours where id = v_tour_id for share;
  if not coalesce(v_tour_active, false) then
    raise exception 'TOUR_ARCHIVED';
  end if;

  -- defesa em profundidade (0063) -- mesma checagem já feita em route.ts
  -- ANTES de chamar esta RPC, revalidada aqui dentro da MESMA transação
  -- que cria a reserva, fechando a janela de corrida entre a leitura da
  -- rota e este INSERT.
  if v_departure_status <> 'agendada' or not v_sales_enabled then
    raise exception 'DEPARTURE_NOT_SELLABLE';
  end if;

  begin
    if p_customer_cpf is not null then
      insert into public.clients (company_id, name, cpf, phone, email)
      values (v_company_id, p_customer_name, p_customer_cpf, p_customer_phone, p_customer_email)
      on conflict (company_id, cpf) do update set cpf = excluded.cpf
      returning id into v_client_id;
    else
      insert into public.clients (company_id, name, phone, email)
      values (v_company_id, p_customer_name, p_customer_phone, p_customer_email)
      returning id into v_client_id;
    end if;

    v_hold := now() + make_interval(mins => p_hold_minutes);

    insert into public.reservations (
      company_id, departure_id, client_id, people_count, total_cents,
      status, source, origin_name, created_by, partner_id,
      hold_expires_at, idempotency_key, request_fingerprint
    ) values (
      v_company_id, p_departure_id, v_client_id, p_quantity, p_total_cents,
      'pendente', 'marketplace', 'ToursFlow', null, null,
      v_hold, p_idempotency_key, p_request_fingerprint
    )
    returning id into v_new_id;

    return query select v_new_id, v_hold, p_quantity, p_total_cents, false;
    return;
  exception
    when unique_violation then
      if sqlerrm not like '%reservations_marketplace_idempotency_key_unique%' then
        raise;
      end if;

      select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint
        into v_existing
        from public.reservations r
        where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;
      if v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;

      return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
      return;
  end;
end;
$$;

-- ACL idêntica à de 0063/0064 (mesmo achado documentado em 0044 -- revoke ...
-- from public sozinho não basta, Supabase concede EXECUTE por padrão).
revoke all on function public.create_marketplace_booking(uuid, int, int, text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.create_marketplace_booking(uuid, int, int, text, text, text, text, text, text, int) to service_role;
