-- FASE 4B do marketplace ToursFlow: ledger financeiro append-only, saldo
-- bloqueado/disponível, liberação D+1, saque e motor de reembolso.
--
-- NENHUMA chamada real ao Asaas, NENHUM PIX, NENHUMA transferência, NENHUM
-- refund real acontece por causa desta migration -- só schema + RPCs
-- service_role-only, todas testadas isoladamente (código não conectado a
-- nenhum fluxo de produção ainda). Ver docs/adr/0002-marketplace-ledger-
-- payout-refund.md para a decisão de arquitetura completa (por que NÃO usar
-- Split Asaas imediato, modelo de bucket escolhido, D+1, etc).
--
-- NÃO editar 0052 (fundação de payments/idempotência de tentativa, ainda
-- não aplicada) -- migration nova, mesmo padrão de sempre neste projeto:
-- manter cada fase como seu próprio arquivo.

-- ============================================================================
-- COMISSÃO DA PLATAFORMA -- configuração global, versionada (nunca UPDATE:
-- uma nova comissão é uma NOVA linha, a mais recente por created_at é a
-- vigente). Ainda NÃO existe nenhuma linha aqui -- nenhum percentual
-- inventado. Enquanto vazia, pagamento marketplace permanece desabilitado
-- (MARKETPLACE_FEE_NOT_CONFIGURED).
-- ============================================================================

create table public.marketplace_fee_config (
  id uuid primary key default gen_random_uuid(),
  fee_basis_points int not null check (fee_basis_points >= 0 and fee_basis_points <= 10000),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  note text
);

alter table public.marketplace_fee_config enable row level security;
-- RLS sem nenhuma policy -- mesmo padrão de trial_history/payments -- só
-- service_role (e super_admin, ver guard abaixo) tocam nisto.
revoke all on table public.marketplace_fee_config from public, anon, authenticated;

comment on table public.marketplace_fee_config is
  'Comissão da plataforma sobre vendas do marketplace, versionada -- nunca UPDATE, uma nova comissão é uma linha nova. A vigente é sempre a mais recente (created_at desc). Vazia = pagamento marketplace permanece desabilitado, nunca assume 0% nem nenhum valor default.';

-- só service_role/super_admin podem inserir -- mesmo padrão de guard já
-- usado para asaas_wallet_id/asaas_receiver_status (migration 0052): decisão
-- de comissão é config de plataforma, não algo que um operador (nem staff)
-- deveria conseguir alterar de jeito nenhum.
create or replace function public.check_marketplace_fee_config_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_super_admin() then
    return new;
  end if;
  raise exception 'Somente o backend ou o super admin podem configurar a comissão da plataforma.';
end;
$$;

create trigger trg_marketplace_fee_config_guard
  before insert on public.marketplace_fee_config
  for each row execute function public.check_marketplace_fee_config_guard();

revoke all on function public.check_marketplace_fee_config_guard() from public, anon, authenticated;

create or replace function public.get_current_marketplace_fee_config()
returns table (fee_basis_points int)
language sql
stable
security definer
set search_path = public
as $$
  select fee_basis_points from public.marketplace_fee_config order by created_at desc limit 1;
$$;

revoke all on function public.get_current_marketplace_fee_config() from public, anon, authenticated;
grant execute on function public.get_current_marketplace_fee_config() to service_role;

-- ============================================================================
-- payments: snapshot financeiro congelado + política de cancelamento
-- congelada no momento da confirmação. NÃO são colunas append-only (payments
-- é uma ENTIDADE com ciclo de vida -- pending/paid/failed/etc -- diferente
-- do ledger abaixo, que é fatos imutáveis). Uma vez preenchidas (na
-- confirmação), gross/fee/operator NUNCA mudam depois -- uma mudança futura
-- na comissão global não afeta vendas já confirmadas.
-- ============================================================================

