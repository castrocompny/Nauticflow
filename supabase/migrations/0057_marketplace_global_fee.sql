-- Decisão de produto: COMISSÃO GLOBAL INICIAL DO MARKETPLACE TOURSFLOW = 10%
-- (1000 basis points). Vale só para NOVAS confirmações de pagamento a partir
-- de quando esta configuração entrar em vigor -- vendas já confirmadas
-- mantêm o snapshot congelado na hora, mudança futura de percentual nunca
-- recalcula retroativamente. NENHUMA chamada real ao Asaas, NENHUM PIX,
-- NENHUMA transferência/reembolso real acontece por causa desta migration.
-- Ver docs/adr/0006-marketplace-global-commission.md para a decisão
-- completa.
--
-- NÃO editar 0052-0056 (nenhuma ainda aplicada) -- migration nova. Duas
-- funções são estendidas via `create or replace function` com A MESMA
-- assinatura (nunca editando os arquivos originais):
-- check_payments_financial_snapshot_immutable (0053) e
-- record_marketplace_payment_confirmed (0053, já estendida uma vez em
-- 0055). get_current_marketplace_fee_config ganha um NOVO overload de 1
-- parâmetro (a versão de 0 parâmetros, 0053, fica preservada e não é
-- chamada por nenhum código novo -- Postgres identifica funções por
-- (nome, tipos de parâmetro), então isto é uma função nova, não uma
-- substituição).

-- ============================================================================
-- SNAPSHOT DO PERCENTUAL -- gross/fee/operator já eram congelados (0053),
-- mas o basis_points EM SI não era guardado separadamente -- só dava pra
-- inferir aproximadamente a partir de fee_cents/gross_cents (impreciso por
-- causa do floor). Guardar o valor exato usado é necessário pra exibir "sua
-- taxa foi X%" na UI sem reconstruir isso por conta, e pra auditoria real.
-- ============================================================================

alter table public.payments
  add column if not exists fee_basis_points_snapshot int
    check (fee_basis_points_snapshot is null or (fee_basis_points_snapshot >= 0 and fee_basis_points_snapshot <= 10000));

comment on column public.payments.fee_basis_points_snapshot is
  'Percentual de comissão EXATO (basis points) vigente no momento da confirmação -- congelado junto com gross/fee/operator/policy/service_at. Mudar marketplace_fee_config depois nunca altera isto. NULL enquanto pending.';

-- ============================================================================
-- ARQUITETURA PREPARADA PRA OVERRIDE POR EMPRESA (NÃO IMPLEMENTADO NESTA
-- FASE) -- company_id NULL = configuração GLOBAL (o único tipo de linha que
-- de fato existe/é inserida nesta fase). Uma linha com company_id preenchido
-- seria um override específico daquela empresa -- get_current_marketplace_
-- fee_config(p_company_id) abaixo já sabe priorizar isso SE algum dia
-- existir, mas nenhuma linha assim é criada aqui. Decisão de produto atual:
-- 100% global, sem exceção por operador.
-- ============================================================================

alter table public.marketplace_fee_config
  add column if not exists company_id uuid references public.companies (id) on delete cascade;

comment on column public.marketplace_fee_config.company_id is
  'NULL = configuração GLOBAL (vale pra toda empresa sem override). Preenchido = override específico de UMA empresa -- arquitetura preparada, mas NENHUM override por empresa está implementado ou ativo nesta fase (decisão de produto: 100% global). Não inserir uma linha com company_id preenchido sem uma decisão de produto explícita futura, documentada em ADR próprio.';

-- ============================================================================
-- EXTENSÃO de check_payments_financial_snapshot_immutable (0053): protege
-- também fee_basis_points_snapshot -- faz parte do MESMO conjunto imutável
-- (gross/fee/operator/policy/service_at/fee_bp), todos congelados juntos,
-- uma única vez, nunca alterados depois.
-- ============================================================================

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
    or new.fee_basis_points_snapshot is distinct from old.fee_basis_points_snapshot
  ) then
    raise exception 'FINANCIAL_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;

-- CHECK estendido -- fee_basis_points_snapshot agora faz parte do "conjunto
-- completo ou nada" (mesmo raciocínio já usado pra service_at_snapshot em
-- 0053/hardening).
alter table public.payments
  drop constraint payments_amounts_balance_check;
alter table public.payments
  add constraint payments_amounts_balance_check
    check (
      gross_amount_cents is null
      or (platform_fee_cents is not null and operator_amount_cents is not null
          and platform_fee_cents >= 0 and operator_amount_cents >= 0
          and platform_fee_cents + operator_amount_cents = gross_amount_cents
          and service_at_snapshot is not null
          and fee_basis_points_snapshot is not null)
    );

-- ============================================================================
-- get_current_marketplace_fee_config(p_company_id) -- NOVO overload (a
-- versão de 0 parâmetros, 0053, continua existindo intacta, sem uso por
-- código novo). Prioriza um override da EMPRESA se existir; senão cai pro
-- global (company_id is null). Fail-closed idêntico ao original -- devolve
-- NULL se nada estiver configurado, nunca assume 0%.
-- ============================================================================

