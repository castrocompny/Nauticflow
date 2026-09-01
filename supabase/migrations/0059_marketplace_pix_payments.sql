-- PIX do cliente: cobrança real Asaas (mock/sandbox controlado nesta fase),
-- QR Code, webhook de liquidação, confirmação atômica da reserva + efeito
-- financeiro. NENHUMA cobrança real em produção acontece por causa desta
-- migration -- MARKETPLACE_PAYMENTS_ENABLED continua false por padrão, e
-- MARKETPLACE_PAYMENTS_MODE precisa estar explicitamente configurado (mock/
-- sandbox/production) pra qualquer chamada de rede acontecer. Ver
-- docs/adr/0007-marketplace-pix-payment-settlement.md para a decisão
-- completa.
--
-- NÃO editar 0052-0058 (nenhuma ainda aplicada) -- migration nova. Duas
-- funções são estendidas via `create or replace function` com A MESMA
-- assinatura (nunca editando os arquivos originais):
-- create_marketplace_payment_attempt (0052, ganha validação de CPF/CNPJ do
-- cliente ANTES de persistir a tentativa) e settle_marketplace_payment_
-- received (nova, mas DELEGA pra record_marketplace_payment_confirmed,
-- 0053/0055/0057, sem duplicar a lógica de snapshot/ledger).

-- ============================================================================
-- CLIENTS -- vínculo com o customer do Asaas (marketplace, nunca confundido
-- com companies.asaas_customer_id da assinatura SaaS do OPERADOR, migration
-- 0012 -- são dois clientes completamente diferentes do Asaas: um é o
-- turista comprando um passeio, outro é o operador pagando a mensalidade do
-- NauticFlow).
-- ============================================================================

alter table public.clients
  add column if not exists asaas_customer_id text;

create unique index if not exists clients_asaas_customer_id_unique
  on public.clients (asaas_customer_id)
  where asaas_customer_id is not null;

comment on column public.clients.asaas_customer_id is
  'Id do customer no Asaas (marketplace ToursFlow) -- NUNCA confundir com companies.asaas_customer_id (assinatura SaaS do operador, migration 0012). Persistido depois de criar/localizar o customer, evita recriação duplicada em retries.';

-- ============================================================================
-- EXTENSÃO de create_marketplace_payment_attempt (0052): valida que o
-- cliente da reserva tem CPF/CNPJ válido (checksum real, reaproveita
-- trial_validate_cpf/trial_validate_cnpj, migration 0045 -- nunca duplica o
-- algoritmo) ANTES de inserir a tentativa -- mesma disciplina de "checar
-- antes de persistir" já usada pra provider desabilitado (ADR 0001, achado
-- da revisão da Fase 4A): sem isso, uma reserva sem documento válido
-- ocuparia o único slot pending/paid permitido (payments_one_active_per_
-- reservation) com uma tentativa que NUNCA vai conseguir criar um customer
-- Asaas, bloqueando pra sempre uma tentativa futura já com documento certo.
-- Mesma assinatura exata de 0052.
-- ============================================================================

