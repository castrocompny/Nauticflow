-- Próxima etapa financeira do marketplace ToursFlow: cancelamento, no-show,
-- outcome da reserva, fonte real de política de cancelamento por passeio, e
-- motor de reembolso em DUAS FASES (reserva o impacto no ledger -> só depois,
-- numa chamada separada, fecha como completed/failed) -- preparado pra
-- quando existir uma integração real e ASSÍNCRONA com o provider (Fase
-- futura), nunca síncrona. NENHUM estorno real, NENHUMA chamada ao Asaas
-- acontece por causa desta migration. Ver docs/adr/0004-marketplace-
-- cancellation-no-show-refund-policy.md para a decisão completa.
--
-- NÃO editar 0052/0053/0054 (nenhuma ainda aplicada) -- migration nova,
-- mesmo padrão de sempre. Duas funções de 0053 são ESTENDIDAS aqui via
-- `create or replace function` com A MESMA assinatura (nunca editando o
-- arquivo 0053 em si): record_marketplace_payment_confirmed (passa a
-- congelar também a política de cancelamento) e
-- release_marketplace_reservation_balance (passa a recusar liberar enquanto
-- existir reembolso pendente pra mesma reserva).

-- ============================================================================
-- FONTE REAL DA POLÍTICA DE CANCELAMENTO -- ACHADO IMPORTANTE desta revisão:
-- tours.cancellation_policy JÁ EXISTE (migration 0039) -- mas é um campo de
-- TEXTO LIVRE de marketing (mesma família de tours.included/not_included,
-- mostrado pro cliente final na página pública do passeio) -- NUNCA a
-- estrutura de faixas usada pelo motor de reembolso. Não confundir os dois,
-- não reaproveitar a coluna existente -- coluna NOVA, nome
-- deliberadamente diferente.
-- ============================================================================

alter table public.tours
  add column if not exists marketplace_refund_policy jsonb;

comment on column public.tours.marketplace_refund_policy is
  'Política de cancelamento ESTRUTURADA (faixas hoursBeforeDeparture -> customerRefundPercentBasisPoints, ver CancellationPolicy em src/lib/marketplace-ledger.ts), usada SÓ pelo motor de reembolso do marketplace. NÃO é tours.cancellation_policy (texto livre de marketing, migration 0039, mostrado na página pública) -- são dois campos DIFERENTES de propósito, não confundir. NULL = sem política configurada (refund falha fechado até existir).';

