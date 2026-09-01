-- Próxima etapa financeira do marketplace ToursFlow: saque do operador
-- usando a chave Pix cadastrada (0054), com adapter pronto pra Asaas mas em
-- modo mock/sandbox controlado nesta fase. NENHUMA transferência real,
-- NENHUM dinheiro real se move por causa desta migration. Ver docs/adr/
-- 0005-marketplace-withdrawal-and-pix-payout.md para a decisão completa.
--
-- NÃO editar 0052-0055 (nenhuma ainda aplicada) -- migration nova. Duas
-- funções de 0053 (create_marketplace_withdrawal/complete_marketplace_
-- withdrawal) são SUPERADAS, não editadas nem removidas -- mesmo padrão já
-- usado em record_marketplace_refund (0053) superada por
-- create_marketplace_refund_request (0055): permanecem definidas no banco,
-- mas nenhum código novo as chama. Motivo: o modelo de confiança muda de
-- `service_role`+`company_id` como parâmetro pra `authenticated`+auth.uid()
-- (self-service do operador) -- uma mudança de ASSINATURA, que
-- `create or replace function` não cobre sem trocar o nome.
--
-- ACHADO ARQUITETURAL desta revisão: companies.asaas_wallet_id/
-- asaas_receiver_status (migration 0052) foram provisionadas pensando no
-- modelo de SPLIT do Asaas -- explicitamente REJEITADO no ADR 0002 em favor
-- da retenção interna (ledger) + payout em Pix direto. O destino de saque
-- REAL desta fase é marketplace_payout_accounts (0054), não uma wallet
-- Asaas. Por isso request_marketplace_withdrawal (abaixo) NÃO checa
-- asaas_receiver_status -- checaria um campo do modelo que não foi escolhido,
-- mascarando a checagem que importa de verdade (verification_status da
-- chave Pix). Ver ADR 0005 para o registro completo desta decisão.

-- ============================================================================
-- TITULARIDADE DA CHAVE PIX -- dimensão SEPARADA de status (que já
-- representa "é a chave corrente ou foi substituída", 0054). Confundir as
-- duas seria um erro (ex: o que significaria status='superseded' +
-- verification_status='unverified'? nada de coerente). unverified é o
-- default -- nenhuma chave nasce verificada. Só marketplace_payout_accounts
-- corrente E verified pode receber um saque real.
-- ============================================================================

alter table public.marketplace_payout_accounts
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected'));

comment on column public.marketplace_payout_accounts.verification_status is
  'Titularidade confirmada pelo PROVIDER real -- NUNCA autodeclarada pelo operador. unverified até uma confirmação real (ou, nesta fase, o mecanismo controlado de mock/sandbox via mark_marketplace_payout_account_verified). Dimensão separada de status (corrente/superseded) -- não confundir.';

