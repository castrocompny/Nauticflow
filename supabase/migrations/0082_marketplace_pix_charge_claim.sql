-- ============================================================================
-- 0082 -- Reserva durável (claim) ANTES do POST /payments da cobrança Pix do
-- marketplace. Fecha o risco registrado no ADR 0007: a consulta por
-- externalReference que retorna zero levava a um novo POST; se o POST anterior
-- tivesse sido aceito e a gravação local do id falhasse, o retry podia criar
-- outra cobrança.
--
-- NADA aqui assume que o Asaas é idempotente em `/payments`: nenhuma garantia de
-- unicidade/idempotência por externalReference foi verificada. A proteção é
-- inteiramente nossa: só UM chamador recebe permissão de POST por pagamento, e
-- qualquer retry sem provider_payment_id persistido é BLOQUEADO para
-- reconciliação manual -- nunca dispara um segundo POST sozinho.
--
-- Reconstruída para esta worktree, não recuperada literalmente do trabalho
-- perdido. Validada somente no DB efêmero desta tarefa; a migration e a
-- chain completa não foram aplicadas/validadas no banco do projeto, Supabase
-- remoto, staging ou produção. Consulte ADR 0007 para limites da validação.
--
-- Não toca ledger, saldo, saque, refund, webhook nem status de pagamento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Marca durável da tentativa de envio
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists provider_charge_claimed_at timestamptz;

-- Pagamentos pending sem ID que já existiam quando este protocolo é ativado
-- têm histórico de envio desconhecido: podem ter sido enviados por uma versão
-- anterior da rota. Conservadoramente, reservamos todos para revisão manual;
-- não assumimos que nunca houve POST. Pagamentos novos ficam NULL até a RPC
-- claim ser chamada imediatamente antes do primeiro POST.
update public.payments p
set provider_charge_claimed_at = now()
where p.status = 'pending'
  and p.provider_payment_id is null
  and p.provider_charge_claimed_at is null;

comment on column public.payments.provider_charge_claimed_at is
  'Gravada ANTES do POST /payments. Para pagamentos anteriores à migration, pending + sem provider_payment_id é conservadoramente marcado para revisão manual. Marca preenchida + provider_payment_id nulo = resultado do envio INCERTO: bloqueado, só reconciliação manual. Nunca é limpa automaticamente.';

-- ---------------------------------------------------------------------------
-- 2. RPC de claim -- única fonte de permissão para o primeiro POST
-- ---------------------------------------------------------------------------
-- outcome:
--   'claimed' -> este chamador, e só ele, pode fazer o POST
--   'linked'  -> provider_payment_id já persistido: reutilizar, sem POST
--   'blocked' -> já reservado e sem id: incerto, reconciliação manual, sem POST
-- A decisão e a gravação acontecem sob FOR UPDATE na mesma transação.
create or replace function public.claim_marketplace_pix_charge_creation(p_payment_id uuid)
returns table (outcome text, provider_payment_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
begin
  select p.status, p.provider_payment_id, p.provider_charge_claimed_at
    into v_payment
    from public.payments p
    where p.id = p_payment_id
    for update of p;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.provider_payment_id is not null then
    return query select 'linked'::text, v_payment.provider_payment_id;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  if v_payment.provider_charge_claimed_at is not null then
    return query select 'blocked'::text, null::text;
    return;
  end if;

  update public.payments p set provider_charge_claimed_at = now() where p.id = p_payment_id;

  return query select 'claimed'::text, null::text;
end;
$$;

revoke all on function public.claim_marketplace_pix_charge_creation(uuid) from public, anon, authenticated;
grant execute on function public.claim_marketplace_pix_charge_creation(uuid) to service_role;

comment on function public.claim_marketplace_pix_charge_creation(uuid) is
  'Reserva atômica (FOR UPDATE) da permissão para o primeiro POST /payments de um pagamento marketplace. claimed = pode enviar (uma única vez); linked = id do provedor já persistido; blocked = já reservado sem id (incerto, reconciliação manual). Nunca libera sozinha.';

-- ---------------------------------------------------------------------------
-- 3. cancel_marketplace_pending_payment (0060): mesma assinatura e semântica,
--    mais UM guard -- não cancela (não libera o slot de
--    payments_one_active_per_reservation) um pagamento reservado sem
--    provider_payment_id. Sem isto, a expiração do hold reabriria o caminho para
--    uma nova tentativa (novo payment id => novo externalReference) enquanto a
--    cobrança anterior pode existir no Asaas.
-- ---------------------------------------------------------------------------
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
  select p.id, p.status, p.reservation_id, p.provider_payment_id, p.provider_charge_claimed_at into v_payment
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

  if v_payment.provider_payment_id is null and v_payment.provider_charge_claimed_at is not null then
    -- envio incerto: não libera o slot, só reconciliação manual.
    return query select p_payment_id, v_payment.status, false;
    return;
  end if;

  -- A reserva do claim pode ocorrer depois do SELECT do payment e enquanto a
  -- leitura do hold abaixo espera por outra transação. O UPDATE final compara
  -- provider_payment_id e provider_charge_claimed_at com este snapshot para
  -- nunca cancelar uma tentativa que ganhou essa corrida.

  select r.hold_expires_at into v_hold_expires_at
    from public.reservations r
    where r.id = v_payment.reservation_id;

  if v_hold_expires_at is null or v_hold_expires_at > now() then
    raise exception 'HOLD_STILL_VALID';
  end if;

  -- Snapshot otimista para não sobrescrever claim concorrente. Se o claim
  -- vencer depois do SELECT acima e antes deste UPDATE, o UPDATE espera pela
  -- linha e reavalia a condição; como a marca mudou, não cancela nem libera o
  -- slot. Se este UPDATE vencer primeiro, claim aguardará e verá status !=
  -- pending. Isso preserva a corrida PAYMENT_RECEIVED: status também continua
  -- protegido pela condição atômica original.
  update public.payments p
     set status = 'failed'
   where p.id = p_payment_id
     and p.status = 'pending'
     and p.provider_payment_id is not distinct from v_payment.provider_payment_id
     and p.provider_charge_claimed_at is not distinct from v_payment.provider_charge_claimed_at;

  select p.status into v_final_status from public.payments p where p.id = p_payment_id;
  return query select p_payment_id, v_final_status, (v_final_status = 'failed');
end;
$$;

revoke all on function public.cancel_marketplace_pending_payment(uuid) from public, anon, authenticated;
grant execute on function public.cancel_marketplace_pending_payment(uuid) to service_role;

comment on function public.cancel_marketplace_pending_payment(uuid) is
  'Cancela (marca failed) uma cobrança marketplace ainda pending cujo hold já venceu. Race-safe: nunca sobrescreve um status já mudado pra paid por settle_marketplace_payment_received. NÃO cancela um pagamento com provider_charge_claimed_at e sem provider_payment_id (envio incerto, 0082): devolve was_cancelled=false e mantém o slot ocupado até reconciliação manual. Uma vez failed, payments_one_active_per_reservation (0052) libera a reserva pra uma NOVA tentativa de pagamento -- nunca ressuscita o hold antigo.';