alter table public.payments
  add column if not exists gross_amount_cents int,
  add column if not exists platform_fee_cents int,
  add column if not exists operator_amount_cents int,
  add column if not exists cancellation_policy_snapshot jsonb,
  add column if not exists service_at_snapshot timestamptz;

-- REVISÃO FINAL 4B: departures.departs_at é MUTÁVEL (um operador pode
-- reagendar/backdatar uma saída) e por isso NUNCA pode ser a autoridade
-- financeira depois que um pagamento é confirmado. service_at_snapshot é
-- capturado UMA ÚNICA VEZ, exclusivamente dentro de
-- record_marketplace_payment_confirmed, lido diretamente da saída real da
-- reserva -- nunca aceito como parâmetro de nenhuma API/RPC (nenhum
-- "serviceAt"/"departureAt" vindo de fora tem autoridade sobre isto). Toda
-- decisão de liberação (D+1) usa este snapshot, nunca departs_at ao vivo.
comment on column public.payments.service_at_snapshot is
  'Hora da saída, CONGELADA no momento da confirmação do pagamento (record_marketplace_payment_confirmed) -- nunca departures.departs_at ao vivo. Protege a liberação D+1 contra reagendamento/backdate posterior da saída. Nunca aceito como parâmetro externo.';

alter table public.payments
  add constraint payments_amounts_balance_check
    check (
      gross_amount_cents is null
      or (platform_fee_cents is not null and operator_amount_cents is not null
          and platform_fee_cents >= 0 and operator_amount_cents >= 0
          and platform_fee_cents + operator_amount_cents = gross_amount_cents
          and service_at_snapshot is not null)
    );

comment on column public.payments.gross_amount_cents is
  'Snapshot congelado no momento da CONFIRMAÇÃO (record_marketplace_payment_confirmed) -- NULL enquanto pending. Nunca recalculado depois, mesmo que a comissão global mude.';
comment on column public.payments.cancellation_policy_snapshot is
  'Política de cancelamento aplicável a esta venda, congelada no momento da confirmação -- formato { tiers: [{ hoursBeforeDeparture, customerRefundPercentBasisPoints }] } (ver src/lib/marketplace-ledger.ts). Ainda não existe fonte real de política por passeio no produto -- fica NULL até essa fonte existir; calculateRefund() nunca deve rodar com policySnapshot ausente.';

-- INVARIANTE DE IMUTABILIDADE (DB-level, não só disciplina de código): uma
-- vez que o conjunto de snapshots financeiros é gravado (gross/fee/operator/
-- policy/service_at, todos juntos na confirmação), NENHUMA atualização
-- posterior -- de nenhuma RPC, presente ou futura -- pode alterar qualquer
-- um deles silenciosamente. Isto é intencionalmente mais rígido que "só a
-- RPC de confirmação escreve aqui": mesmo um bug futuro que tente um UPDATE
-- nestas colunas é barrado no banco.
create or replace function public.check_payments_financial_snapshot_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.gross_amount_cents is not null and (
    new.gross_amount_cents is distinct from old.gross_amount_cents
    or new.platform_fee_cents is distinct from old.platform_fee_cents
    or new.operator_amount_cents is distinct from old.operator_amount_cents
    or new.cancellation_policy_snapshot is distinct from old.cancellation_policy_snapshot
    or new.service_at_snapshot is distinct from old.service_at_snapshot
  ) then
    raise exception 'FINANCIAL_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger trg_payments_financial_snapshot_immutable
  before update on public.payments
  for each row execute function public.check_payments_financial_snapshot_immutable();

revoke all on function public.check_payments_financial_snapshot_immutable() from public, anon, authenticated;