create or replace function public.create_marketplace_payment_attempt(
  p_booking_id uuid,
  p_payment_method text,
  p_idempotency_key text,
  p_request_fingerprint text
) returns table (
  payment_id uuid,
  status text,
  payment_method text,
  amount_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_reservation record;
  v_tour_suspended timestamptz;
  v_tour_active boolean;
  v_tour_status text;
  v_client_cpf text;
  v_new_id uuid;
begin
  select p.id, p.status, p.payment_method, p.amount_cents, p.request_fingerprint
    into v_existing
    from public.payments p
    where p.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.payment_method, v_existing.amount_cents, true;
    return;
  end if;

  select r.id, r.company_id, r.total_cents, r.status, r.source, r.hold_expires_at, r.departure_id, r.client_id
    into v_reservation
    from public.reservations r
    where r.id = p_booking_id;

  if not found or v_reservation.source <> 'marketplace' then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_reservation.status <> 'pendente' then
    raise exception 'BOOKING_NOT_PENDING';
  end if;
  if v_reservation.hold_expires_at is null or v_reservation.hold_expires_at <= now() then
    raise exception 'HOLD_EXPIRED';
  end if;

  select t.active, t.marketplace_status, t.marketplace_suspended_at
    into v_tour_active, v_tour_status, v_tour_suspended
    from public.departures d
    join public.tours t on t.id = d.tour_id
    where d.id = v_reservation.departure_id;

  if not found or not v_tour_active or v_tour_status <> 'published' or v_tour_suspended is not null then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  if exists (select 1 from public.companies c where c.id = v_reservation.company_id and c.suspended_at is not null) then
    raise exception 'COMPANY_NOT_AVAILABLE';
  end if;

  -- REVISÃO 0059: Asaas exige CPF/CNPJ pra criar o customer -- checado AQUI,
  -- antes de qualquer INSERT em payments. Nunca inventa documento (nem do
  -- operador, nem da empresa) -- se o cliente não tem CPF/CNPJ válido, a
  -- tentativa é recusada de vez, o ToursFlow precisa coletar o documento
  -- antes de chamar este endpoint de novo.
  select c.cpf into v_client_cpf from public.clients c where c.id = v_reservation.client_id;
  if v_client_cpf is null or not (
    (length(v_client_cpf) = 11 and public.trial_validate_cpf(v_client_cpf))
    or (length(v_client_cpf) = 14 and public.trial_validate_cnpj(v_client_cpf))
  ) then
    raise exception 'CUSTOMER_DOCUMENT_REQUIRED';
  end if;

  begin
    insert into public.payments (
      company_id, reservation_id, status, amount_cents, provider,
      payment_method, idempotency_key, request_fingerprint
    ) values (
      v_reservation.company_id, v_reservation.id, 'pending', v_reservation.total_cents, 'asaas',
      p_payment_method, p_idempotency_key, p_request_fingerprint
    )
    returning id into v_new_id;

    return query select v_new_id, 'pending'::text, p_payment_method, v_reservation.total_cents, false;
    return;
  exception
    when unique_violation then
      if sqlerrm like '%payments_one_active_per_reservation%' then
        raise exception 'PAYMENT_ALREADY_ACTIVE';
      end if;

      select p.id, p.status, p.payment_method, p.amount_cents
        into v_existing
        from public.payments p
        where p.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      return query select v_existing.id, v_existing.status, v_existing.payment_method, v_existing.amount_cents, true;
      return;
  end;
end;
$$;

revoke all on function public.create_marketplace_payment_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_marketplace_payment_attempt(uuid, text, text, text) to service_role;

-- ============================================================================
-- EXTENSÃO de marketplace_refunds.reason_code (0055): novo valor
-- 'settlement_exception' -- cobre os 3 desfechos anômalos da liquidação
-- (amount divergente, reserva não confirmável, capacidade perdida) --
-- nenhum dos 6 valores anteriores descrevia corretamente "o pagamento
-- liquidou mas algo impediu a reserva de ser confirmada normalmente" (é uma
-- exceção de settlement, não uma decisão de cancelamento).
-- ============================================================================

alter table public.marketplace_refunds
  drop constraint marketplace_refunds_reason_code_check;
alter table public.marketplace_refunds
  add constraint marketplace_refunds_reason_code_check
  check (reason_code in (
    'customer_cancellation', 'operator_cancellation', 'departure_cancelled', 'no_show_policy',
    'legal_override', 'admin_manual', 'settlement_exception'
  ));

-- ============================================================================
-- PERSISTIR O ID DO PROVIDER -- passo intermediário entre "tentativa criada"
-- e "liquidada" -- assim que a cobrança PIX é criada/reconciliada no Asaas
-- (POST /v3/payments), mesmo antes do cliente pagar. Idempotente: setar o
-- MESMO valor de novo não é erro (retry seguro); setar um valor DIFERENTE
-- do já persistido é rejeitado (nunca deveria acontecer -- sinal de
-- confusão/tampering).
-- ============================================================================

