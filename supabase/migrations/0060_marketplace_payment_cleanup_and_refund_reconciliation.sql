-- Fechamento financeiro final: cobrança Pix pending após hold expirado +
-- correlação de refund events do Asaas. NENHUMA transferência/estorno real
-- acontece por causa desta migration -- só schema + RPCs testáveis
-- isoladamente. Ver docs/adr/0007-marketplace-pix-payment-settlement.md
-- (seções novas) e docs/adr/0004-marketplace-cancellation-no-show-refund-
-- policy.md (seção nova) para a decisão completa.
--
-- NÃO editar 0052-0059 (nenhuma ainda aplicada) -- migration nova.

-- ============================================================================
-- CANCELAMENTO DE COBRANÇA PENDING -- reusa payments.status='failed'
-- (nenhum estado novo inventado, "auditar modelo atual" confirmou que
-- 'failed' já cobre semanticamente "esta tentativa nunca virou uma cobrança
-- paga"). RACE-SAFE por construção: a transição só acontece via `UPDATE ...
-- WHERE status = 'pending'`, cuja atomicidade do Postgres garante que, se
-- settle_marketplace_payment_received (0059) vencer a corrida e mudar o
-- status pra 'paid' primeiro, esta função NUNCA sobrescreve isso -- o
-- UPDATE simplesmente não casa nenhuma linha, e o status final devolvido
-- reflete a REALIDADE (paid), nunca um cancelamento fantasma por cima de um
-- pagamento recebido. MESMA função usada tanto pro cleanup de hold expirado
-- quanto pra reconciliar PAYMENT_DELETED (webhook) -- um único caminho de
-- cancelamento interno, nunca dois.
-- ============================================================================

create or replace function public.cancel_marketplace_pending_payment(p_payment_id uuid)
returns table (id uuid, status text, was_cancelled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_hold_expires_at timestamptz;
  v_final_status text;
begin
  select p.id, p.status, p.reservation_id into v_payment
    from public.payments p
    where p.id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status <> 'pending' then
    -- idempotente -- já não estava mais pending (cancelado antes, ou
    -- liquidado por PAYMENT_RECEIVED enquanto isto foi decidido) -- devolve
    -- o estado REAL, nunca erro.
    return query select p_payment_id, v_payment.status, false;
    return;
  end if;

  select r.hold_expires_at into v_hold_expires_at
    from public.reservations r
    where r.id = v_payment.reservation_id;

  if v_hold_expires_at is null or v_hold_expires_at > now() then
    raise exception 'HOLD_STILL_VALID';
  end if;

  -- checagem ATÔMICA de verdade -- se settle_marketplace_payment_received
  -- venceu a corrida entre o SELECT acima e este UPDATE, esta linha
  -- simplesmente não casa (0 linhas afetadas).
  update public.payments set status = 'failed' where id = p_payment_id and status = 'pending';

  select status into v_final_status from public.payments where id = p_payment_id;
  return query select p_payment_id, v_final_status, (v_final_status = 'failed');
end;
$$;

revoke all on function public.cancel_marketplace_pending_payment(uuid) from public, anon, authenticated;
grant execute on function public.cancel_marketplace_pending_payment(uuid) to service_role;

comment on function public.cancel_marketplace_pending_payment(uuid) is
  'Cancela (marca failed) uma cobrança marketplace ainda pending cujo hold já venceu. Race-safe: nunca sobrescreve um status já mudado pra paid por settle_marketplace_payment_received. Uma vez failed, payments_one_active_per_reservation (0052) libera a reserva pra uma NOVA tentativa de pagamento -- nunca ressuscita o hold antigo, uma nova tentativa exige hold_expires_at futuro de verdade (checado dentro de create_marketplace_payment_attempt).';

-- ============================================================================
-- REFUND -- correlação segura por payment_id + provider_refund_id, NUNCA
-- por texto/reason. Um único ponto de entrada pra todos os 4 eventos de
-- estorno do Asaas (IN_PROGRESS/REFUNDED/PARTIALLY_REFUNDED/DENIED) --
-- reaproveita complete_marketplace_refund_request (0055) internamente pro
-- efeito de ledger em si (chamada interna entre funções SECURITY DEFINER
-- do mesmo dono -- funciona independente do GRANT daquela função ser só
-- pra `authenticated`, mesmo padrão já usado em toda RPC que compõe outra
-- neste projeto). NUNCA cria lançamento de ledger novo aqui dentro -- só
-- decide COMO tratar um marketplace_refunds já existente, ou registra
-- manual_review quando não há correlação confiável.
-- ============================================================================

create or replace function public.reconcile_marketplace_refund_webhook_event(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_event_type text,
  p_reported_amount_cents int
) returns table (
  refund_id uuid,
  status text,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_candidate_id uuid;
  v_candidate_status text;
  v_candidate_expected_cents int;
  v_candidate_count int;
  v_new_id uuid;
  v_unknown_key text;
begin
  if p_event_type not in ('PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUND_DENIED') then
    raise exception 'INVALID_REFUND_EVENT_TYPE';
  end if;

  select p.id, p.company_id, p.reservation_id into v_payment
    from public.payments p
    where p.id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  -- correlação 1: já vinculado por provider_refund_id (evento repetido, ou
  -- um evento POSTERIOR do mesmo refund já identificado numa chamada
  -- anterior -- ex: IN_PROGRESS chegou primeiro e gravou o id, REFUNDED
  -- chega depois e reencontra pelo mesmo id).
  if p_provider_refund_id is not null then
    select id, status, customer_refund_cents into v_candidate_id, v_candidate_status, v_candidate_expected_cents
      from public.marketplace_refunds
      where payment_id = p_payment_id and provider_refund_id = p_provider_refund_id
      limit 1;
  end if;

  -- correlação 2: exatamente UM pedido nosso em aberto (pending/processing)
  -- pra este payment -- só serve como correlação quando inequívoco.
  if v_candidate_id is null then
    select count(*) into v_candidate_count
      from public.marketplace_refunds
      where payment_id = p_payment_id and status in ('pending', 'processing');

    if v_candidate_count = 1 then
      select id, status, customer_refund_cents into v_candidate_id, v_candidate_status, v_candidate_expected_cents
        from public.marketplace_refunds
        where payment_id = p_payment_id and status in ('pending', 'processing')
        limit 1;

      if p_provider_refund_id is not null then
        update public.marketplace_refunds set provider_refund_id = p_provider_refund_id
          where id = v_candidate_id and provider_refund_id is null;
      end if;
    end if;
  end if;

  -- SEM correlação confiável (0 ou >1 candidatos) -- NUNCA inventa
  -- lançamento, NUNCA mexe em saldo. Registra manual_review, idempotente
  -- por (payment_id, provider_refund_id ou event_type) -- webhook reenviado
  -- não cria uma segunda linha.
  if v_candidate_id is null then
    v_unknown_key := 'unknown-refund-' || p_payment_id::text || '-' || coalesce(p_provider_refund_id, p_event_type);

    insert into public.marketplace_refunds (
      company_id, reservation_id, payment_id, customer_refund_cents, operator_deduction_cents,
      platform_fee_adjustment_cents, deducted_from_bucket, status, reason_code, cancelled_by_type,
      provider_refund_id, idempotency_key
    ) values (
      v_payment.company_id, v_payment.reservation_id, v_payment.id,
      coalesce(p_reported_amount_cents, 0), 0, 0, null, 'manual_review', 'settlement_exception', 'system',
      p_provider_refund_id, v_unknown_key
    )
    on conflict (idempotency_key) do nothing
    returning id into v_new_id;

    if v_new_id is null then
      select id into v_new_id from public.marketplace_refunds where idempotency_key = v_unknown_key;
    end if;

    return query select v_new_id, 'manual_review'::text, 'manual_review_created'::text;
    return;
  end if;

  -- candidato correlacionado -- age conforme o TIPO do evento.

  if p_event_type = 'PAYMENT_REFUND_IN_PROGRESS' then
    -- NÃO considera dinheiro devolvido -- o ledger que já reservou o
    -- refund (create_marketplace_refund_request, 0055) continua reservado
    -- em refund_pending, sem nenhuma mudança aqui. Só avança o status da
    -- ENTIDADE (pending -> processing), idempotente.
    if v_candidate_status = 'pending' then
      update public.marketplace_refunds set status = 'processing', updated_at = now() where id = v_candidate_id;
    end if;
    return query select v_candidate_id, 'processing'::text, 'processing'::text;
    return;
  end if;

  if p_event_type = 'PAYMENT_REFUND_DENIED' then
    -- refund negado/falhou -- nunca deixa o dinheiro preso pra sempre em
    -- refund_pending: complete_marketplace_refund_request(succeeded=false)
    -- devolve pro bucket de origem, idempotente (no-op se já finalizado).
    if v_candidate_status not in ('pending', 'processing') then
      return query select v_candidate_id, v_candidate_status, 'no_op'::text;
      return;
    end if;
    perform public.complete_marketplace_refund_request(v_candidate_id, false, null);
    return query select v_candidate_id, 'failed'::text, 'failed'::text;
    return;
  end if;

  -- PAYMENT_REFUNDED / PAYMENT_PARTIALLY_REFUNDED -- NUNCA confia
  -- cegamente no valor que o webhook reporta -- precisa bater com o que o
  -- pedido interno já esperava (customer_refund_cents, calculado no
  -- momento da criação via calculate_marketplace_refund_amounts). Diferença
  -- -> nunca finaliza, cai pra manual_review (sem duplicar).
  if p_reported_amount_cents is null or p_reported_amount_cents <> v_candidate_expected_cents then
    if v_candidate_status in ('pending', 'processing') then
      update public.marketplace_refunds set status = 'manual_review', updated_at = now() where id = v_candidate_id;
    end if;
    return query select v_candidate_id, 'manual_review'::text, 'manual_review_existing'::text;
    return;
  end if;

  if v_candidate_status not in ('pending', 'processing') then
    -- já finalizado antes (replay do webhook) -- idempotente, no-op.
    return query select v_candidate_id, v_candidate_status, 'no_op'::text;
    return;
  end if;

  perform public.complete_marketplace_refund_request(v_candidate_id, true, p_provider_refund_id);
  return query select v_candidate_id, 'completed'::text, 'completed'::text;
end;
$$;

revoke all on function public.reconcile_marketplace_refund_webhook_event(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.reconcile_marketplace_refund_webhook_event(uuid, text, text, int) to service_role;

comment on function public.reconcile_marketplace_refund_webhook_event(uuid, text, text, int) is
  'Ponto único de correlação dos 4 eventos de estorno do Asaas (PAYMENT_REFUND_IN_PROGRESS/REFUNDED/PARTIALLY_REFUNDED/DENIED) contra marketplace_refunds. Correlação por payment_id+provider_refund_id, nunca por texto/reason. Sem correlação confiável (0 ou >1 candidatos) -- ou valor divergente do esperado -- nunca mexe em saldo, sempre manual_review. Refund × withdrawal: nenhuma trava nova necessária aqui -- complete_marketplace_refund_request só move dinheiro JÁ reservado (refund_pending), nunca lê/decide sobre o saldo available ao vivo (essa checagem já aconteceu na criação do pedido, create_marketplace_refund_request, 0055) -- sem janela de corrida nova a proteger.';
