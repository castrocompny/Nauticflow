-- Migration 0089 -- TRANSFER_* do webhook Asaas decidido pelo ESTADO travado do
-- saque, e correção das RPCs de saque da 0056.
--
-- Aplicada SÓ em banco local isolado (chain 0001–0082 + 0089, sem 0083–0088),
-- nunca em ambiente remoto. pgTAP correspondente
-- (supabase/tests/database/marketplace_withdrawal_webhook.test.sql) passou lá
-- 40/40, com as funções chamadas no papel da sessão de teste; corrida em duas
-- sessões não exercitada. Numeração: 0083–0088 originais foram perdidas e não
-- se sabe se alguma chegou a algum banco; 0089 evita colidir com elas.
--
-- Problemas (confirmados por leitura):
--  1. mark_marketplace_withdrawal_processing e finalize_marketplace_withdrawal
--     (0056) usam `id`/`status` sem qualificar, mesmos nomes dos parâmetros OUT
--     de `returns table (id, status)`. Com plpgsql.variable_conflict=error
--     (padrão) toda chamada falha com "column reference is ambiguous".
--  2. A rota gravava processed_webhook_events ANTES dessas RPCs e ignorava o
--     erro delas: 200 sem efeito, e o reenvio caía em `duplicate` para sempre.
--     Marcas TRANSFER_* já gravadas por esse código NÃO provam que o efeito foi
--     aplicado.
--  3. finalize lia o saque sem lock: DONE e FAILED concorrentes passavam os dois
--     pela checagem de status.
--  4. Nenhuma das duas conferia identidade do provider_transfer_id: nem outro id
--     já gravado no mesmo saque, nem o mesmo id em outro saque.
--
-- Decisões:
--  - A marca em processed_webhook_events vira só REGISTRO; nunca decide
--    `duplicate`. Quem decide é o estado do saque sob `for update`: um evento
--    cujo efeito já está refletido no estado responde `already_applied`; senão o
--    efeito é aplicado, haja marca (legada ou não) ou não. Assim um reenvio de
--    evento cuja marca antiga foi gravada sem efeito ainda aplica o efeito.
--  - processed_webhook_events é compartilhada (SaaS usa payment.id cru, 0079;
--    marketplace usa body.id ou `${event}:${id}`). Não há evidência no repo de
--    que body.id seja único entre tipos de evento. Chave existente com OUTRO
--    event_type => EVENT_KEY_CONFLICT (rollback, rota responde 422); nunca
--    trata a colisão como prova de processamento.
--  - Desfecho terminal diferente do já gravado (ex.: FAILED depois de DONE) =>
--    TERMINAL_OUTCOME_CONFLICT (rollback, 422). Não há política financeira
--    definida nem fila durável para isso -- fica BLOQUEADO para decisão de
--    produto; nada é aplicado nem respondido com 200.
--  - Identidade do transfer id: advisory lock transacional por transfer id +
--    checagem de outro saque com o mesmo id. Serializa TODOS os chamadores de
--    mark/finalize (webhook e withdrawal-actions) sem depender de índice único;
--    duplicatas já existentes nos dados viram PROVIDER_TRANSFER_ID_MISMATCH em
--    runtime em vez de fazer a migration falhar. Ordem de locks: linha do saque,
--    depois advisory -- igual em todos os caminhos.

