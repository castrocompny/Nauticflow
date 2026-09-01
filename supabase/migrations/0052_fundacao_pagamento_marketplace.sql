-- FASE 4A do marketplace ToursFlow: fundação SEGURA de pagamento, sem
-- movimentar dinheiro nenhum. Nenhuma chamada real ao Asaas acontece por
-- causa desta migration -- só schema, guard e uma RPC de idempotência que
-- grava a TENTATIVA de pagamento (status sempre 'pending', sem
-- provider_payment_id, até a Fase 4B ligar a chamada real). Ver
-- DOCUMENTACAO.md e docs/adr/0001-hold-expirado-vs-pagamento-confirmado.md.
--
-- NÃO editar 0036 (cria `payments`) nem 0037 (idempotência do webhook SaaS)
-- -- já aplicadas, mesmo padrão de sempre neste projeto.

-- ============================================================================
-- GUARD: companies.asaas_wallet_id / asaas_receiver_status
--
-- ACHADO NA AUDITORIA DE PAGAMENTOS: essas duas colunas (criadas vazias na
-- 0036) hoje podem ser alteradas por qualquer company_admin/staff via UPDATE
-- comum em `companies` -- a policy "propria empresa - update" (migration
-- 0000) não restringe coluna nenhuma. Isso é inofensivo HOJE (nada lê essas
-- colunas ainda), mas vira um risco real assim que o Split existir: um
-- operador poderia tentar setar o próprio wallet_id sem passar pelo
-- onboarding oficial do Asaas.
--
-- Diferente da suspensão administrativa (marketplace_suspended_at, 0044,
-- que é uma AÇÃO HUMANA do super_admin via painel), a config de
-- wallet/receiver É uma config TÉCNICA -- resultado de um fluxo de
-- onboarding/OAuth do Asaas processado só no backend (Fase futura, fora de
-- escopo aqui). Por isso o guard aceita tanto service_role (o backend,
-- quando o onboarding real existir) quanto super_admin (suporte manual,
-- mesmo padrão de poder administrativo já usado no resto do projeto) --
-- nunca o operador comum.
-- ============================================================================

create or replace function public.check_company_asaas_receiver_guard()
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
  raise exception 'Somente o backend ou o super admin podem alterar a configuração de recebimento Asaas desta empresa.';
end;
$$;

drop trigger if exists trg_company_asaas_receiver_guard on public.companies;
create trigger trg_company_asaas_receiver_guard
  before update of asaas_wallet_id, asaas_receiver_status on public.companies
  for each row execute function public.check_company_asaas_receiver_guard();

revoke all on function public.check_company_asaas_receiver_guard() from public, anon, authenticated;

-- ============================================================================
-- payments: só o mínimo necessário pra esta fase (idempotência de tentativa +
-- método escolhido). NÃO adicionados nesta migration, de propósito (sem uso
-- concreto ainda, evita coluna "pode ser útil"): expires_at, provider_status,
-- paid_at, failure_code -- ficam pra Fase 4B/4C quando a chamada real ao
-- Asaas e a confirmação via webhook existirem de fato.
-- ============================================================================

alter table public.payments
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text,
  add column if not exists payment_method text;

alter table public.payments
  add constraint payments_payment_method_check
    check (payment_method is null or payment_method in ('pix'));

comment on column public.payments.payment_method is
  'Método escolhido para esta tentativa de pagamento. Só "pix" existe como valor aceito -- é o único planejado (Fase 4B); nenhum outro é criado ainda, nem pix de verdade (a chamada ao Asaas não existe nesta fase).';
comment on column public.payments.idempotency_key is
  'Idempotency-Key própria da TENTATIVA DE PAGAMENTO -- separada da idempotency_key da reserva (reservations.idempotency_key). Uma mesma reserva pode, em tese, ter mais de uma tentativa de pagamento ao longo do tempo (ex: PIX expirou, tenta de novo) -- cada tentativa tem sua própria chave.';

-- mesma ideia de reservations.idempotency_key (0042): única globalmente
-- quando presente, nunca exige NOT NULL (não quebra linhas que não vieram
-- por este fluxo).
create unique index if not exists payments_idempotency_key_unique
  on public.payments (idempotency_key)
  where idempotency_key is not null;

