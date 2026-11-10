-- ============================================================================
-- 0091 -- Isolamento do replay por idempotency_key em
-- create_marketplace_refund_request (0055).
--
-- Defeito: o índice marketplace_refunds_idempotency_key_unique é GLOBAL e o
-- replay devolvia o pedido existente pela chave ANTES de conferir empresa e
-- reserva -- um company_admin/super_admin de uma empresa recebia id, status e
-- valores de pedido de outra empresa (ou de outra reserva própria).
--
-- Correção: o replay só acontece se o pedido existente pertence à empresa
-- autenticada E à reserva pedida; senão IDEMPOTENCY_KEY_CONFLICT, sem devolver
-- dados e sem efeito (a recusa ocorre antes de travas, cálculo e inserts).
-- Não basta ignorar o pedido e seguir criando outro: a chave é única global.
--
-- Mesma assinatura, SECURITY DEFINER, search_path, grants e regra de papéis da
-- 0055 (super_admin continua restrito à própria empresa). Corpo idêntico à 0055
-- exceto o bloco de replay. 0055 não é editada.
-- Aplicada só em laboratório local descartável; não aplicada em remoto.
-- ============================================================================

create or replace function public.create_marketplace_refund_request(
  p_reservation_id uuid,
  p_idempotency_key text,
  p_reason_code text,
  p_legal_override_percent_bp int default null,
  p_legal_override_reason text default null
) returns table (
  id uuid,
  status text,
  customer_refund_cents int,
  operator_deduction_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_cancelled_by_type text;
  v_existing record;
  v_reservation record;
  v_payment record;
  v_outcome text;
  v_calc record;
  v_operator_deduction_cents int;
  v_already_released boolean;
  v_bucket text;
  v_available bigint;
  v_remaining_blocked bigint;
  v_new_id uuid;
  v_status text;
begin
  select p.company_id, p.role into v_company_id, v_role
    from public.profiles p
    where p.id = auth.uid();

  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;
  if v_role not in ('company_admin', 'super_admin') then
    raise exception 'FORBIDDEN';
  end if;

  if p_reason_code not in ('customer_cancellation', 'operator_cancellation', 'departure_cancelled', 'no_show_policy', 'legal_override', 'admin_manual') then
    raise exception 'INVALID_REASON_CODE';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- legal override É uma decisão administrativa -- nunca o operador da
  -- própria empresa, sempre super_admin, sempre com motivo registrado.
  if p_legal_override_percent_bp is not null then
    if v_role <> 'super_admin' then
      raise exception 'FORBIDDEN_LEGAL_OVERRIDE';
    end if;
    if p_legal_override_reason is null or length(btrim(p_legal_override_reason)) = 0 then
      raise exception 'LEGAL_OVERRIDE_REASON_REQUIRED';
    end if;
  end if;

  v_cancelled_by_type := case when v_role = 'super_admin' then 'admin' else 'operator' end;

  -- replay ANTES de qualquer trava/cálculo -- mesmo padrão de release
  -- (0053/hardening).
  select r.id, r.status, r.customer_refund_cents, r.operator_deduction_cents, r.company_id, r.reservation_id
    into v_existing
    from public.marketplace_refunds r
    where r.idempotency_key = p_idempotency_key;

  if found then
    -- chave é única GLOBAL: só é replay do MESMO pedido (empresa + reserva).
    if v_existing.company_id is distinct from v_company_id
       or v_existing.reservation_id is distinct from p_reservation_id then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.customer_refund_cents, v_existing.operator_deduction_cents, true;
    return;
  end if;

  select r.id, r.status, r.company_id, r.outcome
    into v_reservation
    from public.reservations r
    where r.id = p_reservation_id;

  if not found or v_reservation.company_id <> v_company_id then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  select pay.id, pay.amount_cents, pay.operator_amount_cents, pay.service_at_snapshot, pay.cancellation_policy_snapshot
    into v_payment
    from public.payments pay
    where pay.reservation_id = p_reservation_id and pay.status = 'paid'
    order by pay.created_at desc
    limit 1;

  if not found then
    raise exception 'PAYMENT_NOT_PAID';
  end if;

  v_outcome := public.derive_marketplace_reservation_outcome(p_reservation_id);
  if v_outcome is null then
    raise exception 'RESERVATION_OUTCOME_UNDETERMINED';
  end if;

  -- travas: por COMPANY (mesma chave de create_marketplace_withdrawal --
  -- disputa por 'available') sempre primeiro, depois por RESERVA (mesma
  -- chave de release_marketplace_reservation_balance -- disputa por
  -- 'blocked' desta reserva específica). Mesma ordem fixa já usada em
  -- record_marketplace_refund (0053), evita deadlock entre as funções.
  perform pg_advisory_xact_lock(hashtext('marketplace_withdrawal'), hashtext(v_company_id::text));
  perform pg_advisory_xact_lock(hashtext('marketplace_reservation_balance'), hashtext(p_reservation_id::text));

  select cr.customer_refund_cents, cr.operator_compensation_cents, cr.platform_fee_adjustment_cents
    into v_calc
    from public.calculate_marketplace_refund_amounts(
      v_payment.amount_cents, v_payment.operator_amount_cents, v_payment.service_at_snapshot,
      now(), v_payment.cancellation_policy_snapshot, v_outcome, p_legal_override_percent_bp
    ) cr;

  v_operator_deduction_cents := v_payment.operator_amount_cents - v_calc.operator_compensation_cents;
  if v_operator_deduction_cents < 0 then
    raise exception 'REFUND_CALCULATION_ERROR';
  end if;

  select exists(
    select 1 from public.marketplace_ledger_entries
    where reference_type = 'release' and reference_id = p_reservation_id
      and entry_type = 'operator_released' and bucket = 'available'
  ) into v_already_released;

  v_bucket := case when v_already_released then 'available' else 'blocked' end;

  -- REVISÃO 0055: nunca deixa blocked/available negativos -- se o valor
  -- reservado não cabe de verdade no bucket calculado (ex: já foi
  -- parcialmente sacado/reembolsado antes, ou já foi tudo transferred),
  -- NÃO executa silenciosamente nem tenta "descontar de outro lugar" --
  -- cai pra manual_review (sem modelo de dívida nesta fase, pedido
  -- explícito).
  if v_bucket = 'blocked' then
    select coalesce(sum(amount_cents), 0) into v_remaining_blocked
      from public.marketplace_ledger_entries
      where reservation_id = p_reservation_id and bucket = 'blocked';
    if v_operator_deduction_cents > v_remaining_blocked then
      v_bucket := null;
    end if;
  else
    select available_balance_cents into v_available
      from public.get_marketplace_operator_balances(v_company_id);
    if v_operator_deduction_cents > v_available then
      v_bucket := null;
    end if;
  end if;

  v_status := case when v_bucket is null then 'manual_review' else 'pending' end;

  insert into public.marketplace_refunds (
    company_id, reservation_id, payment_id, customer_refund_cents, operator_deduction_cents,
    platform_fee_adjustment_cents, deducted_from_bucket, status, reason_code, cancelled_by_type,
    legal_override_percent_bp, legal_override_reason, legal_override_authorized_by, idempotency_key
  ) values (
    v_company_id, p_reservation_id, v_payment.id, v_calc.customer_refund_cents, v_operator_deduction_cents,
    v_calc.platform_fee_adjustment_cents, v_bucket, v_status, p_reason_code, v_cancelled_by_type,
    p_legal_override_percent_bp, p_legal_override_reason,
    case when p_legal_override_percent_bp is not null then auth.uid() else null end,
    p_idempotency_key
  )
  returning marketplace_refunds.id into v_new_id;

  if v_bucket is not null then
    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id, reservation_id)
    values
      (v_company_id, 'customer_refund_reserved', v_bucket, -v_operator_deduction_cents, 'refund', v_new_id, p_reservation_id),
      (v_company_id, 'customer_refund_reserved', 'refund_pending', v_operator_deduction_cents, 'refund', v_new_id, p_reservation_id);
  end if;

  return query select v_new_id, v_status, v_calc.customer_refund_cents, v_operator_deduction_cents, false;
end;
$$;

revoke all on function public.create_marketplace_refund_request(uuid, text, text, int, text) from public, anon, authenticated, service_role;
grant execute on function public.create_marketplace_refund_request(uuid, text, text, int, text) to authenticated;