-- Só service_role escreve aqui -- titularidade nunca é autodeclarada, nem
-- pelo operador (company_admin/super_admin da company), nem por engano.
-- Usada tanto pelo modo mock/sandbox desta fase quanto por um futuro
-- webhook real de confirmação do provider.
create or replace function public.mark_marketplace_payout_account_verified(
  p_payout_account_id uuid,
  p_verified boolean
) returns table (id uuid, verification_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  v_status := case when p_verified then 'verified' else 'rejected' end;

  update public.marketplace_payout_accounts
    set verification_status = v_status
    where marketplace_payout_accounts.id = p_payout_account_id and status <> 'superseded';

  if not found then
    raise exception 'PAYOUT_ACCOUNT_NOT_FOUND';
  end if;

  return query select p_payout_account_id, v_status;
end;
$$;

revoke all on function public.mark_marketplace_payout_account_verified(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_marketplace_payout_account_verified(uuid, boolean) to service_role;

-- ============================================================================
-- LEITURA CRUA DA CHAVE PIX -- EXCEÇÃO DELIBERADA à decisão de 0054 ("nenhum
-- caminho de leitura crua existe, nem pro backend"). Essa decisão foi tomada
-- quando não existia nenhuma necessidade legítima ainda -- esta migration É
-- essa necessidade: repassar a chave ao provider real exige o valor cru em
-- algum ponto. Superfície mínima: só service_role, só devolve tipo+valor
-- (nunca outros campos), pensada EXCLUSIVAMENTE pro dispatch de saque
-- (src/app/(app)/financeiro/withdrawal-actions.ts) -- nenhuma outra rota
-- deveria chamar isto.
-- ============================================================================

create or replace function public.get_marketplace_payout_account_raw_for_transfer(p_payout_account_id uuid)
returns table (pix_key_type text, pix_key_normalized text)
language sql
stable
security definer
set search_path = public
as $$
  select a.pix_key_type, a.pix_key_normalized
  from public.marketplace_payout_accounts a
  where a.id = p_payout_account_id and a.status <> 'superseded';
$$;

revoke all on function public.get_marketplace_payout_account_raw_for_transfer(uuid) from public, anon, authenticated;
grant execute on function public.get_marketplace_payout_account_raw_for_transfer(uuid) to service_role;

-- ============================================================================
-- marketplace_withdrawals: campos mínimos pra rastrear origem (qual chave
-- Pix foi usada -- imutável mesmo se o operador trocar de chave depois),
-- falha (código + mensagem segura pro operador, nunca o payload bruto do
-- provider) e taxa do provider (requested vs. net -- nunca assumir Pix
-- grátis).
-- ============================================================================

alter table public.marketplace_withdrawals
  add column if not exists payout_account_id uuid references public.marketplace_payout_accounts (id) on delete restrict,
  add column if not exists failure_code text,
  add column if not exists failure_reason_safe text,
  add column if not exists provider_fee_cents int check (provider_fee_cents is null or provider_fee_cents >= 0),
  add column if not exists net_transfer_cents int check (net_transfer_cents is null or net_transfer_cents >= 0);

comment on column public.marketplace_withdrawals.payout_account_id is
  'Snapshot de QUAL conta Pix foi usada -- capturado uma vez na criação (request_marketplace_withdrawal), nunca reavaliado depois. Se o operador trocar de chave enquanto este saque está processing, a transferência em andamento continua associada à conta original -- nunca redirecionada pra chave nova.';
comment on column public.marketplace_withdrawals.failure_reason_safe is
  'Mensagem de falha SEGURA pra mostrar ao operador -- nunca o payload bruto/erro interno do provider (pode conter detalhe sensível ou só ruído técnico sem valor pro operador).';

-- ============================================================================
-- SOLICITAR SAQUE -- self-service do operador (authenticated, auth.uid()),
-- mesmo modelo de confiança de payout accounts (0054) e outcome (0055).
-- Supera create_marketplace_withdrawal (0053) pra todo código novo.
-- ============================================================================

create or replace function public.request_marketplace_withdrawal(
  p_amount_cents int,
  p_idempotency_key text
) returns table (
  id uuid,
  status text,
  amount_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_existing record;
  v_payout record;
  v_available bigint;
  v_new_id uuid;
begin
  select p.company_id, p.role into v_company_id, v_role
    from public.profiles p
    where p.id = auth.uid();

  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;
  -- mesmo corte de payout accounts (0054) -- staff não movimenta dinheiro.
  if v_role not in ('company_admin', 'super_admin') then
    raise exception 'FORBIDDEN';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_WITHDRAWAL_AMOUNT';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- MESMA trava de sempre (0053/0055) -- serializa toda tentativa da mesma
  -- empresa (saque, refund tocando available) contra qualquer outra.
  -- Adquirida ANTES da checagem de replay, mesma ordem de sempre.
  perform pg_advisory_xact_lock(hashtext('marketplace_withdrawal'), hashtext(v_company_id::text));

  select w.id, w.status, w.amount_cents, w.company_id
    into v_existing
    from public.marketplace_withdrawals w
    where w.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.company_id <> v_company_id or v_existing.amount_cents <> p_amount_cents then
      raise exception 'WITHDRAWAL_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.amount_cents, true;
    return;
  end if;

  -- payout account CORRENTE e VERIFICADA -- fail closed sem os dois. Nunca
  -- aceita uma chave Pix vinda do request -- resolvida inteiramente aqui.
  select a.id, a.verification_status
    into v_payout
    from public.marketplace_payout_accounts a
    where a.company_id = v_company_id and a.status <> 'superseded'
    limit 1;

  if not found then
    raise exception 'PAYOUT_ACCOUNT_NOT_FOUND';
  end if;
  if v_payout.verification_status <> 'verified' then
    raise exception 'PAYOUT_ACCOUNT_NOT_VERIFIED';
  end if;

  -- fail closed até resolução administrativa: qualquer reembolso em
  -- manual_review desta empresa bloqueia NOVOS saques (situação financeira
  -- que precisa de atenção manual antes de mais dinheiro sair).
  if exists (
    select 1 from public.marketplace_refunds
    where company_id = v_company_id and status = 'manual_review'
  ) then
    raise exception 'MANUAL_REVIEW_PENDING';
  end if;

  -- saldo SEMPRE recalculado aqui -- nunca confia no valor exibido no
  -- browser. available_balance_cents já exclui blocked/refund_pending/
  -- withdrawal_pending por construção (soma só bucket='available').
  select available_balance_cents into v_available
    from public.get_marketplace_operator_balances(v_company_id);

  if p_amount_cents > v_available then
    raise exception 'INSUFFICIENT_AVAILABLE_BALANCE';
  end if;

  insert into public.marketplace_withdrawals (company_id, amount_cents, status, idempotency_key, payout_account_id)
  values (v_company_id, p_amount_cents, 'pending', p_idempotency_key, v_payout.id)
  returning marketplace_withdrawals.id into v_new_id;

  -- reserva no ledger: available -> withdrawal_pending. Só daqui em diante o
  -- valor deixa de contar como "disponível" -- nunca de blocked diretamente
  -- (blocked só vira available via release_marketplace_reservation_balance).
  insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
  values
    (v_company_id, 'withdrawal_reserved', 'available', -p_amount_cents, 'withdrawal', v_new_id),
    (v_company_id, 'withdrawal_reserved', 'withdrawal_pending', p_amount_cents, 'withdrawal', v_new_id);

  return query select v_new_id, 'pending'::text, p_amount_cents, false;
end;
$$;

revoke all on function public.request_marketplace_withdrawal(int, text) from public, anon, authenticated, service_role;
grant execute on function public.request_marketplace_withdrawal(int, text) to authenticated;

-- ============================================================================
-- MARCAR ENVIADO AO PROVIDER -- pending -> processing. Chamado pelo backend
-- (nunca pela sessão do operador) depois de mandar a transferência pro
-- Asaas (ou simular no modo mock) -- nunca pela resposta síncrona por si só
-- ser tratada como confirmação final (isso é o que o webhook faz).
-- ============================================================================

create or replace function public.mark_marketplace_withdrawal_processing(
  p_withdrawal_id uuid,
  p_provider_transfer_id text
) returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update public.marketplace_withdrawals
    set status = 'processing', provider_transfer_id = p_provider_transfer_id
    where id = p_withdrawal_id and status = 'pending'
  returning status into v_status;

  if not found then
    -- já não estava mais 'pending' (replay, ou já resolvido) -- devolve o
    -- estado atual, idempotente, nunca erro.
    select status into v_status from public.marketplace_withdrawals where id = p_withdrawal_id;
    if v_status is null then
      raise exception 'WITHDRAWAL_NOT_FOUND';
    end if;
  end if;

  return query select p_withdrawal_id, v_status;
end;
$$;

revoke all on function public.mark_marketplace_withdrawal_processing(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_marketplace_withdrawal_processing(uuid, text) to service_role;

-- ============================================================================
-- REVISÃO CONTRA O CONTRATO OFICIAL DO ASAAS (POST /v3/transfers): o ciclo
-- real de uma transferência tem 3 desfechos distintos, não 2 --
-- TRANSFER_DONE (completed), TRANSFER_FAILED (failed) e TRANSFER_CANCELLED
-- (cancelled, já existia no enum de status desde 0053 mas nunca era
-- produzido). failed e cancelled têm o MESMO efeito no ledger (devolve pra
-- available) mas são desfechos semanticamente diferentes -- por isso
-- p_succeeded boolean virou p_outcome text, e o ledger ganhou um entry_type
-- próprio pra cancelled (não reaproveita withdrawal_failed -- auditoria
-- nunca deveria confundir "o banco recusou" com "a transferência foi
-- cancelada").
-- ============================================================================

alter table public.marketplace_ledger_entries
  drop constraint marketplace_ledger_entries_entry_type_check;
alter table public.marketplace_ledger_entries
  add constraint marketplace_ledger_entries_entry_type_check
  check (entry_type in (
    'operator_blocked', 'operator_released', 'platform_fee', 'customer_refund',
    'withdrawal_reserved', 'withdrawal_completed', 'withdrawal_failed',
    'customer_refund_reserved', 'customer_refund_completed', 'customer_refund_failed',
    'withdrawal_cancelled'
  ));

-- ============================================================================
-- FECHAR O CICLO -- processing -> completed (withdrawal_pending ->
-- transferred, dinheiro sai do sistema pra valer) ou processing ->
-- failed/cancelled (withdrawal_pending -> available de volta, idempotente
-- nos dois casos). Autoridade final é o WEBHOOK (ver rota estendida em
-- src/app/api/webhooks/asaas/route.ts), nunca a resposta síncrona do POST
-- que criou a transferência -- só o webhook chama isto de produção quando
-- existir integração real. NUNCA chamado para TRANSFER_BLOCKED -- saldo
-- continua reservado em withdrawal_pending, sem tocar o ledger, sem mudar o
-- status (permanece 'processing') -- BLOCKED não é um desfecho definitivo.
-- Supera complete_marketplace_withdrawal (0053) pra todo código novo.
-- ============================================================================

create or replace function public.finalize_marketplace_withdrawal(
  p_withdrawal_id uuid,
  p_outcome text, -- 'completed' | 'failed' | 'cancelled'
  p_provider_transfer_id text,
  p_provider_fee_cents int,
  p_failure_code text,
  p_failure_reason_safe text
) returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w record;
  v_net int;
begin
  if p_outcome not in ('completed', 'failed', 'cancelled') then
    raise exception 'INVALID_OUTCOME';
  end if;

  select id, company_id, amount_cents, status into v_w
    from public.marketplace_withdrawals
    where id = p_withdrawal_id;

  if not found then
    raise exception 'WITHDRAWAL_NOT_FOUND';
  end if;
  if v_w.status <> 'pending' and v_w.status <> 'processing' then
    -- já finalizado -- replay idempotente do webhook (mesmo evento reenviado,
    -- ou um evento tardio conflitante chegando depois de já resolvido), nada
    -- a fazer de novo.
    return query select v_w.id, v_w.status;
    return;
  end if;

  if p_outcome = 'completed' then
    v_net := v_w.amount_cents - coalesce(p_provider_fee_cents, 0);
    if v_net < 0 then
      raise exception 'INVALID_PROVIDER_FEE';
    end if;

    update public.marketplace_withdrawals
      set status = 'completed',
          processed_at = now(),
          provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id),
          provider_fee_cents = p_provider_fee_cents,
          net_transfer_cents = v_net
      where id = p_withdrawal_id;

    -- dinheiro sai do sistema -- withdrawal_pending -> transferred. Não cria
    -- dinheiro novo, não deixa o valor simultaneamente em available e
    -- transferred (withdrawal_pending já tinha tirado de available na
    -- criação, este passo só reclassifica de novo).
    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
    values
      (v_w.company_id, 'withdrawal_completed', 'withdrawal_pending', -v_w.amount_cents, 'withdrawal', p_withdrawal_id),
      (v_w.company_id, 'withdrawal_completed', 'transferred', v_w.amount_cents, 'withdrawal', p_withdrawal_id)
    on conflict do nothing;

    return query select v_w.id, 'completed'::text;
  elsif p_outcome = 'failed' then
    update public.marketplace_withdrawals
      set status = 'failed',
          processed_at = now(),
          provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id),
          failure_code = p_failure_code,
          failure_reason_safe = p_failure_reason_safe
      where id = p_withdrawal_id;

    -- o valor NÃO desaparece -- volta pra available, idempotente (on
    -- conflict do nothing cobre um webhook duplicado chegando duas vezes).
    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
    values
      (v_w.company_id, 'withdrawal_failed', 'withdrawal_pending', -v_w.amount_cents, 'withdrawal', p_withdrawal_id),
      (v_w.company_id, 'withdrawal_failed', 'available', v_w.amount_cents, 'withdrawal', p_withdrawal_id)
    on conflict do nothing;

    return query select v_w.id, 'failed'::text;
  else -- cancelled
    update public.marketplace_withdrawals
      set status = 'cancelled',
          processed_at = now(),
          provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id),
          failure_code = p_failure_code,
          failure_reason_safe = p_failure_reason_safe
      where id = p_withdrawal_id;

    -- mesmo efeito de bucket que failed (volta pra available), entry_type
    -- PRÓPRIO -- auditoria nunca deveria ler "cancelled" como se fosse "o
    -- banco recusou".
    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
    values
      (v_w.company_id, 'withdrawal_cancelled', 'withdrawal_pending', -v_w.amount_cents, 'withdrawal', p_withdrawal_id),
      (v_w.company_id, 'withdrawal_cancelled', 'available', v_w.amount_cents, 'withdrawal', p_withdrawal_id)
    on conflict do nothing;

    return query select v_w.id, 'cancelled'::text;
  end if;
end;
$$;

revoke all on function public.finalize_marketplace_withdrawal(uuid, text, text, int, text, text) from public, anon, authenticated;
grant execute on function public.finalize_marketplace_withdrawal(uuid, text, text, int, text, text) to service_role;

-- ============================================================================
-- HISTÓRICO -- leitura segura pro operador, SEM chave Pix completa (join
-- com marketplace_payout_accounts, devolve só mask_pix_key). Sempre a
-- própria empresa (auth.uid()), nunca um parâmetro de company_id.
-- ============================================================================

create or replace function public.list_marketplace_withdrawals(p_limit int default 20)
returns table (
  id uuid,
  amount_cents int,
  status text,
  requested_at timestamptz,
  processed_at timestamptz,
  payout_pix_key_type text,
  payout_pix_key_masked text,
  failure_reason_safe text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
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

  return query
    select w.id, w.amount_cents, w.status, w.requested_at, w.processed_at,
      a.pix_key_type, public.mask_pix_key(a.pix_key_type, a.pix_key_normalized), w.failure_reason_safe
    from public.marketplace_withdrawals w
    left join public.marketplace_payout_accounts a on a.id = w.payout_account_id
    where w.company_id = v_company_id
    order by w.requested_at desc
    limit least(coalesce(p_limit, 20), 100);
end;
$$;

revoke all on function public.list_marketplace_withdrawals(int) from public, anon, authenticated, service_role;
grant execute on function public.list_marketplace_withdrawals(int) to authenticated;

-- ============================================================================
-- EXTENSÃO de get_marketplace_financial_summary (0054): passa a devolver
-- também payout_verification_status -- a RPC original só devolvia
-- `status` (dimensão de CICLO DE VIDA: corrente/superseded, sempre
-- 'unverified' na prática antes desta migration, já que era o único valor
-- não-superseded possível). Agora que verification_status existe como
-- dimensão SEPARADA (titularidade), a UI precisa da informação certa pra
-- decidir se o botão de saque aparece habilitado. `create or replace`
-- não cobre mudança de tipo de retorno -- precisa DROP + CREATE (função
-- ainda não aplicada em produção, sem risco de quebrar nada existente).
-- ============================================================================

drop function if exists public.get_marketplace_financial_summary();

create function public.get_marketplace_financial_summary()
returns table (
  blocked_balance_cents bigint,
  available_balance_cents bigint,
  pending_withdrawal_cents bigint,
  transferred_cents bigint,
  payout_pix_key_type text,
  payout_pix_key_masked text,
  payout_status text,
  payout_verification_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_balances record;
  v_payout record;
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

  select * into v_balances from public.get_marketplace_operator_balances(v_company_id);

  select a.pix_key_type, a.pix_key_normalized, a.status, a.verification_status
    into v_payout
    from public.marketplace_payout_accounts a
    where a.company_id = v_company_id and a.status <> 'superseded'
    limit 1;

  return query select
    v_balances.blocked_balance_cents,
    v_balances.available_balance_cents,
    v_balances.pending_withdrawal_cents,
    v_balances.transferred_cents,
    v_payout.pix_key_type,
    case when v_payout.pix_key_type is not null
      then public.mask_pix_key(v_payout.pix_key_type, v_payout.pix_key_normalized)
      else null
    end,
    v_payout.status,
    v_payout.verification_status;
end;
$$;

revoke all on function public.get_marketplace_financial_summary() from public, anon, authenticated, service_role;
grant execute on function public.get_marketplace_financial_summary() to authenticated;