-- ============================================================================
-- ACHADO DA REVISÃO: idempotency_key sozinha só protege contra REPLAY da
-- MESMA tentativa -- nada impedia (antes desta correção) uma mesma reserva
-- gerar duas cobranças `pending`/`paid` diferentes usando duas
-- idempotency_key diferentes. Corrigido com um unique index parcial: no
-- máximo UMA linha "ativa" (pending ou paid) por reservation_id, ao mesmo
-- tempo.
--
-- QUANDO UMA NOVA TENTATIVA É PERMITIDA para a mesma reserva: só depois que
-- a tentativa anterior deixar de ser 'pending'/'paid' -- ou seja, virar
-- 'failed' (cobrança recusada/expirada no provider -- retry legítimo,
-- liberado) ou 'refunded'/'partially_refunded' (só acontece depois de já
-- ter sido 'paid' -- um caso raro/futuro, mas também liberado
-- deliberadamente, ver auditoria: não é papel desta constraint decidir se
-- uma nova cobrança faz sentido de negócio depois de um estorno, só não
-- IMPEDIR estruturalmente). 'paid' sozinho já bloqueia pra sempre enquanto
-- não virar refund -- nunca duas cobranças pagas pra mesma reserva.
--
-- Nesta fase (Fase 4A) nada transiciona um payment pra fora de 'pending'
-- ainda (sem webhook de marketplace, sem chamada real ao Asaas) -- então,
-- na prática, esta constraint hoje bloqueia qualquer segunda tentativa
-- enquanto a primeira existir, o que é o comportamento correto e esperado
-- até a Fase 4C existir.
create unique index if not exists payments_one_active_per_reservation
  on public.payments (reservation_id)
  where status in ('pending', 'paid');

comment on index public.payments_one_active_per_reservation is
  'No máximo uma tentativa de pagamento ativa (pending ou paid) por reserva, ao mesmo tempo. failed/refunded/partially_refunded NÃO contam -- uma nova tentativa (nova idempotency_key) é permitida depois que a anterior sair de pending/paid. Ver docs/adr/0001-hold-expirado-vs-pagamento-confirmado.md.';

-- ============================================================================
-- RPC: registra a TENTATIVA de pagamento de forma idempotente e atômica.
-- NUNCA chama o Asaas -- só valida, recalcula o valor a partir da RESERVA
-- (nunca de um valor vindo de fora) e grava um registro `payments` com
-- status='pending', provider_payment_id=NULL. A chamada real ao provider
-- (Fase 4B) vai atualizar esse MESMO registro depois de criá-lo lá --
-- não recriar um outro.
--
-- Idempotência: insert direto com catch de unique_violation (mesmo padrão
-- do trial, migration 0045) -- não precisa de pg_advisory_xact_lock aqui
-- (diferente de create_marketplace_booking/0042): lá o lock existia porque
-- havia um EFEITO COLATERAL compartilhado entre chamadas concorrentes
-- (capacidade da saída, um recurso finito compartilhado entre reservas
-- DIFERENTES). Aqui cada idempotency_key protege só a si mesma -- o próprio
-- unique index já garante atomicidade sem precisar de lock adicional.
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

  select r.id, r.company_id, r.total_cents, r.status, r.source, r.hold_expires_at, r.departure_id
    into v_reservation
    from public.reservations r
    where r.id = p_booking_id;

  if not found or v_reservation.source <> 'marketplace' then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_reservation.status <> 'pendente' then
    raise exception 'BOOKING_NOT_PENDING';
  end if;
  -- política desta fase (ver ADR): recusa INICIAR um pagamento novo se o
  -- hold já venceu -- não faz sentido cobrar por uma vaga que já não está
  -- mais garantida. Diferente da política pra CONFIRMAÇÃO atrasada
  -- (webhook, Fase 4C), que é deliberadamente mais permissiva.
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
      -- duas constraints diferentes podem disparar este exception: a de
      -- idempotency_key (replay -- resolvido normalmente) e a nova de "uma
      -- tentativa ativa por reserva" (payments_one_active_per_reservation --
      -- bloqueado de propósito, nunca vira replay, sempre erro).
      if sqlerrm like '%payments_one_active_per_reservation%' then
        raise exception 'PAYMENT_ALREADY_ACTIVE';
      end if;

      if sqlerrm not like '%payments_idempotency_key_unique%' then
        raise;
      end if;

      select p.id, p.status, p.payment_method, p.amount_cents, p.request_fingerprint
        into v_existing
        from public.payments p
        where p.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;
      if v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT';
      end if;

      return query select v_existing.id, v_existing.status, v_existing.payment_method, v_existing.amount_cents, true;
      return;
  end;
end;
$$;

-- ACL: só service_role, mesmo padrão da 0043/0048 -- Supabase concede EXECUTE
-- a anon/authenticated por padrão em toda função nova, revogado explicitamente.
revoke all on function public.create_marketplace_payment_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_marketplace_payment_attempt(uuid, text, text, text) to service_role;