-- ============================================================================
-- LEDGER -- append-only de verdade: sem UPDATE, sem DELETE, pra ninguém,
-- nem service_role (só INSERT). Uma correção nunca "edita" uma entrada
-- errada -- lança uma NOVA entrada compensatória (mesmo princípio contábil
-- de qualquer livro-razão real).
--
-- MODELO ESCOLHIDO (ver ADR 0002 para a comparação completa): eventos
-- semânticos com bucket explícito, não saldo por conta com +/-. Cada linha =
-- um fato: moveu X centavos pro bucket Y, por causa do motivo Z
-- (entry_type), referente a QUEM (reference_type/reference_id). "Liberar"
-- ou "sacar" nunca edita uma linha existente -- sempre insere um PAR
-- balanceado de novas linhas (débito de um bucket, crédito de outro),
-- garantindo que o total de "patrimônio do operador" (blocked + available +
-- withdrawal_pending + transferred) só muda quando dinheiro de verdade
-- entra (operator_blocked) ou sai (customer_refund) -- reclassificar entre
-- buckets nunca muda esse total.
-- ============================================================================

create table public.marketplace_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  entry_type text not null check (entry_type in (
    'operator_blocked', 'operator_released', 'platform_fee', 'customer_refund',
    'withdrawal_reserved', 'withdrawal_completed', 'withdrawal_failed'
  )),
  bucket text not null check (bucket in ('blocked', 'available', 'withdrawal_pending', 'transferred', 'platform_revenue')),
  amount_cents int not null, -- assinado: pode ser negativo (débito de um bucket)
  reference_type text not null check (reference_type in ('payment', 'release', 'withdrawal', 'refund')),
  reference_id uuid not null,
  -- REVISÃO FINAL 4B: reference_id aponta pra ids DIFERENTES conforme o
  -- entry_type (payment_id, reservation_id ou refund_id) -- isso sozinho não
  -- permite somar "quanto ainda está bloqueado PARA ESTA RESERVA" sem um join
  -- indireto. reservation_id normaliza isso: preenchido em toda entrada que
  -- nasce de uma reserva (operator_blocked/operator_released/customer_refund),
  -- NULL em entradas de saque (que são só a nível de company). É o que permite
  -- calcular o saldo bloqueado REMANESCENTE de uma reserva (depois de
  -- reembolsos parciais) em vez de reusar cegamente operator_amount_cents.
  reservation_id uuid references public.reservations (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index on public.marketplace_ledger_entries (company_id);
create index on public.marketplace_ledger_entries (reference_type, reference_id);
create index on public.marketplace_ledger_entries (reservation_id);

-- idempotência do ledger em si: nunca duas linhas com o mesmo
-- (reference_type, reference_id, entry_type, bucket) -- cobre tanto entradas
-- simples (operator_blocked: 1 linha) quanto os pares balanceados
-- (operator_released: 2 linhas, MESMO entry_type, bucket diferente --
-- diferenciadas corretamente por este índice).
create unique index marketplace_ledger_entries_idempotency_unique
  on public.marketplace_ledger_entries (reference_type, reference_id, entry_type, bucket);

alter table public.marketplace_ledger_entries enable row level security;
revoke all on table public.marketplace_ledger_entries from public, anon, authenticated, service_role;
-- nem service_role tem INSERT/UPDATE/DELETE direto -- só as RPCs abaixo
-- (SECURITY DEFINER, dono da tabela) escrevem aqui. Isso fecha até o caminho
-- "service_role insere um valor errado direto, sem passar pelas validações
-- da RPC" -- reforça que o ledger só é tocado pelo código que sabe manter o
-- balanceamento.
grant select on table public.marketplace_ledger_entries to service_role;

comment on table public.marketplace_ledger_entries is
  'Livro-razão do marketplace: append-only (sem UPDATE/DELETE pra ninguém, nem service_role -- só as RPCs desta migration, via SECURITY DEFINER, inserem). Saldo nunca é um valor armazenado -- sempre derivado via SUM(amount_cents) agrupado por bucket, ver get_marketplace_operator_balances().';

-- REVOKE explícito de INSERT direto até para o dono/postgres via ACL normal
-- não é possível (o dono sempre pode) -- a proteção real é estas serem as
-- ÚNICAS funções SECURITY DEFINER que escrevem aqui, e nenhuma delas expõe
-- um jeito de inserir uma linha "solta" fora de um par balanceado.

-- ============================================================================
-- SALDOS DERIVADOS -- nunca armazenados, sempre SUM ao vivo. Sem cache/
-- materialização nesta fase (não necessário ainda, ver auditoria).
-- ============================================================================

create or replace function public.get_marketplace_operator_balances(p_company_id uuid)
returns table (
  blocked_balance_cents bigint,
  available_balance_cents bigint,
  pending_withdrawal_cents bigint,
  transferred_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount_cents) filter (where bucket = 'blocked'), 0)::bigint,
    coalesce(sum(amount_cents) filter (where bucket = 'available'), 0)::bigint,
    coalesce(sum(amount_cents) filter (where bucket = 'withdrawal_pending'), 0)::bigint,
    coalesce(sum(amount_cents) filter (where bucket = 'transferred'), 0)::bigint
  from public.marketplace_ledger_entries
  where company_id = p_company_id;
