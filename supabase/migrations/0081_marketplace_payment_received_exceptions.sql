-- ============================================================================
-- 0081 -- PAYMENT_RECEIVED do marketplace: efeito + exceção na MESMA transação,
-- fila de exceções somente leitura, e correção de mark_marketplace_payment_
-- provider_created.
--
-- O número 0081 e a migration homônima do trabalho perdido (WIP de 2026-10-20)
-- não sobreviveram como arquivo; esta migration foi reconstruída a partir do
-- comportamento decidido (docs/adr/0007) e das funções existentes (0036/0052/0059/0060).
-- Se a 0081 original for recuperada do histórico, reconciliar os nomes antes de
-- aplicar qualquer uma. Aplicada/testada somente em DB efêmero desta tarefa;
-- não aplicada no banco do projeto, Supabase remoto, staging ou produção.
--
-- O que muda:
--  1. process_marketplace_payment_received_event: único ponto de entrada do
--     webhook para PAYMENT_RECEIVED já verificado no Asaas. Sem marca de
--     dedupe: settle_marketplace_payment_received (0059) já é idempotente
--     (payment 'paid' => replay), então não existe "marca sem efeito". Para
--     payment 'failed', grava uma exceção por provider_payment_id, valida os
--     dados de replays e NÃO toca payment, reserva, ledger, saldo nem refund.
--  2. marketplace_payment_exceptions: fila somente leitura (super_admin + aal2).
--  3. mark_marketplace_payment_provider_created: mesma assinatura e mesma
--     semântica da 0059; só qualifica as colunas, porque os OUT params (id,
--     provider_payment_id) colidiam com as colunas e a função falhava sempre
--     com "column reference is ambiguous" (plpgsql.variable_conflict=error).
--
-- Fora de escopo de propósito: refunds, saques e flags ficam como estão.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fila de exceções (somente leitura para humanos)
-- ---------------------------------------------------------------------------
create table public.marketplace_payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  payment_id uuid not null references public.payments (id),
  reservation_id uuid not null references public.reservations (id),
  kind text not null,
  provider_payment_id text not null,
  confirmed_amount_cents int not null check (confirmed_amount_cents >= 0),
  expected_amount_cents int not null check (expected_amount_cents >= 0),
  detected_at timestamptz not null default now(),
  constraint marketplace_payment_exceptions_kind_check
    check (kind in ('payment_received_on_failed_payment')),
  constraint marketplace_payment_exceptions_payment_kind_key unique (payment_id, kind, provider_payment_id)
);

create index marketplace_payment_exceptions_company_idx
  on public.marketplace_payment_exceptions (company_id, detected_at desc);

alter table public.marketplace_payment_exceptions enable row level security;

