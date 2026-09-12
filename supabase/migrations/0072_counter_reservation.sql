-- Reserva de balcão (NAUTICFLOW — RESERVA DE BALCÃO + ESTOQUE ÚNICO).
--
-- Inspeção prévia (antes de escrever qualquer schema novo, pedido explícito):
--
-- 1) Estoque único: já existe -- departures.capacity + o gatilho
--    trg_reservation_capacity/check_departure_capacity() (migrations 0000,
--    0003, 0042, inalterado desde então) já é a autoridade única e
--    compartilhada de capacidade, usada tanto pelo painel do operador quanto
--    por create_marketplace_booking() (ToursFlow). NENHUMA tabela de estoque
--    paralela existe hoje -- confirmado lendo 0000_init_schema.sql,
--    0042_marketplace_reservas_hold.sql e src/app/api/marketplace/bookings/
--    route.ts (que chama create_marketplace_booking via service_role, nunca
--    insere em reservations diretamente). Esta migration NÃO cria estoque
--    novo, NÃO substitui o gatilho -- só adiciona uma RPC que, como toda
--    inserção em reservations, passa pelo MESMO gatilho.
--
-- 2) Origem/canal da reserva: já existe -- reservations.source (migration
--    0035_reservas_origem_estruturada.sql), com valores
--    'manual'|'operator'|'website'|'marketplace'|'partner'|'agency'. O
--    comentário da própria 0035 já documenta 'manual' como "exatamente o que
--    o painel do operador sempre foi: alguém do time digitando a reserva na
--    tela" -- ou seja, 'manual' JÁ significa "balcão" desde que foi criado, e
--    é o valor default da coluna (nenhuma reserva antiga precisa de
--    reclassificação: todas as reservas do painel já são 'manual', todas as
--    do ToursFlow já são 'marketplace', nenhum dado histórico ambíguo).
--    'partner' já existe reservado pra uma futura origem de parceria. NÃO
--    criamos uma coluna sales_channel/reservation_source nova -- seria
--    duplicar um conceito que já existe e já está corretamente populado.
--    origin_name (mesma migration 0000) continua sendo o que sempre foi:
--    texto livre complementar (nome do hotel/indicação), um conceito
--    DIFERENTE de canal -- não confundido aqui.
--
-- 3) Nenhuma RPC autenticada existente cria reservation de balcão hoje: o
--    fluxo atual (src/app/(app)/reservas/actions.ts, createReservation) faz
--    um INSERT direto via client session-scoped, sem criação de cliente
--    embutida -- por isso não há como garantir atomicidade real entre "criar
--    cliente rápido" e "criar a reserva" com as primitives atuais (duas
--    chamadas separadas podem deixar cliente órfão se a segunda falhar).
--    RPC nova, abaixo, necessária só para ISSO -- mesmo padrão já usado em
--    save_recurring_schedule()/pause_recurring_schedule() (0063): deriva
--    company_id de auth.uid(), nunca aceita company_id do browser,
--    authenticated-only.

create or replace function public.create_counter_reservation(
  p_departure_id uuid,
  p_people_count int,
  p_total_cents int,
  p_client_id uuid default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_origin_name text default null
)
returns table (reservation_id uuid, client_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_departure record;
  v_client_id uuid;
  v_reservation_id uuid;
begin
  select company_id into v_company_id from public.profiles where id = auth.uid();
  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;

  if p_people_count is null or p_people_count < 1 then
    raise exception 'INVALID_PEOPLE_COUNT';
  end if;
  if p_total_cents is null or p_total_cents < 0 then
    raise exception 'INVALID_TOTAL_CENTS';
  end if;

  -- saida precisa ser da MESMA empresa e ainda estar em estado reservavel --
  -- validado ANTES de criar cliente nenhum, pra nunca deixar um cliente
  -- orfao no ar se a saida em si ja for invalida.
  select id, company_id, status into v_departure
    from public.departures
    where id = p_departure_id;

  if v_departure.id is null or v_departure.company_id <> v_company_id then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;
  if v_departure.status in ('cancelada', 'encerrada') then
    raise exception 'DEPARTURE_NOT_BOOKABLE';
  end if;

  if p_client_id is not null then
    select id into v_client_id from public.clients
      where id = p_client_id and company_id = v_company_id;
    if v_client_id is null then
      raise exception 'CLIENT_NOT_FOUND';
    end if;
  else
    if p_client_name is null or btrim(p_client_name) = '' then
      raise exception 'CLIENT_NAME_REQUIRED';
    end if;
    -- cliente rapido: so nome (obrigatorio) + telefone (opcional) -- CPF/
    -- e-mail/cidade continuam podendo ser completados depois em /clientes
    -- (colunas ja nullable desde 0000, nenhum schema novo necessario aqui).
    insert into public.clients (company_id, name, phone)
      values (v_company_id, btrim(p_client_name), nullif(btrim(coalesce(p_client_phone, '')), ''))
      returning id into v_client_id;
  end if;

  -- nasce 'confirmada' (ocupa vaga real, sem hold -- pedido explicito: balcao
  -- nao cria hold nesta etapa) e source='manual' (== "balcao", ver nota 2
  -- acima). O INSERT abaixo dispara trg_reservation_capacity normalmente --
  -- MESMO gatilho que protege reservas manuais e do ToursFlow hoje, nao
  -- duplicado nem contornado: se a capacidade real (sob lock de linha da
  -- propria departure) ja tiver sido consumida por outra venda concorrente
  -- entre a consulta de vagas exibida na UI e este INSERT, o gatilho recusa
  -- e a transacao INTEIRA (inclusive um cliente rapido recem-criado acima)
  -- eh revertida -- nunca fica cliente orfao, nunca ha overbooking.
  insert into public.reservations (
    company_id, departure_id, client_id, people_count, total_cents,
    status, source, origin_name, created_by
  ) values (
    v_company_id, p_departure_id, v_client_id, p_people_count, p_total_cents,
    'confirmada', 'manual', nullif(btrim(coalesce(p_origin_name, '')), ''), auth.uid()
  )
  returning id into v_reservation_id;

  reservation_id := v_reservation_id;
  client_id := v_client_id;
  return next;
end;
$$;

comment on function public.create_counter_reservation is
  'Reserva de balcão (operador NauticFlow) -- cliente existente OU criação rápida de cliente + reserva confirmada na MESMA transação (atômico: capacidade excedida reverte tudo, nunca deixa cliente órfão). company_id sempre derivado de auth.uid(), nunca recebido do browser. Consome o MESMO estoque (departures.capacity + trg_reservation_capacity) usado por create_marketplace_booking (ToursFlow) -- nenhum estoque paralelo.';

revoke all on function public.create_counter_reservation(uuid, int, int, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.create_counter_reservation(uuid, int, int, uuid, text, text, text) to authenticated;