$$;

revoke all on function public.get_marketplace_operator_balances(uuid) from public, anon, authenticated;
grant execute on function public.get_marketplace_operator_balances(uuid) to service_role;

-- ============================================================================
-- 1) CONFIRMAÇÃO DE PAGAMENTO -- efeito financeiro de payment pending -> paid.
-- NUNCA chamada por um webhook real nesta fase (não existe ainda) -- só
-- preparada, testável isoladamente. Idempotente: replay do mesmo payment_id
-- já 'paid' não duplica nada no ledger (retorna o resultado já calculado).
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
    -- replay -- já confirmado antes, devolve o snapshot já calculado, nunca
    -- recalcula nem duplica o ledger.
    return query select v_payment.id, v_payment.status, v_payment.gross_amount_cents,
      v_payment.platform_fee_cents, v_payment.operator_amount_cents, true;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  -- nunca confia só no valor que o provider "diz" ter cobrado -- precisa
  -- bater com o que a criação da tentativa já tinha travado (0052).
  if p_confirmed_amount_cents <> v_payment.amount_cents then
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  select fee_basis_points into v_fee_bp from public.get_current_marketplace_fee_config();
  if v_fee_bp is null then
    raise exception 'MARKETPLACE_FEE_NOT_CONFIGURED';
  end if;

  -- REVISÃO FINAL 4B: service_at_snapshot é lido AQUI, direto da saída real
  -- da reserva, no exato momento da confirmação -- nunca de um parâmetro da
  -- função (não existe p_service_at/p_departure_at nesta assinatura de
  -- propósito -- nenhum caller, nem o futuro webhook do Asaas, tem
  -- autoridade pra dizer "a saída é nesta hora"). Isso é o que protege a
  -- liberação D+1 contra um departures.departs_at reagendado/backdatado
  -- DEPOIS que o pagamento já foi confirmado (ver ADR 0002).
  select d.departs_at into v_service_at
    from public.departures d
    join public.reservations r on r.departure_id = d.id
    where r.id = v_payment.reservation_id;

  if not found or v_service_at is null then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  -- mesma fórmula de calculateMarketplaceAmounts() (src/lib/marketplace-
  -- ledger.ts) -- floor na comissão, operador fica com o resto, garantindo
  -- fee+operator=gross por construção. As duas implementações precisam
  -- continuar idênticas (mesmo contrato de manutenção já usado pra CPF/CNPJ,
  -- migration 0045).
  v_platform_fee := floor((v_payment.amount_cents::bigint * v_fee_bp) / 10000);
  v_operator_amount := v_payment.amount_cents - v_platform_fee;

  update public.payments
    set status = 'paid',
        gross_amount_cents = v_payment.amount_cents,
        platform_fee_cents = v_platform_fee,
        operator_amount_cents = v_operator_amount,
        service_at_snapshot = v_service_at
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
-- 2) LIBERAÇÃO (blocked -> available) -- D+1 objetivo: 24h corridas depois
-- de payments.service_at_snapshot (a hora da saída CONGELADA na confirmação
-- do pagamento -- REVISÃO FINAL 4B: nunca departures.departs_at ao vivo,
-- porque este é mutável e reagendar/backdatar a saída depois de um pagamento
-- confirmado não pode acelerar nem atrasar a liberação). Critério de
-- conclusão combina DOIS sinais (nenhum sozinho é confiável, ver ADR):
-- departures.status='encerrada' (sinal operacional já existente no schema,
-- migration 0000 -- não inventado aqui, e não restringido a nenhum papel
-- específico -- qualquer membro autenticado da company pode marcar via RLS
-- já existente) E o relógio real do snapshot já ter passado (service_at_
-- snapshot + 24h <= now()) -- mesmo que o operador marque 'encerrada' cedo
-- demais OU backdate a saída, o relógio imutável ainda barra a liberação.
--
-- Granularidade: por RESERVATION (não por departure inteira) -- cada
-- reserva paga é liberada independentemente, sempre pelo saldo 'blocked'
-- REMANESCENTE dela (nunca o valor original da venda -- um reembolso parcial
-- anterior à liberação já pode ter reduzido esse saldo).
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
  -- REVISÃO FINAL 4B: trava por RESERVA (não por company) -- serializa esta
  -- liberação contra um reembolso concorrente da MESMA reserva (ambos leem
  -- "quanto ainda está em blocked" antes de escrever; sem isto, os dois
  -- poderiam ler o mesmo valor obsoleto e um deles sobrescrever o efeito do
  -- outro). Reembolso da MESMA reserva usa a mesma chave abaixo.
  perform pg_advisory_xact_lock(hashtext('marketplace_reservation_balance'), hashtext(p_reservation_id::text));

  -- replay ANTES de qualquer outra validação/cálculo -- uma vez liberado,
  -- 'blocked' já está zerado pra esta reserva, então checar "tem saldo
  -- suficiente" DEPOIS deste ponto trataria um replay legítimo como
  -- NOTHING_TO_RELEASE por engano. Com a trava acima já segurada, não há
  -- corrida possível entre este SELECT e o INSERT mais abaixo.
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

  select p.id, p.status, p.operator_amount_cents, p.service_at_snapshot
    into v_payment
    from public.payments p
    where p.reservation_id = p_reservation_id
    order by p.created_at desc
    limit 1;

  if not found or v_payment.status <> 'paid' then
    raise exception 'PAYMENT_NOT_PAID';
  end if;

  -- departures.status ainda é o sinal OPERACIONAL de conclusão (quem pode
  -- marcar 'encerrada' é qualquer membro autenticado da company via a RLS já
  -- existente -- não restringido nesta fase) -- mas sozinho NUNCA libera
  -- dinheiro: o relógio real (service_at_snapshot, imutável) abaixo é
  -- obrigatório também. Um operador marcando 'encerrada' cedo demais não
  -- acelera nada.
  select d.status into v_departure_status
    from public.departures d
    where d.id = v_reservation.departure_id;

  if not found or v_departure_status <> 'encerrada' then
    raise exception 'DEPARTURE_NOT_CONCLUDED';
  end if;

  if v_payment.service_at_snapshot is null then
    raise exception 'SERVICE_SNAPSHOT_MISSING';
  end if;

  -- NUNCA departures.departs_at ao vivo -- departs_at é mutável (reagendar/
  -- backdatar não deve acelerar nem atrasar a liberação de um pagamento já
  -- confirmado). Usa exclusivamente o snapshot congelado na confirmação.
  if v_payment.service_at_snapshot + interval '24 hours' > now() then
    raise exception 'RELEASE_NOT_YET_DUE';
  end if;

  -- REVISÃO FINAL 4B: nunca reusar cegamente payments.operator_amount_cents
  -- (o valor ORIGINAL da venda) -- se um reembolso parcial já reduziu o
  -- saldo bloqueado desta reserva, a liberação deve mover só o que
  -- REALMENTE ainda está em 'blocked' pra esta reserva, nunca o valor
  -- original. Derivado do ledger, nunca armazenado.
  select coalesce(sum(amount_cents), 0) into v_remaining_blocked
    from public.marketplace_ledger_entries
    where reservation_id = p_reservation_id and bucket = 'blocked';

  if v_remaining_blocked <= 0 then
    -- nada a liberar -- ou já foi tudo reembolsado antes da liberação, ou já
    -- foi liberado (replay, ver abaixo). Falha fechada em vez de inserir um
    -- par de valor zero.
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
      -- fallback defensivo -- com a trava por reserva já segurada desde o
      -- início da função, esta corrida não deveria ser alcançável na
      -- prática; mantido só como segunda linha de defesa contra duplicar
      -- crédito caso a trava algum dia deixe de cobrir algum caminho.
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