-- Só super_admin com segundo fator verificado nesta sessão lê; ninguém grava
-- por policy (a única escrita é a RPC security definer abaixo). A empresa
-- dona NÃO tem acesso: o caso envolve dinheiro de terceiro ainda não conciliado.
create policy "excecoes de pagamento: super_admin aal2 le"
  on public.marketplace_payment_exceptions
  for select to authenticated
  using (public.is_super_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2');

revoke all on public.marketplace_payment_exceptions from public, anon, authenticated, service_role;
grant select on public.marketplace_payment_exceptions to authenticated;

comment on table public.marketplace_payment_exceptions is
  'Fila durável (somente leitura) de PAYMENT_RECEIVED verificado no Asaas para um payment local em failed. Registrar NÃO altera payment/reserva/ledger/saldo/refund e não chama o Asaas; a conciliação do dinheiro é humana e fora do sistema.';

-- ---------------------------------------------------------------------------
-- 2. RPC do webhook
-- ---------------------------------------------------------------------------
create or replace function public.process_marketplace_payment_received_event(
  p_internal_payment_id uuid,
  p_provider_payment_id text,
  p_confirmed_amount_cents int
) returns table (
  event_type text,
  payment_id uuid,
  outcome text,
  payment_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_settle record;
  v_inserted int;
begin
  if p_provider_payment_id is null or btrim(p_provider_payment_id) = '' then
    raise exception 'PROVIDER_PAYMENT_ID_REQUIRED';
  end if;
  if p_confirmed_amount_cents is null or p_confirmed_amount_cents < 0 then
    raise exception 'INVALID_CONFIRMED_AMOUNT';
  end if;

  -- Trava a linha: a decisão "failed ou não" e o settle abaixo enxergam o mesmo
  -- estado. Chamadas para o mesmo payment são serializadas por este lock.
  select p.id, p.status, p.company_id, p.reservation_id, p.amount_cents, p.provider_payment_id
    into v_payment
    from public.payments p
    where p.id = p_internal_payment_id
    for update of p;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status = 'failed' then
    -- Um payment local pode corresponder a mais de uma cobrança Asaas (por
    -- exemplo, POST ambíguo/repetido). Não colapse cobranças distintas numa
    -- única exceção. Para o mesmo provider ID, só reconheça replay se os dados
    -- financeiros e a associação local forem idênticos.
    insert into public.marketplace_payment_exceptions (
      company_id, payment_id, reservation_id, kind, provider_payment_id, confirmed_amount_cents, expected_amount_cents
    ) values (
      v_payment.company_id, v_payment.id, v_payment.reservation_id, 'payment_received_on_failed_payment',
      p_provider_payment_id, p_confirmed_amount_cents, v_payment.amount_cents
    )
    on conflict on constraint marketplace_payment_exceptions_payment_kind_key do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted = 0 and not exists (
      select 1
        from public.marketplace_payment_exceptions e
        where e.payment_id = v_payment.id
          and e.kind = 'payment_received_on_failed_payment'
          and e.provider_payment_id = p_provider_payment_id
          and e.company_id = v_payment.company_id
          and e.reservation_id = v_payment.reservation_id
          and e.confirmed_amount_cents = p_confirmed_amount_cents
          and e.expected_amount_cents = v_payment.amount_cents
    ) then
      raise exception 'PAYMENT_RECEIVED_EXCEPTION_MISMATCH';
    end if;

    return query select 'PAYMENT_RECEIVED'::text, v_payment.id,
      case when v_inserted > 0 then 'exception_recorded' else 'exception_existing' end, 'failed'::text;
    return;
  end if;

  if v_payment.provider_payment_id is not null and v_payment.provider_payment_id <> p_provider_payment_id then
    raise exception 'PROVIDER_PAYMENT_ID_MISMATCH';
  end if;

  -- refunded/partially_refunded só existem depois de 'paid': reentrega tardia
  -- de PAYMENT_RECEIVED é replay, sem efeito (e sem mexer na semântica de refund).
  if v_payment.status in ('refunded', 'partially_refunded') then
    return query select 'PAYMENT_RECEIVED'::text, v_payment.id, 'settled_replay'::text, v_payment.status;
    return;
  end if;

  select * into v_settle
    from public.settle_marketplace_payment_received(p_internal_payment_id, p_provider_payment_id, p_confirmed_amount_cents);

  return query select 'PAYMENT_RECEIVED'::text, p_internal_payment_id,
    case
      when v_settle.requires_manual_review then 'manual_review'
      when v_settle.is_replay then 'settled_replay'
      else 'settled'
    end,
    v_settle.status;
end;
$$;

revoke all on function public.process_marketplace_payment_received_event(uuid, text, int) from public, anon, authenticated;
grant execute on function public.process_marketplace_payment_received_event(uuid, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. mark_marketplace_payment_provider_created -- só qualifica colunas
-- ---------------------------------------------------------------------------
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
  select p.provider_payment_id into v_existing from public.payments p where p.id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  if v_existing is not null and v_existing <> p_provider_payment_id then
    raise exception 'PROVIDER_PAYMENT_ID_MISMATCH';
  end if;

  update public.payments p set provider_payment_id = p_provider_payment_id where p.id = p_payment_id;

  return query select p_payment_id, p_provider_payment_id;
end;
$$;

revoke all on function public.mark_marketplace_payment_provider_created(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_marketplace_payment_provider_created(uuid, text) to service_role;