create or replace function public.get_current_marketplace_fee_config(p_company_id uuid default null)
returns table (fee_basis_points int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bp int;
begin
  if p_company_id is not null then
    select c.fee_basis_points into v_bp
      from public.marketplace_fee_config c
      where c.company_id = p_company_id
      order by c.created_at desc
      limit 1;

    if v_bp is not null then
      return query select v_bp;
      return;
    end if;
  end if;

  select c.fee_basis_points into v_bp
    from public.marketplace_fee_config c
    where c.company_id is null
    order by c.created_at desc
    limit 1;

  return query select v_bp;
end;
$$;

revoke all on function public.get_current_marketplace_fee_config(uuid) from public, anon, authenticated;
grant execute on function public.get_current_marketplace_fee_config(uuid) to service_role;

-- ============================================================================
-- EXTENSÃO de record_marketplace_payment_confirmed (0053, já estendida em
-- 0055): passa a usar get_current_marketplace_fee_config(company_id) (o
-- overload novo, com fallback pro global) e a congelar
-- fee_basis_points_snapshot junto com o resto. Mesma assinatura exata.
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

  -- REVISÃO 0057: prioriza um override da empresa (nenhum existe hoje --
  -- ver comentário na coluna company_id acima), fallback pro global.
  select fee_basis_points into v_fee_bp from public.get_current_marketplace_fee_config(v_payment.company_id);
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

  -- mesma fórmula de calculateMarketplaceAmounts() (src/lib/marketplace-
  -- ledger.ts) -- floor determinístico na comissão, operador fica com o
  -- resto (nunca calculado independentemente), garantindo
  -- fee+operator=gross por construção, nunca por checagem depois. Nenhum
  -- centavo "some": o resto do arredondamento vai sempre pro operador,
  -- nunca fica sem dono.
  v_platform_fee := floor((v_payment.amount_cents::bigint * v_fee_bp) / 10000);
  v_operator_amount := v_payment.amount_cents - v_platform_fee;

  update public.payments
    set status = 'paid',
        gross_amount_cents = v_payment.amount_cents,
        platform_fee_cents = v_platform_fee,
        operator_amount_cents = v_operator_amount,
        service_at_snapshot = v_service_at,
        cancellation_policy_snapshot = v_refund_policy,
        fee_basis_points_snapshot = v_fee_bp
    where id = p_payment_id;

  -- Nunca operator_blocked = gross -- sempre o valor já líquido da
  -- comissão. platform_fee vai pro bucket separado platform_revenue, que o
  -- operador NUNCA consegue sacar (get_marketplace_operator_balances só
  -- soma blocked/available/withdrawal_pending/transferred -- platform_
  -- revenue nunca entra nessa soma, nem por engano).
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
-- LEITURA DO DETALHAMENTO DA VENDA -- self-service do operador
-- (authenticated), pra UI mostrar "Venda / Taxa marketplace / Você recebe"
-- sem expor basis points nem o ledger bruto. Só devolve os snapshots JÁ
-- congelados -- nunca recalcula com a comissão atual.
-- ============================================================================

create or replace function public.get_marketplace_payment_breakdown(p_reservation_id uuid)
returns table (
  gross_amount_cents int,
  platform_fee_cents int,
  operator_amount_cents int,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_reservation_company_id uuid;
begin
  select p.company_id into v_company_id from public.profiles p where p.id = auth.uid();
  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;

  select r.company_id into v_reservation_company_id from public.reservations r where r.id = p_reservation_id;
  if not found or v_reservation_company_id <> v_company_id then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  return query
    select pay.gross_amount_cents, pay.platform_fee_cents, pay.operator_amount_cents, pay.status
    from public.payments pay
    where pay.reservation_id = p_reservation_id
    order by pay.created_at desc
    limit 1;
end;
$$;

revoke all on function public.get_marketplace_payment_breakdown(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_marketplace_payment_breakdown(uuid) to authenticated;

-- ============================================================================
-- NENHUM INSERT em marketplace_fee_config nesta migration -- deliberado.
--
-- check_marketplace_fee_config_guard() (0053) exige auth.role() =
-- 'service_role' OU is_super_admin() -- os dois dependem de contexto de
-- sessão (request.jwt.claims / auth.uid()) que NÃO existe quando uma
-- migration roda via `supabase db push` (conexão direta como owner/
-- superuser, sem JWT) -- exatamente o mesmo motivo pelo qual o pepper de
-- trial (migration 0045/0046) foi gerado por uma chamada SEPARADA
-- (`supabase db query --file`), não dentro do arquivo de migration. Um
-- INSERT aqui dentro provavelmente seria barrado pelo próprio guard que
-- este projeto construiu de propósito.
--
-- A configuração real (10% = 1000 basis points, decisão de produto desta
-- sessão) fica pronta como um comando SEPARADO, documentado em
-- docs/adr/0006-marketplace-global-commission.md e em DOCUMENTACAO.md --
-- pra ser executado (com autorização própria, depois desta migration já
-- aplicada) via `supabase db query --linked --file`, nunca dentro do push
-- da migration em si:
--
--   insert into public.marketplace_fee_config (fee_basis_points, company_id, note)
--   values (1000, null, 'Comissão global inicial do marketplace ToursFlow -- decisão de produto, sessão de 2026-08-31. 1000 basis points = 10%.');
--
-- Enquanto essa linha não existir de verdade, MARKETPLACE_FEE_NOT_CONFIGURED
-- continua bloqueando toda confirmação de pagamento -- fail closed, mesmo
-- depois desta migration aplicada.
-- ============================================================================