-- ============================================================================
-- 3) SAQUE -- reserva o valor atomicamente (available -> withdrawal_pending),
-- com proteção real de concorrência via pg_advisory_xact_lock por company
-- (dois saques simultâneos da MESMA empresa nunca gastam o mesmo saldo --
-- mesmo padrão já usado em create_marketplace_booking, 0042, pelo mesmo
-- motivo: aqui não existe uma "key" natural que um unique index sozinho
-- resolveria, é uma checagem de SALDO SUFICIENTE que precisa ser
-- serializada de verdade).
-- ============================================================================

create table public.marketplace_withdrawals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  provider_transfer_id text,
  idempotency_key text
);

create index on public.marketplace_withdrawals (company_id);

-- ACHADO NA REVISÃO: sem isto, um retry de rede (mesmo pedido de saque
-- reenviado, ex: timeout) criaria um SEGUNDO withdrawal distinto, debitando
-- `available` duas vezes pro mesmo pedido lógico -- mesma classe de bug já
-- fechada em toda RPC de escrita deste projeto (booking, payment attempt).
create unique index marketplace_withdrawals_idempotency_key_unique
  on public.marketplace_withdrawals (idempotency_key)
  where idempotency_key is not null;

alter table public.marketplace_withdrawals enable row level security;
revoke all on table public.marketplace_withdrawals from public, anon, authenticated;