create or replace function public.mark_marketplace_payment_provider_created(
  p_payment_id uuid,
  p_provider_payment_id text
) returns table (id uuid, provider_payment_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  select provider_payment_id into v_existing from public.payments where id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  if v_existing is not null and v_existing <> p_provider_payment_id then
    raise exception 'PROVIDER_PAYMENT_ID_MISMATCH';
  end if;

  update public.payments set provider_payment_id = p_provider_payment_id where id = p_payment_id;

  return query select p_payment_id, p_provider_payment_id;
end;
$$;

revoke all on function public.mark_marketplace_payment_provider_created(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_marketplace_payment_provider_created(uuid, text) to service_role;

-- ============================================================================
-- LIQUIDAÇÃO ATÔMICA -- único ponto de entrada pra processar PAYMENT_
-- RECEIVED. AUTORIDADE é sempre o webhook (nunca a resposta síncrona do
-- POST /payments) -- esta RPC só deve ser chamada de lá. Reaproveita
-- record_marketplace_payment_confirmed (0053/0055/0057) pro efeito
-- financeiro em si -- nunca duplica a lógica de snapshot/ledger aqui.
--
-- REVALIDAÇÃO DE CAPACIDADE ATÔMICA (política já definida no ADR 0001, Fase
-- 4A -- implementada aqui pela primeira vez): a própria UPDATE de
-- reservations.status pra 'confirmada' dispara trg_reservation_capacity
-- (migration 0000, BEFORE UPDATE OF status), que recusa com "Capacidade
-- excedida: ..." se a vaga já foi ocupada por outra reserva nesse meio
-- tempo -- SEM nenhuma checagem TypeScript separada, que teria uma janela
-- de corrida. Pagamento tardio (hold já vencido, mas o cliente pagou antes
-- do cancelamento) é um caso ESPERADO de chegar até aqui -- a autoridade de
-- "ainda cabe" nunca foi o hold, é a capacidade real neste instante.
--
-- NUNCA overbooking, NUNCA perde o dinheiro do cliente: se a capacidade já
-- foi perdida, se a reserva não está mais confirmável, ou se o valor
-- recebido diverge do esperado -- o pagamento é marcado (quando o dinheiro
-- de fato chegou) e um marketplace_refunds em 'manual_review' é criado
-- (reason_code='settlement_exception') -- nunca operator_blocked, nunca
-- reserva confirmada, sempre uma trilha auditável pra resolução humana.
-- ============================================================================

create or replace function public.settle_marketplace_payment_received(
  p_internal_payment_id uuid,
  p_provider_payment_id text,
  p_confirmed_amount_cents int
) returns table (
  payment_id uuid,
  status text,
  reservation_status text,
  is_replay boolean,
  requires_manual_review boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_reservation record;
  v_confirm record;
  v_needs_review boolean;
  v_reservation_status text;
begin
  select p.id, p.status, p.amount_cents, p.company_id, p.reservation_id, p.provider_payment_id
    into v_payment
    from public.payments p
    where p.id = p_internal_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status = 'paid' then
    -- replay -- já liquidado antes (idempotente, nunca reprocessa nem
    -- reconta efeito financeiro).
    select r.status into v_reservation_status from public.reservations r where r.id = v_payment.reservation_id;
    select exists(
      select 1 from public.marketplace_refunds mr
      where mr.payment_id = v_payment.id and mr.status = 'manual_review'
    ) into v_needs_review;
    return query select v_payment.id, v_payment.status, v_reservation_status, true, v_needs_review;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  if v_payment.provider_payment_id is not null and v_payment.provider_payment_id <> p_provider_payment_id then
    raise exception 'PROVIDER_PAYMENT_ID_MISMATCH';
  end if;

  if p_confirmed_amount_cents <> v_payment.amount_cents then
    -- valor divergente -- NUNCA confirma reserva, NUNCA credita ledger.
    -- payment.status fica 'pending' (identidade do dinheiro incerta até
    -- reconciliação humana) -- só registra o provider_payment_id e a
    -- pendência de revisão. idempotency_key determinístico -- webhook
    -- reenviado não duplica a linha de manual_review.
    update public.payments set provider_payment_id = p_provider_payment_id where id = p_internal_payment_id;

    insert into public.marketplace_refunds (
      company_id, reservation_id, payment_id, customer_refund_cents, operator_deduction_cents,
      platform_fee_adjustment_cents, deducted_from_bucket, status, reason_code, cancelled_by_type, idempotency_key
    ) values (
      v_payment.company_id, v_payment.reservation_id, v_payment.id, p_confirmed_amount_cents, 0, 0, null,
      'manual_review', 'settlement_exception', 'system', 'settlement-amount-mismatch-' || v_payment.id::text
    )
    on conflict (idempotency_key) do nothing;

    return query select v_payment.id, v_payment.status, null::text, false, true;
    return;
  end if;

  select r.id, r.status into v_reservation
    from public.reservations r
    where r.id = v_payment.reservation_id;

  if not found or v_reservation.status <> 'pendente' then
    -- reserva não está mais confirmável (já cancelada, ou qualquer estado
    -- que não seja o esperado) -- dinheiro chegou de verdade (valor batia),
    -- mas não pode virar reserva. Marca 'paid' (fato financeiro real) +
    -- manual_review -- nunca credita o operador.
    update public.payments set status = 'paid', provider_payment_id = p_provider_payment_id where id = p_internal_payment_id;

    insert into public.marketplace_refunds (
      company_id, reservation_id, payment_id, customer_refund_cents, operator_deduction_cents,
      platform_fee_adjustment_cents, deducted_from_bucket, status, reason_code, cancelled_by_type, idempotency_key
    ) values (
      v_payment.company_id, v_payment.reservation_id, v_payment.id, v_payment.amount_cents, 0, 0, null,
      'manual_review', 'settlement_exception', 'system', 'settlement-reservation-not-confirmable-' || v_payment.id::text
    )
    on conflict (idempotency_key) do nothing;

    return query select v_payment.id, 'paid'::text, v_reservation.status, false, true;
    return;
  end if;

  update public.payments set provider_payment_id = p_provider_payment_id where id = p_internal_payment_id;

  begin
    -- REVALIDAÇÃO ATÔMICA DE CAPACIDADE -- trg_reservation_capacity dispara
    -- aqui, dentro da MESMA transação. Late payment (hold vencido) é
    -- esperado chegar até este ponto -- ver comentário no topo da função.
    update public.reservations set status = 'confirmada' where id = v_reservation.id;
  exception
    when others then
      if sqlerrm not like 'Capacidade excedida%' then
        raise;
      end if;

      -- NUNCA overbooking: a vaga foi ocupada por outra reserva nesse meio
      -- tempo. Dinheiro do cliente é real -- marcado 'paid' -- mas a
      -- reserva NUNCA vira 'confirmada', o operador NUNCA recebe
      -- operator_blocked. Cai pra manual_review (reembolso real ao cliente
      -- é decisão humana nesta fase -- nenhum provider refund automático).
      update public.payments set status = 'paid' where id = p_internal_payment_id;

      insert into public.marketplace_refunds (
        company_id, reservation_id, payment_id, customer_refund_cents, operator_deduction_cents,
        platform_fee_adjustment_cents, deducted_from_bucket, status, reason_code, cancelled_by_type, idempotency_key
      ) values (
        v_payment.company_id, v_reservation.id, v_payment.id, v_payment.amount_cents, 0, 0, null,
        'manual_review', 'settlement_exception', 'system', 'settlement-capacity-lost-' || v_payment.id::text
      )
      on conflict (idempotency_key) do nothing;

      return query select v_payment.id, 'paid'::text, v_reservation.status, false, true;
      return;
  end;

  -- capacidade OK, reserva confirmada -- delega o efeito financeiro
  -- (snapshot + ledger) pro único lugar que sabe fazer isso, nunca
  -- duplicado aqui.
  select * into v_confirm from public.record_marketplace_payment_confirmed(p_internal_payment_id, p_confirmed_amount_cents);

  return query select v_confirm.payment_id, v_confirm.status, 'confirmada'::text, v_confirm.is_replay, false;
end;
$$;

revoke all on function public.settle_marketplace_payment_received(uuid, text, int) from public, anon, authenticated;
grant execute on function public.settle_marketplace_payment_received(uuid, text, int) to service_role;