-- Helper interno: trava o transfer id e recusa vínculo a outro saque.
create or replace function public.lock_marketplace_transfer_identity(
  p_withdrawal_id uuid,
  p_provider_transfer_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace_transfer:' || p_provider_transfer_id, 0));
  if exists (
    select 1 from public.marketplace_withdrawals w
    where w.provider_transfer_id = p_provider_transfer_id and w.id <> p_withdrawal_id
  ) then
    raise exception 'PROVIDER_TRANSFER_ID_MISMATCH';
  end if;
end;
$$;

revoke all on function public.lock_marketplace_transfer_identity(uuid, text) from public, anon, authenticated, service_role;

-- ============================================================================
-- 1. mark_marketplace_withdrawal_processing -- pending -> processing
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
  v_transfer_id text;
begin
  if p_provider_transfer_id is null or length(btrim(p_provider_transfer_id)) = 0 then
    raise exception 'INVALID_PROVIDER_TRANSFER_ID';
  end if;

  select w.status, w.provider_transfer_id into v_status, v_transfer_id
    from public.marketplace_withdrawals w
    where w.id = p_withdrawal_id
    for update;
  if not found then
    raise exception 'WITHDRAWAL_NOT_FOUND';
  end if;
  if v_transfer_id is not null and v_transfer_id <> p_provider_transfer_id then
    raise exception 'PROVIDER_TRANSFER_ID_MISMATCH';
  end if;
  perform public.lock_marketplace_transfer_identity(p_withdrawal_id, p_provider_transfer_id);

  if v_status = 'pending' then
    update public.marketplace_withdrawals w
      set status = 'processing', provider_transfer_id = p_provider_transfer_id
      where w.id = p_withdrawal_id;
    v_status := 'processing';
  end if;
  -- fora de 'pending' (replay ou já resolvido): devolve o estado atual, sem erro.

  return query select p_withdrawal_id, v_status;
end;
$$;

revoke all on function public.mark_marketplace_withdrawal_processing(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_marketplace_withdrawal_processing(uuid, text) to service_role;

-- ============================================================================
-- 2. finalize_marketplace_withdrawal -- mesma semântica de ledger da 0056
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
  v_entry_type text;
begin
  if p_outcome not in ('completed', 'failed', 'cancelled') then
    raise exception 'INVALID_OUTCOME';
  end if;

  -- lock: um segundo desfecho concorrente espera aqui e depois vê o estado novo.
  select w.id, w.company_id, w.amount_cents, w.status, w.provider_transfer_id into v_w
    from public.marketplace_withdrawals w
    where w.id = p_withdrawal_id
    for update;
  if not found then
    raise exception 'WITHDRAWAL_NOT_FOUND';
  end if;
  if p_provider_transfer_id is not null then
    if v_w.provider_transfer_id is not null and v_w.provider_transfer_id <> p_provider_transfer_id then
      raise exception 'PROVIDER_TRANSFER_ID_MISMATCH';
    end if;
    perform public.lock_marketplace_transfer_identity(p_withdrawal_id, p_provider_transfer_id);
  end if;
  if v_w.status not in ('pending', 'processing') then
    -- já finalizado: devolve o estado atual sem efeito. Desfecho conflitante é
    -- recusado antes, por process_marketplace_transfer_webhook_event.
    return query select v_w.id, v_w.status;
    return;
  end if;

  if p_outcome = 'completed' then
    v_net := v_w.amount_cents - coalesce(p_provider_fee_cents, 0);
    if v_net < 0 then
      raise exception 'INVALID_PROVIDER_FEE';
    end if;

    update public.marketplace_withdrawals w
      set status = 'completed',
          processed_at = now(),
          provider_transfer_id = coalesce(p_provider_transfer_id, w.provider_transfer_id),
          provider_fee_cents = p_provider_fee_cents,
          net_transfer_cents = v_net
      where w.id = p_withdrawal_id;

    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
    values
      (v_w.company_id, 'withdrawal_completed', 'withdrawal_pending', -v_w.amount_cents, 'withdrawal', p_withdrawal_id),
      (v_w.company_id, 'withdrawal_completed', 'transferred', v_w.amount_cents, 'withdrawal', p_withdrawal_id)
    on conflict do nothing;
  else
    -- failed e cancelled: mesmo efeito de bucket (volta pra available),
    -- entry_type próprio de cada um (ver 0056).
    v_entry_type := case p_outcome when 'failed' then 'withdrawal_failed' else 'withdrawal_cancelled' end;

    update public.marketplace_withdrawals w
      set status = p_outcome,
          processed_at = now(),
          provider_transfer_id = coalesce(p_provider_transfer_id, w.provider_transfer_id),
          failure_code = p_failure_code,
          failure_reason_safe = p_failure_reason_safe
      where w.id = p_withdrawal_id;

    insert into public.marketplace_ledger_entries (company_id, entry_type, bucket, amount_cents, reference_type, reference_id)
    values
      (v_w.company_id, v_entry_type, 'withdrawal_pending', -v_w.amount_cents, 'withdrawal', p_withdrawal_id),
      (v_w.company_id, v_entry_type, 'available', v_w.amount_cents, 'withdrawal', p_withdrawal_id)
    on conflict do nothing;
  end if;

  return query select v_w.id, p_outcome;
end;
$$;

revoke all on function public.finalize_marketplace_withdrawal(uuid, text, text, int, text, text) from public, anon, authenticated;
grant execute on function public.finalize_marketplace_withdrawal(uuid, text, text, int, text, text) to service_role;

-- ============================================================================
-- 3. process_marketplace_transfer_webhook_event -- estado decide, marca registra
-- ============================================================================
-- Retorno:
--   ('applied', status)         -- efeito aplicado nesta transação
--   ('already_applied', status) -- o estado travado já reflete este evento
--                                  (mesmo desfecho terminal, ou intermediário
--                                  em saque já processing/finalizado)
-- Exceções (rollback total, inclusive da marca): WITHDRAWAL_NOT_FOUND,
-- PROVIDER_TRANSFER_ID_MISMATCH, TERMINAL_OUTCOME_CONFLICT, EVENT_KEY_CONFLICT,
-- TRANSFER_IDENTITY_UNPROVEN, INVALID_* e qualquer erro inesperado.
create or replace function public.process_marketplace_transfer_webhook_event(
  p_event_key text,
  p_event_type text,
  p_withdrawal_id uuid,
  p_provider_transfer_id text,
  p_provider_fee_cents int
) returns table (outcome text, withdrawal_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_type text;
  v_status text;
  v_transfer_id text;
  v_outcome text;
begin
  if p_event_key is null or length(btrim(p_event_key)) = 0 or length(p_event_key) > 256 then
    raise exception 'INVALID_EVENT_KEY';
  end if;
  if p_withdrawal_id is null then
    raise exception 'WITHDRAWAL_NOT_FOUND';
  end if;
  if p_provider_transfer_id is null or length(btrim(p_provider_transfer_id)) = 0 then
    raise exception 'INVALID_PROVIDER_TRANSFER_ID';
  end if;
  v_outcome := case p_event_type
    when 'TRANSFER_DONE' then 'completed'
    when 'TRANSFER_FAILED' then 'failed'
    when 'TRANSFER_CANCELLED' then 'cancelled'
    when 'TRANSFER_CREATED' then null
    when 'TRANSFER_PENDING' then null
    when 'TRANSFER_IN_BANK_PROCESSING' then null
    when 'TRANSFER_BLOCKED' then null
    else 'invalid'
  end;
  if v_outcome = 'invalid' then
    raise exception 'INVALID_EVENT_TYPE';
  end if;

  -- Registro (nunca decisão). Chave já usada por outro event_type/fluxo não é
  -- prova de nada sobre este evento -- recusa em vez de adivinhar.
  insert into public.processed_webhook_events (provider, event_type, event_key)
  values ('asaas', p_event_type, p_event_key)
  on conflict (provider, event_key) do nothing;
  select e.event_type into v_existing_type
    from public.processed_webhook_events e
    where e.provider = 'asaas' and e.event_key = p_event_key;
  if v_existing_type is distinct from p_event_type then
    raise exception 'EVENT_KEY_CONFLICT';
  end if;

  select w.status, w.provider_transfer_id into v_status, v_transfer_id
    from public.marketplace_withdrawals w
    where w.id = p_withdrawal_id
    for update;
  if not found then
    raise exception 'WITHDRAWAL_NOT_FOUND';
  end if;
  -- Fora de 'pending' sem transfer id gravado (legado/0053): só pending vincula
  -- o id (mark), então `already_applied` afirmaria uma identidade não provada.
  -- Falha fechado; não há fila nem política para vincular depois -- bloqueio
  -- explícito.
  if v_status <> 'pending' and v_transfer_id is null then
    raise exception 'TRANSFER_IDENTITY_UNPROVEN';
  end if;

  if v_outcome is null then
    -- intermediário (inclui BLOCKED): nunca toca o ledger nem muda pra desfecho.
    -- mark confere a identidade do transfer id em qualquer estado.
    perform 1 from public.mark_marketplace_withdrawal_processing(p_withdrawal_id, p_provider_transfer_id);
    -- só 'pending' muda de estado; qualquer outro já reflete este evento.
    return query select (case when v_status = 'pending' then 'applied' else 'already_applied' end)::text,
      (case when v_status = 'pending' then 'processing' else v_status end)::text;
    return;
  end if;

  if v_status not in ('pending', 'processing') then
    if v_status <> v_outcome then
      raise exception 'TERMINAL_OUTCOME_CONFLICT';
    end if;
    -- mesmo desfecho: confere identidade (finalize faz o lock) sem novo efeito.
    perform 1 from public.finalize_marketplace_withdrawal(p_withdrawal_id, v_outcome, p_provider_transfer_id, null, null, null);
    return query select 'already_applied'::text, v_status;
    return;
  end if;

  select f.status into v_status
    from public.finalize_marketplace_withdrawal(
      p_withdrawal_id,
      v_outcome,
      p_provider_transfer_id,
      case when v_outcome = 'completed' then p_provider_fee_cents end,
      case when v_outcome = 'completed' then null else 'PROVIDER_TRANSFER_' || upper(v_outcome) end,
      -- nunca o payload bruto do provider -- só texto curto e seguro (0056).
      case v_outcome
        when 'completed' then null
        when 'cancelled' then 'A transferência foi cancelada.'
        else 'A transferência não pôde ser concluída pelo provedor de pagamento.'
      end
    ) f;

  return query select 'applied'::text, v_status;
end;
$$;

revoke all on function public.process_marketplace_transfer_webhook_event(text, text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.process_marketplace_transfer_webhook_event(text, text, uuid, text, int) to service_role;

-- ============================================================================
-- 4. complete_marketplace_withdrawal (0053) -- revogada
-- ============================================================================
-- Superada pela 0056 e sem nenhum caller em SQL ou TS (DOCUMENTACAO.md, seção
-- de funções superadas). Lia o saque sem lock e gravava provider_transfer_id
-- direto, contornando a trava de identidade acima. Sem compatibilidade a
-- preservar: só tira o EXECUTE do service_role; a definição fica (0053 não é
-- editada).
revoke all on function public.complete_marketplace_withdrawal(uuid, boolean, text) from public, anon, authenticated, service_role;