comment on table public.marketplace_withdrawals is
  'Solicitações de saque do operador. status transiciona (não é ledger append-only -- é a ENTIDADE "pedido de saque"). O efeito financeiro de cada transição vive no ledger (marketplace_ledger_entries), nunca só nesta tabela.';

create or replace function public.create_marketplace_withdrawal(
  p_company_id uuid,
  p_amount_cents int,
  p_idempotency_key text
) returns table (
  withdrawal_id uuid,
  status text,
  amount_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available bigint;
  v_new_id uuid;
  v_existing record;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_WITHDRAWAL_AMOUNT';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- serializa saques da MESMA empresa -- empresas diferentes nunca disputam
  -- o mesmo lock, podem prosseguir em paralelo livremente. Adquirido ANTES
  -- até da checagem de replay -- mesma ordem de create_marketplace_booking
  -- (0042), serializa qualquer tentativa concorrente da mesma empresa de
  -- forma determinística, replay incluso.
  perform pg_advisory_xact_lock(hashtext('marketplace_withdrawal'), hashtext(p_company_id::text));

  select w.id, w.status, w.amount_cents, w.company_id
    into v_existing
    from public.marketplace_withdrawals w
    where w.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.company_id <> p_company_id or v_existing.amount_cents <> p_amount_cents then
      raise exception 'WITHDRAWAL_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.amount_cents, true;
    return;
  end if;

  select available_balance_cents into v_available
    from public.get_marketplace_operator_balances(p_company_id);

  if p_amount_cents > v_available then
    raise exception 'INSUFFICIENT_AVAILABLE_BALANCE';
  end if;

  if exists (select 1 from public.companies c where c.id = p_company_id and c.asaas_receiver_status <> 'active') then
    raise exception 'RECEIVER_NOT_ACTIVE';
  end if;

  insert into public.marketplace_withdrawals (company_id, amount_cents, status, idempotency_key)
  values (p_company_id, p_amount_cents, 'pending', p_idempotency_key)
  returning id into v_new_id;

  insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
  values
    (p_company_id, 'withdrawal_reserved', 'available', -p_amount_cents, 'withdrawal', v_new_id),
    (p_company_id, 'withdrawal_reserved', 'withdrawal_pending', p_amount_cents, 'withdrawal', v_new_id);

  return query select v_new_id, 'pending'::text, p_amount_cents, false;
end;
$$;

revoke all on function public.create_marketplace_withdrawal(uuid, int, text) from public, anon, authenticated;
grant execute on function public.create_marketplace_withdrawal(uuid, int, text) to service_role;

-- Fecha o ciclo de vida do saque -- 'completed' (transferência real
-- confirmada, Fase futura) ou 'failed' (devolve o saldo pra available).
-- Nenhum caminho de produção chama isto ainda (nenhuma transferência real
-- existe nesta fase) -- só testável isoladamente.
create or replace function public.complete_marketplace_withdrawal(
  p_withdrawal_id uuid,
  p_succeeded boolean,
  p_provider_transfer_id text
) returns table (withdrawal_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w record;
begin
  select id, company_id, amount_cents, status into v_w
    from public.marketplace_withdrawals
    where id = p_withdrawal_id;

  if not found then
    raise exception 'WITHDRAWAL_NOT_FOUND';
  end if;
  if v_w.status <> 'pending' and v_w.status <> 'processing' then
    -- já finalizado (completed/failed/cancelled) -- replay idempotente, nada
    -- a fazer de novo.
    return query select v_w.id, v_w.status;
    return;
  end if;

  if p_succeeded then
    update public.marketplace_withdrawals
      set status = 'completed', processed_at = now(), provider_transfer_id = p_provider_transfer_id
      where id = p_withdrawal_id;

    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
    values
      (v_w.company_id, 'withdrawal_completed', 'withdrawal_pending', -v_w.amount_cents, 'withdrawal', p_withdrawal_id),
      (v_w.company_id, 'withdrawal_completed', 'transferred', v_w.amount_cents, 'withdrawal', p_withdrawal_id)
    on conflict do nothing;

    return query select v_w.id, 'completed'::text;
  else
    update public.marketplace_withdrawals
      set status = 'failed', processed_at = now()
      where id = p_withdrawal_id;

    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
    values
      (v_w.company_id, 'withdrawal_failed', 'withdrawal_pending', -v_w.amount_cents, 'withdrawal', p_withdrawal_id),
      (v_w.company_id, 'withdrawal_failed', 'available', v_w.amount_cents, 'withdrawal', p_withdrawal_id)
    on conflict do nothing;

    return query select v_w.id, 'failed'::text;
  end if;
end;
$$;

revoke all on function public.complete_marketplace_withdrawal(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_marketplace_withdrawal(uuid, boolean, text) to service_role;

-- ============================================================================
-- 4) REEMBOLSO -- reduz o saldo do operador (de onde quer que o dinheiro
-- esteja: blocked ou available, decidido automaticamente aqui). NUNCA
-- executa refund real no Asaas -- só o efeito no ledger interno, pronto pra
-- quando a Fase 4C existir. p_refund_id é gerado por quem chama (permite
-- idempotência mesmo antes de existir um id do provider).
-- ============================================================================

create or replace function public.record_marketplace_refund(
  p_payment_id uuid,
  p_refund_id uuid,
  p_operator_deduction_cents int
) returns table (
  refund_id uuid,
  deducted_from_bucket text,
  amount_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_existing record;
  v_already_released boolean;
  v_bucket text;
  v_remaining_blocked bigint;
  v_available bigint;
begin
  select le.bucket, le.amount_cents into v_existing
    from public.marketplace_ledger_entries le
    where le.reference_type = 'refund' and le.reference_id = p_refund_id and le.entry_type = 'customer_refund';

  if found then
    return query select p_refund_id, v_existing.bucket, abs(v_existing.amount_cents), true;
    return;
  end if;

  select p.id, p.company_id, p.status, p.reservation_id into v_payment
    from public.payments p
    where p.id = p_payment_id;

  if not found or v_payment.status <> 'paid' then
    raise exception 'PAYMENT_NOT_PAID';
  end if;
  if p_operator_deduction_cents is null or p_operator_deduction_cents < 0 then
    raise exception 'INVALID_REFUND_AMOUNT';
  end if;

  -- REVISÃO FINAL 4B: duas travas, nesta ordem fixa (evita deadlock entre
  -- chamadas concorrentes que precisassem das duas): (1) por COMPANY, MESMA
  -- chave usada em create_marketplace_withdrawal -- serializa este reembolso
  -- contra um saque concorrente da mesma empresa disputando o MESMO saldo
  -- 'available' (cenário do pedido: available=100000, saque reservando 80000
  -- + reembolso precisando deduzir 50000 -- sem isto os dois poderiam ler o
  -- saldo obsoleto e gastar o mesmo dinheiro duas vezes); (2) por RESERVA --
  -- mesma chave usada em release_marketplace_reservation_balance, protege
  -- contra a liberação e o reembolso da MESMA reserva correndo em paralelo
  -- sobre o mesmo saldo 'blocked'.
  perform pg_advisory_xact_lock(hashtext('marketplace_withdrawal'), hashtext(v_payment.company_id::text));
  perform pg_advisory_xact_lock(hashtext('marketplace_reservation_balance'), hashtext(v_payment.reservation_id::text));

  -- já foi liberado (existe o par operator_released pra esta reserva)? deduz
  -- de 'available'. Senão, ainda está em 'blocked'.
  select exists(
    select 1 from public.marketplace_ledger_entries
    where reference_type = 'release' and reference_id = v_payment.reservation_id
      and entry_type = 'operator_released' and bucket = 'available'
  ) into v_already_released;

  v_bucket := case when v_already_released then 'available' else 'blocked' end;

  -- REVISÃO FINAL 4B: nunca permitir que um bucket fique negativo nesta fase
  -- -- não existe modelo de dívida/saldo negativo ainda (ver ADR 0002). Se o
  -- estorno pedido exceder o que realmente está disponível pra deduzir,
  -- falha fechado em vez de criar um saldo inconsistente.
  if v_bucket = 'blocked' then
    select coalesce(sum(amount_cents), 0) into v_remaining_blocked
      from public.marketplace_ledger_entries
      where reservation_id = v_payment.reservation_id and bucket = 'blocked';

    if p_operator_deduction_cents > v_remaining_blocked then
      raise exception 'REFUND_EXCEEDS_BLOCKED_BALANCE';
    end if;
  else
    select available_balance_cents into v_available
      from public.get_marketplace_operator_balances(v_payment.company_id);

    if p_operator_deduction_cents > v_available then
      raise exception 'REFUND_EXCEEDS_AVAILABLE_BALANCE';
    end if;
  end if;

  insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id, reservation_id)
  values (v_payment.company_id, 'customer_refund', v_bucket, -p_operator_deduction_cents, 'refund', p_refund_id, v_payment.reservation_id);

  return query select p_refund_id, v_bucket, p_operator_deduction_cents, false;
end;
$$;

revoke all on function public.record_marketplace_refund(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.record_marketplace_refund(uuid, uuid, int) to service_role;