-- Espelha isValidCancellationPolicy (src/lib/marketplace-ledger.ts) --
-- mesmo contrato de manutenção de sempre.
create or replace function public.is_valid_marketplace_refund_policy(p_policy jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_tiers jsonb;
  v_tier jsonb;
  v_prev_hours numeric := null;
  v_hours numeric;
  v_pct numeric;
begin
  if p_policy is null then
    return false;
  end if;
  if jsonb_typeof(p_policy -> 'tiers') is distinct from 'array' then
    return false;
  end if;

  v_tiers := p_policy -> 'tiers';
  if jsonb_array_length(v_tiers) = 0 then
    return false;
  end if;

  for v_tier in select * from jsonb_array_elements(v_tiers)
  loop
    if jsonb_typeof(v_tier -> 'hoursBeforeDeparture') is distinct from 'number'
      or jsonb_typeof(v_tier -> 'customerRefundPercentBasisPoints') is distinct from 'number' then
      return false;
    end if;

    v_hours := (v_tier ->> 'hoursBeforeDeparture')::numeric;
    v_pct := (v_tier ->> 'customerRefundPercentBasisPoints')::numeric;

    if v_hours < 0 then
      return false;
    end if;
    if v_pct <> trunc(v_pct) or v_pct < 0 or v_pct > 10000 then
      return false;
    end if;
    -- estritamente decrescente -- evita faixas ambíguas/sobrepostas
    if v_prev_hours is not null and v_hours >= v_prev_hours then
      return false;
    end if;
    v_prev_hours := v_hours;
  end loop;

  return true;
end;
$$;

revoke all on function public.is_valid_marketplace_refund_policy(jsonb) from public, anon, authenticated, service_role;

create or replace function public.check_marketplace_refund_policy_guard()
returns trigger
language plpgsql
as $$
begin
  if new.marketplace_refund_policy is not null and not public.is_valid_marketplace_refund_policy(new.marketplace_refund_policy) then
    raise exception 'INVALID_REFUND_POLICY';
  end if;
  return new;
end;
$$;

create trigger trg_tours_marketplace_refund_policy_guard
  before insert or update of marketplace_refund_policy on public.tours
  for each row execute function public.check_marketplace_refund_policy_guard();

revoke all on function public.check_marketplace_refund_policy_guard() from public, anon, authenticated;

-- ============================================================================
-- OUTCOME DA RESERVA -- não duplica reservations.status (status='cancelada'
-- já representa cancelamento -- outcome cobre só o que falta: o que
-- aconteceu com uma reserva CONFIRMADA depois da saída). NULL = ainda não
-- determinado (saída não aconteceu, ou aconteceu mas ninguém marcou ainda).
-- ============================================================================

alter table public.reservations
  add column if not exists outcome text check (outcome is null or outcome in ('completed', 'no_show'));

comment on column public.reservations.outcome is
  'Resultado operacional da reserva DEPOIS da saída -- completed ou no_show. NUNCA usar pra representar cancelamento -- isso já é reservations.status=''cancelada''. NULL = ainda não determinado.';

create or replace function public.set_marketplace_reservation_outcome(
  p_reservation_id uuid,
  p_outcome text
) returns table (
  id uuid,
  outcome text,
  is_override boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_reservation record;
  v_departure record;
  v_service_at timestamptz;
  v_is_override boolean := false;
begin
  select p.company_id, p.role into v_company_id, v_role
    from public.profiles p
    where p.id = auth.uid();

  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;
  -- staff pode registrar (mesmo corte de check-in/embarque, já existente) --
  -- alterar um outcome JÁ definido pra outro valor exige super_admin (ver
  -- abaixo) -- proteção contra "operador marca no-show cedo pra tentar
  -- acelerar receita" incluir mudar de ideia livremente depois.
  if v_role not in ('company_admin', 'staff', 'super_admin') then
    raise exception 'FORBIDDEN';
  end if;

  if p_outcome not in ('completed', 'no_show') then
    raise exception 'INVALID_OUTCOME';
  end if;

  select r.id, r.status, r.company_id, r.departure_id, r.outcome
    into v_reservation
    from public.reservations r
    where r.id = p_reservation_id;

  if not found or v_reservation.company_id <> v_company_id then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_reservation.status <> 'confirmada' then
    raise exception 'BOOKING_NOT_CONFIRMED';
  end if;

  if v_reservation.outcome is not null and v_reservation.outcome <> p_outcome then
    if v_role <> 'super_admin' then
      raise exception 'FORBIDDEN_OUTCOME_OVERRIDE';
    end if;
    v_is_override := true;
  end if;

  select d.departs_at into v_departure
    from public.departures d
    where d.id = v_reservation.departure_id;

  if not found then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  -- REVISÃO 0055: se existir pagamento marketplace confirmado, o relógio de
  -- verdade é service_at_snapshot (imutável) -- NUNCA departs_at ao vivo,
  -- mesmo motivo já usado em release_marketplace_reservation_balance (0053).
  -- Sem pagamento (reserva fora do marketplace, sem snapshot), usa departs_at
  -- diretamente -- não existe outra fonte pra essas.
  select pay.service_at_snapshot into v_service_at
    from public.payments pay
    where pay.reservation_id = p_reservation_id and pay.status = 'paid'
    order by pay.created_at desc
    limit 1;

  if v_service_at is null then
    v_service_at := v_departure.departs_at;
  end if;

  -- nunca permite completed/no_show ANTES do horário real da saída -- fecha
  -- o vetor "marcar cedo pra acelerar o relógio D+1" (o D+1 em si conta do
  -- pagamento, não do outcome, mas o outcome tampouco deveria poder mentir
  -- sobre o passeio já ter acontecido).
  if now() < v_service_at then
    raise exception 'OUTCOME_TOO_EARLY';
  end if;

  update public.reservations set outcome = p_outcome where id = p_reservation_id;

  return query select p_reservation_id, p_outcome, v_is_override;
end;
$$;

revoke all on function public.set_marketplace_reservation_outcome(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_marketplace_reservation_outcome(uuid, text) to authenticated;

-- ============================================================================
-- LEDGER: novo bucket (refund_pending, espelha withdrawal_pending) + novos
-- entry_types pro ciclo de vida em DUAS FASES do reembolso. Os check
-- constraints de bucket/entry_type foram criados INLINE em 0053 sem nome
-- explícito -- Postgres nomeia automaticamente como
-- "<tabela>_<coluna>_check" quando não há CONSTRAINT nomeada (comportamento
-- documentado e determinístico) -- por isso dá pra alterar aqui com
-- segurança, mesmo sem editar o arquivo 0053.
-- ============================================================================

alter table public.marketplace_ledger_entries
  drop constraint marketplace_ledger_entries_bucket_check;
alter table public.marketplace_ledger_entries
  add constraint marketplace_ledger_entries_bucket_check
  check (bucket in ('blocked', 'available', 'withdrawal_pending', 'transferred', 'platform_revenue', 'refund_pending'));

alter table public.marketplace_ledger_entries
  drop constraint marketplace_ledger_entries_entry_type_check;
alter table public.marketplace_ledger_entries
  add constraint marketplace_ledger_entries_entry_type_check
  check (entry_type in (
    'operator_blocked', 'operator_released', 'platform_fee', 'customer_refund',
    'withdrawal_reserved', 'withdrawal_completed', 'withdrawal_failed',
    'customer_refund_reserved', 'customer_refund_completed', 'customer_refund_failed'
  ));

comment on table public.marketplace_ledger_entries is
  'Livro-razão do marketplace: append-only (sem UPDATE/DELETE pra ninguém, nem service_role -- só as RPCs desta e das migrations 0053/0055, via SECURITY DEFINER, inserem). Saldo nunca é um valor armazenado -- sempre derivado via SUM(amount_cents) agrupado por bucket, ver get_marketplace_operator_balances(). Reembolso (0055) usa o mesmo padrão de duas fases do saque: customer_refund_reserved (blocked/available -> refund_pending) seguido de customer_refund_completed (sai do sistema) ou customer_refund_failed (volta pro bucket de origem). O entry_type customer_refund (singular, 0053) fica preservado só como histórico -- nenhum código novo o gera mais.';

-- ============================================================================
-- CÁLCULO PURO DO REEMBOLSO -- espelha calculateRefund()
-- (src/lib/marketplace-ledger.ts) linha por linha. Único lugar em SQL que
-- calcula isto -- create_marketplace_refund_request e
-- calculate_marketplace_refund_preview chamam esta função, nunca duplicam a
-- fórmula.
-- ============================================================================

create or replace function public.calculate_marketplace_refund_amounts(
  p_paid_amount_cents int,
  p_operator_amount_cents int,
  p_service_at timestamptz,
  p_cancelled_at timestamptz,
  p_policy_snapshot jsonb,
  p_reservation_outcome text,
  p_legal_override_percent_bp int
) returns table (
  customer_refund_cents int,
  operator_compensation_cents int,
  platform_fee_adjustment_cents int
)
language plpgsql
immutable
as $$
declare
  v_refund_bp int;
  v_hours_before numeric;
  v_tier jsonb;
  v_platform_fee_cents int;
  v_customer_refund_cents int;
  v_platform_fee_adjustment_cents int;
  v_operator_deduction_cents int;
  v_operator_compensation_cents int;
begin
  if p_paid_amount_cents is null or p_paid_amount_cents < 0 then
    raise exception 'INVALID_PAID_AMOUNT';
  end if;
  if p_operator_amount_cents is null or p_operator_amount_cents < 0 or p_operator_amount_cents > p_paid_amount_cents then
    raise exception 'INVALID_OPERATOR_AMOUNT';
  end if;
  if p_reservation_outcome not in ('completed', 'no_show', 'cancelled') then
    raise exception 'INVALID_RESERVATION_OUTCOME';
  end if;

  -- obrigação legal sempre vence a política comercial -- nunca o contrário
  -- (mesma regra de calculateRefund).
  if p_legal_override_percent_bp is not null then
    v_refund_bp := p_legal_override_percent_bp;
  elsif p_reservation_outcome = 'completed' then
    v_refund_bp := 0;
  else
    if not public.is_valid_marketplace_refund_policy(p_policy_snapshot) then
      raise exception 'INVALID_POLICY_SNAPSHOT';
    end if;
    if p_cancelled_at is null or p_service_at is null then
      raise exception 'MISSING_TIMESTAMPS';
    end if;

    v_hours_before := extract(epoch from (p_service_at - p_cancelled_at)) / 3600.0;
    v_refund_bp := 0;
    for v_tier in select * from jsonb_array_elements(p_policy_snapshot -> 'tiers')
    loop
      if v_hours_before >= (v_tier ->> 'hoursBeforeDeparture')::numeric then
        v_refund_bp := (v_tier ->> 'customerRefundPercentBasisPoints')::int;
        exit;
      end if;
    end loop;
  end if;

  if v_refund_bp is null or v_refund_bp < 0 or v_refund_bp > 10000 then
    raise exception 'INVALID_REFUND_PERCENT';
  end if;

  v_customer_refund_cents := floor((p_paid_amount_cents::bigint * v_refund_bp) / 10000);
  -- comissão da plataforma derivada, nunca passada -- mesmo motivo de
  -- calculateRefund.
  v_platform_fee_cents := p_paid_amount_cents - p_operator_amount_cents;
  v_platform_fee_adjustment_cents := floor((v_platform_fee_cents::bigint * v_refund_bp) / 10000);
  v_operator_deduction_cents := v_customer_refund_cents - v_platform_fee_adjustment_cents;
  v_operator_compensation_cents := p_operator_amount_cents - v_operator_deduction_cents;

  return query select v_customer_refund_cents, v_operator_compensation_cents, v_platform_fee_adjustment_cents;
end;
$$;

revoke all on function public.calculate_marketplace_refund_amounts(int, int, timestamptz, timestamptz, jsonb, text, int) from public, anon, authenticated, service_role;

-- Deriva reservationOutcome ('completed'|'no_show'|'cancelled') a partir do
-- estado real da reserva -- NUNCA aceito como parâmetro de fora (mesmo
-- espírito de service_at_snapshot: autoridade sempre derivada pelo banco).
-- status='cancelada' -> 'cancelled' (não duplica outcome); senão usa
-- reservations.outcome; se nenhum dos dois, indeterminado (fail closed).
create or replace function public.derive_marketplace_reservation_outcome(p_reservation_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_status text;
  v_outcome text;
begin
  select status, outcome into v_status, v_outcome from public.reservations where id = p_reservation_id;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_status = 'cancelada' then
    return 'cancelled';
  end if;
  if v_outcome in ('completed', 'no_show') then
    return v_outcome;
  end if;
  return null;
end;
$$;

revoke all on function public.derive_marketplace_reservation_outcome(uuid) from public, anon, authenticated, service_role;

-- ============================================================================
-- PREVIEW (read-only) -- estimativa do reembolso sem criar nenhum pedido nem
-- tocar o ledger. Mesmo modelo de confiança authenticated + auth.uid() das
-- RPCs de payout (0054).
-- ============================================================================

create or replace function public.calculate_marketplace_refund_preview(
  p_reservation_id uuid,
  p_at timestamptz default now()
) returns table (
  customer_refund_cents int,
  operator_compensation_cents int,
  platform_fee_adjustment_cents int,
  reservation_outcome text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_reservation_company_id uuid;
  v_payment record;
  v_outcome text;
begin
  select p.company_id, p.role into v_company_id, v_role
    from public.profiles p
    where p.id = auth.uid();

  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;
  if v_role not in ('company_admin', 'staff', 'super_admin') then
    raise exception 'FORBIDDEN';
  end if;

  select r.company_id into v_reservation_company_id from public.reservations r where r.id = p_reservation_id;
  if not found or v_reservation_company_id <> v_company_id then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  select pay.amount_cents, pay.operator_amount_cents, pay.service_at_snapshot, pay.cancellation_policy_snapshot
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

  return query select cr.customer_refund_cents, cr.operator_compensation_cents, cr.platform_fee_adjustment_cents, v_outcome
    from public.calculate_marketplace_refund_amounts(
      v_payment.amount_cents, v_payment.operator_amount_cents, v_payment.service_at_snapshot,
      p_at, v_payment.cancellation_policy_snapshot, v_outcome, null
    ) cr;
end;
$$;

revoke all on function public.calculate_marketplace_refund_preview(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.calculate_marketplace_refund_preview(uuid, timestamptz) to authenticated;

-- ============================================================================
-- PEDIDO DE REEMBOLSO -- entidade com ciclo de vida (pending/processing/
-- completed/failed/manual_review), igual a marketplace_withdrawals (0053).
-- Restrito a company_admin/super_admin (mutação financeira -- mesmo corte de
-- payout accounts, 0054 -- staff não mexe em dinheiro, só em outcome/
-- check-in).
-- ============================================================================

create table public.marketplace_refunds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete restrict,
  customer_refund_cents int not null check (customer_refund_cents >= 0),
  operator_deduction_cents int not null check (operator_deduction_cents >= 0),
  platform_fee_adjustment_cents int not null check (platform_fee_adjustment_cents >= 0),
  -- de onde o valor foi reservado -- NULL enquanto manual_review (não foi
  -- deduzido de lugar nenhum ainda, porque não cabia em blocked nem em
  -- available).
  deducted_from_bucket text check (deducted_from_bucket is null or deducted_from_bucket in ('blocked', 'available')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'manual_review')),
  -- vocabulário FECHADO -- nunca uma string livre vinda do browser.
  reason_code text not null check (reason_code in (
    'customer_cancellation', 'operator_cancellation', 'departure_cancelled', 'no_show_policy', 'legal_override', 'admin_manual'
  )),
  -- QUEM originou -- derivado da role de quem chamou a RPC, nunca aceito
  -- como parâmetro (mesmo motivo de nunca aceitar company_id como
  -- parâmetro). 'customer'/'system' reservados pra quando existir origem
  -- real (ToursFlow / gatilho automático) -- nenhuma RPC desta migration
  -- ainda produz esses dois valores.
  cancelled_by_type text not null check (cancelled_by_type in ('customer', 'operator', 'system', 'admin')),
  legal_override_percent_bp int check (legal_override_percent_bp is null or (legal_override_percent_bp >= 0 and legal_override_percent_bp <= 10000)),
  legal_override_reason text,
  legal_override_authorized_by uuid references public.profiles (id) on delete set null,
  provider_refund_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.marketplace_refunds (company_id);
create index on public.marketplace_refunds (reservation_id);
create unique index marketplace_refunds_idempotency_key_unique on public.marketplace_refunds (idempotency_key);

alter table public.marketplace_refunds enable row level security;
revoke all on table public.marketplace_refunds from public, anon, authenticated, service_role;

comment on table public.marketplace_refunds is
  'Pedido de reembolso do marketplace -- ENTIDADE com ciclo de vida (como marketplace_withdrawals), não append-only. O efeito financeiro de cada transição vive no ledger (marketplace_ledger_entries), nunca só aqui. Nenhum reembolso real ao provider acontece ainda -- complete_marketplace_refund_request(p_succeeded) hoje só é testável isoladamente, sem nenhum caminho de produção chamando de verdade.';

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
  select r.id, r.status, r.customer_refund_cents, r.operator_deduction_cents
    into v_existing
    from public.marketplace_refunds r
    where r.idempotency_key = p_idempotency_key;

  if found then
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

-- Fecha o ciclo de vida do reembolso -- 'completed' (provider confirmou de
-- verdade, Fase futura) ou 'failed' (devolve o valor reservado pro bucket de
-- origem). Nenhum caminho de produção chama isto ainda -- só testável
-- isoladamente, mesmo espírito de complete_marketplace_withdrawal (0053).
create or replace function public.complete_marketplace_refund_request(
  p_refund_id uuid,
  p_succeeded boolean,
  p_provider_refund_id text
) returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_r record;
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

  select id, company_id, reservation_id, status, operator_deduction_cents, deducted_from_bucket
    into v_r
    from public.marketplace_refunds
    where id = p_refund_id;

  if not found or v_r.company_id <> v_company_id then
    raise exception 'REFUND_NOT_FOUND';
  end if;

  if v_r.status not in ('pending', 'processing') then
    -- já finalizado (completed/failed) ou em manual_review -- replay
    -- idempotente, nada a fazer de novo.
    return query select v_r.id, v_r.status;
    return;
  end if;

  if p_succeeded then
    update public.marketplace_refunds
      set status = 'completed', provider_refund_id = p_provider_refund_id, updated_at = now()
      where id = p_refund_id;

    -- dinheiro sai do sistema de verdade -- sem par, mesmo espírito do
    -- customer_refund original (0053): reduz o "patrimônio do operador"
    -- total, não reclassifica entre buckets.
    if v_r.deducted_from_bucket is not null then
      insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id, reservation_id)
      values (v_r.company_id, 'customer_refund_completed', 'refund_pending', -v_r.operator_deduction_cents, 'refund', v_r.id, v_r.reservation_id)
      on conflict do nothing;
    end if;

    return query select v_r.id, 'completed'::text;
  else
    update public.marketplace_refunds
      set status = 'failed', updated_at = now()
      where id = p_refund_id;

    -- reembolso não aconteceu de verdade -- devolve o valor reservado pro
    -- bucket de origem.
    if v_r.deducted_from_bucket is not null then
      insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id, reservation_id)
      values
        (v_r.company_id, 'customer_refund_failed', 'refund_pending', -v_r.operator_deduction_cents, 'refund', v_r.id, v_r.reservation_id),
        (v_r.company_id, 'customer_refund_failed', v_r.deducted_from_bucket, v_r.operator_deduction_cents, 'refund', v_r.id, v_r.reservation_id)
      on conflict do nothing;
    end if;

    return query select v_r.id, 'failed'::text;
  end if;
end;
$$;

revoke all on function public.complete_marketplace_refund_request(uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.complete_marketplace_refund_request(uuid, boolean, text) to authenticated;

-- ============================================================================
-- EXTENSÃO de record_marketplace_payment_confirmed (0053): passa a congelar
-- também a política de cancelamento vigente no momento da confirmação, a
-- partir de tours.marketplace_refund_policy (via departure -> tour). Mesma
-- assinatura exata de 0053 -- create or replace, nunca edita o arquivo
-- original. Se o passeio não tiver política configurada ainda, o snapshot
-- fica NULL (pagamento é confirmado normalmente -- só um reembolso futuro
-- que dependeria de faixa por hora falharia fechado, ver
-- calculate_marketplace_refund_amounts).
-- ============================================================================

create or replace function public.record_marketplace_payment_confirmed(
  p_payment_id uuid,
  p_confirmed_amount_cents int
) returns table (
  payment_id uuid,
  status text,
  gross_amount_cents int,
  platform_fee_cents int,
  operator_amount_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_fee_bp int;
  v_platform_fee int;
  v_operator_amount int;
  v_service_at timestamptz;
  v_refund_policy jsonb;
begin
  select p.id, p.status, p.amount_cents, p.company_id, p.reservation_id,
         p.gross_amount_cents, p.platform_fee_cents, p.operator_amount_cents
    into v_payment
    from public.payments p
    where p.id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status = 'paid' then
    return query select v_payment.id, v_payment.status, v_payment.gross_amount_cents,
      v_payment.platform_fee_cents, v_payment.operator_amount_cents, true;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  if p_confirmed_amount_cents <> v_payment.amount_cents then
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  select fee_basis_points into v_fee_bp from public.get_current_marketplace_fee_config();
  if v_fee_bp is null then
    raise exception 'MARKETPLACE_FEE_NOT_CONFIGURED';
  end if;

  select d.departs_at, t.marketplace_refund_policy into v_service_at, v_refund_policy
    from public.departures d
    join public.reservations r on r.departure_id = d.id
    join public.tours t on t.id = d.tour_id
    where r.id = v_payment.reservation_id;

  if not found or v_service_at is null then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  v_platform_fee := floor((v_payment.amount_cents::bigint * v_fee_bp) / 10000);
  v_operator_amount := v_payment.amount_cents - v_platform_fee;

  update public.payments
    set status = 'paid',
        gross_amount_cents = v_payment.amount_cents,
        platform_fee_cents = v_platform_fee,
        operator_amount_cents = v_operator_amount,
        service_at_snapshot = v_service_at,
        -- congelado aqui, uma única vez -- mudança futura na política do
        -- passeio nunca afeta esta venda já confirmada (mesma imutabilidade
        -- do resto do conjunto de snapshots, ver trigger de 0053).
        cancellation_policy_snapshot = v_refund_policy
    where id = p_payment_id;

  insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id, reservation_id)
  values
    (v_payment.company_id, 'operator_blocked', 'blocked', v_operator_amount, 'payment', p_payment_id, v_payment.reservation_id),
    (v_payment.company_id, 'platform_fee', 'platform_revenue', v_platform_fee, 'payment', p_payment_id, v_payment.reservation_id);

  return query select p_payment_id, 'paid'::text, v_payment.amount_cents, v_platform_fee, v_operator_amount, false;
end;
$$;

revoke all on function public.record_marketplace_payment_confirmed(uuid, int) from public, anon, authenticated;
grant execute on function public.record_marketplace_payment_confirmed(uuid, int) to service_role;

-- ============================================================================
-- EXTENSÃO de release_marketplace_reservation_balance (0053): recusa liberar
-- enquanto existir um pedido de reembolso NÃO finalizado (pending/
-- processing) pra mesma reserva -- "não liberar cegamente" quando existe um
-- reembolso em curso, pedido explícito desta revisão. Mesma assinatura
-- exata de 0053.
-- ============================================================================

create or replace function public.release_marketplace_reservation_balance(
  p_reservation_id uuid
) returns table (
  reservation_id uuid,
  released_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation record;
  v_payment record;
  v_departure_status text;
  v_remaining_blocked bigint;
  v_already_released_cents bigint;
begin
  perform pg_advisory_xact_lock(hashtext('marketplace_reservation_balance'), hashtext(p_reservation_id::text));

  select amount_cents into v_already_released_cents
    from public.marketplace_ledger_entries
    where reference_type = 'release' and reference_id = p_reservation_id
      and entry_type = 'operator_released' and bucket = 'available';

  if found then
    return query select p_reservation_id, v_already_released_cents::int, true;
    return;
  end if;

  select r.id, r.status, r.company_id, r.departure_id
    into v_reservation
    from public.reservations r
    where r.id = p_reservation_id;

  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_reservation.status <> 'confirmada' then
    raise exception 'BOOKING_NOT_CONFIRMED';
  end if;

  -- REVISÃO 0055: qualquer reembolso ainda em aberto (pending/processing)
  -- pra esta reserva barra a liberação -- precisa ser resolvido (completed
  -- ou failed) primeiro. manual_review também barra (ainda não é um estado
  -- final). Only completed/failed deixam passar.
  if exists (
    select 1 from public.marketplace_refunds
    where reservation_id = p_reservation_id and status in ('pending', 'processing', 'manual_review')
  ) then
    raise exception 'REFUND_PENDING';
  end if;

  select p.id, p.status, p.operator_amount_cents, p.service_at_snapshot
    into v_payment
    from public.payments p
    where p.reservation_id = p_reservation_id
    order by p.created_at desc
    limit 1;

  if not found or v_payment.status <> 'paid' then
    raise exception 'PAYMENT_NOT_PAID';
  end if;

  select d.status into v_departure_status
    from public.departures d
    where d.id = v_reservation.departure_id;

  if not found or v_departure_status <> 'encerrada' then
    raise exception 'DEPARTURE_NOT_CONCLUDED';
  end if;

  if v_payment.service_at_snapshot is null then
    raise exception 'SERVICE_SNAPSHOT_MISSING';
  end if;

  if v_payment.service_at_snapshot + interval '24 hours' > now() then
    raise exception 'RELEASE_NOT_YET_DUE';
  end if;

  select coalesce(sum(amount_cents), 0) into v_remaining_blocked
    from public.marketplace_ledger_entries
    where reservation_id = p_reservation_id and bucket = 'blocked';

  if v_remaining_blocked <= 0 then
    raise exception 'NOTHING_TO_RELEASE';
  end if;

  begin
    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id, reservation_id)
    values
      (v_reservation.company_id, 'operator_released', 'blocked', -v_remaining_blocked, 'release', p_reservation_id, p_reservation_id),
      (v_reservation.company_id, 'operator_released', 'available', v_remaining_blocked, 'release', p_reservation_id, p_reservation_id);

    return query select p_reservation_id, v_remaining_blocked::int, false;
    return;
  exception
    when unique_violation then
      select amount_cents into v_already_released_cents
        from public.marketplace_ledger_entries
        where reference_type = 'release' and reference_id = p_reservation_id
          and entry_type = 'operator_released' and bucket = 'available';
      return query select p_reservation_id, v_already_released_cents::int, true;
      return;
  end;
end;
$$;

revoke all on function public.release_marketplace_reservation_balance(uuid) from public, anon, authenticated;
grant execute on function public.release_marketplace_reservation_balance(uuid) to service_role;
