-- ============================================================================
-- 0090 -- Captura durável de conflitos de transferência (TRANSFER_*) do webhook
-- Asaas. PRIMEIRA FATIA LOCAL: tabela + RPC de captura + leitura administrativa.
--
-- Aplicada só no laboratório offline (nf-bootstrap-offline-a01, network=none).
-- Não aplicada em Supabase remoto, staging ou produção. A rota ainda NÃO chama
-- esta RPC; integração, tela, alerta e resolução financeira ficam fora.
-- Numeração: as migrations 0083–0088 não constam neste checkout; a origem dessa
-- lacuna não foi determinada. 0090 segue a 0089.
--
-- Contrato (para o futuro consumidor):
--  - Transação PRÓPRIA, separada da financeira: chamar depois que a RPC da 0089
--    já falhou e foi desfeita. Esta RPC não lê com lock, não altera saque,
--    saldo, ledger nem processed_webhook_events.
--  - Retorno: ('recorded', id, 1) para grupo novo; ('repeated', id, n) quando os
--    campos normalizados já existem. O id é próprio; nada aqui é event_key
--    inventado nem identidade externa.
--  - Erros (P0001, rollback total desta transação):
--      CONFLICT_CAPTURE_INVALID_INPUT      -- motivo/evento desconhecido ou contrato
--                                             incoerente (classe x valor de referência/taxa)
--      CONFLICT_CAPTURE_POLICY_MISSING     -- nenhuma política operacional
--      CONFLICT_CAPTURE_CAPACITY_EXCEEDED  -- janela cheia para grupo novo
--  - Para quem chama: commit confirmado = retorno recebido. Rejeição comprovada
--    = um dos erros acima recebido do banco. Qualquer outra coisa (timeout,
--    queda de conexão, erro genérico do cliente) = RESULTADO DESCONHECIDO: não
--    prova rollback nem gravação.
--
-- Identificadores do provedor (chave recebida, notification id, transfer id):
-- cada um vira uma classe -- 'absent' (null), 'accepted' (formato aceito por ESTA
-- política de captura: [A-Za-z0-9_.:-], 1 a 256; guardado exatamente, sem
-- reparo), 'excessive' (mais de 256) ou 'invalid' (qualquer outro, inclusive
-- vazio). Para excessive/invalid só a classe é guardada, nunca o conteúdo; a
-- captura não é recusada por isso. O formato aceito é decisão local de captura,
-- não contrato confirmado do Asaas.
--
-- Agrupamento: igualdade (NULLS NOT DISTINCT) dos campos normalizados
-- preservados -- motivo, evento, classe e valor de cada identificador, classe da
-- referência, UUID citado, classe e valor da taxa. Diferenças que a
-- normalização descarta (payload, referência inválida, taxa inválida,
-- identificadores inválidos/excessivos diferentes) caem no mesmo grupo. Não é
-- identidade do evento no provedor.
--
-- occurrence_count = chamadas de registro CONFIRMADAS deste grupo, não o número
-- de entregas do Asaas (entrega sem chamada, chamada desfeita ou recusada não
-- contam).
--
-- Fotografia local: saques cujo id = UUID citado OU provider_transfer_id = transfer
-- id recebido (mesmo inválido/excessivo: a comparação usa o valor recebido, que
-- não é gravado), lidos SEM lock no momento da primeira observação; nunca reescrita. Nenhum,
-- um ou vários vínculos são guardados como estão -- nenhum saque é escolhido.
-- Correspondência local não prova autoria nem unicidade no provedor. A empresa
-- vem do banco, nunca do chamador.
--
-- Capacidade: GLOBAL (há conflitos sem empresa), janela FIXA alinhada à época
-- de `window_seconds` -- não equivale a janela móvel (até 2x capacidade em
-- torno de uma fronteira). Repetição reconhecida não consome vaga. Serializada
-- por advisory lock de DUAS chaves (20038, 90), espaço distinto do lock de uma
-- chave por transfer id da 0089. Nenhum valor de política vem desta migration:
-- sem linha em marketplace_transfer_conflict_policy a RPC recusa.
--
-- Retenção/limpeza: nenhuma nesta fatia (pendente de decisão).
-- Limitação declarada: entre a detecção do conflito e a captura há uma janela
-- em que nada é gravado; a fila não resolve o conflito nem garante alerta.
-- ============================================================================

create table public.marketplace_transfer_conflict_policy (
  id boolean primary key default true check (id),
  capacity int not null check (capacity > 0),
  window_seconds int not null check (window_seconds > 0),
  updated_at timestamptz not null default now()
);

create table public.marketplace_transfer_conflict_windows (
  window_seconds int not null,
  window_start timestamptz not null,
  used int not null default 0 check (used >= 0),
  primary key (window_seconds, window_start)
);

create table public.marketplace_transfer_conflicts (
  id uuid primary key default gen_random_uuid(),
  reason text not null check (reason in (
    'terminal_outcome_conflict', 'event_key_conflict', 'transfer_identity_unproven', 'provider_transfer_id_mismatch',
    'missing_transfer_id', 'reference_mismatch', 'withdrawal_not_found')),
  event_type text not null check (event_type in (
    'TRANSFER_CREATED', 'TRANSFER_PENDING', 'TRANSFER_IN_BANK_PROCESSING', 'TRANSFER_BLOCKED',
    'TRANSFER_DONE', 'TRANSFER_FAILED', 'TRANSFER_CANCELLED')),
  event_key text,
  event_key_class text not null,
  notification_id text,
  notification_id_class text not null,
  provider_transfer_id text,
  provider_transfer_id_class text not null,
  reference_class text not null check (reference_class in ('absent', 'uuid', 'invalid')),
  referenced_withdrawal_id uuid,
  fee_class text not null check (fee_class in ('absent', 'valid', 'invalid')),
  fee_cents int check (fee_cents >= 0),
  first_observed_at timestamptz not null,
  local_link_state text not null check (local_link_state in ('none', 'single', 'multiple')),
  local_withdrawal_ids uuid[] not null,
  local_company_ids uuid[] not null,
  local_withdrawal_statuses text[] not null,
  local_link_bases text[] not null,
  occurrence_count int not null default 1 check (occurrence_count >= 1),
  last_observed_at timestamptz not null,
  constraint marketplace_transfer_conflicts_event_key_class_check
    check (event_key_class in ('absent', 'accepted', 'invalid', 'excessive') and (event_key_class = 'accepted') = (event_key is not null)),
  constraint marketplace_transfer_conflicts_notification_id_class_check
    check (notification_id_class in ('absent', 'accepted', 'invalid', 'excessive') and (notification_id_class = 'accepted') = (notification_id is not null)),
  constraint marketplace_transfer_conflicts_provider_transfer_id_class_check
    check (provider_transfer_id_class in ('absent', 'accepted', 'invalid', 'excessive') and (provider_transfer_id_class = 'accepted') = (provider_transfer_id is not null)),
  constraint marketplace_transfer_conflicts_reference_check
    check ((reference_class = 'uuid') = (referenced_withdrawal_id is not null)),
  constraint marketplace_transfer_conflicts_fee_check
    check ((fee_class = 'valid') = (fee_cents is not null)),
  constraint marketplace_transfer_conflicts_group_key unique nulls not distinct (
    reason, event_type, event_key, event_key_class, notification_id, notification_id_class,
    provider_transfer_id, provider_transfer_id_class, reference_class, referenced_withdrawal_id, fee_class, fee_cents)
);

alter table public.marketplace_transfer_conflict_policy enable row level security;
alter table public.marketplace_transfer_conflict_windows enable row level security;
alter table public.marketplace_transfer_conflicts enable row level security;

-- Política e janelas: só o owner (configuração operacional protegida); nenhuma policy.
revoke all on public.marketplace_transfer_conflict_policy from public, anon, authenticated, service_role;
revoke all on public.marketplace_transfer_conflict_windows from public, anon, authenticated, service_role;

-- Fila: leitura só por super_admin com aal2 (mesmo padrão da 0081); escrita só pela RPC.
create policy "conflitos de transferencia: super_admin aal2 le"
  on public.marketplace_transfer_conflicts
  for select to authenticated
  using (public.is_super_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2');

revoke all on public.marketplace_transfer_conflicts from public, anon, authenticated, service_role;
grant select on public.marketplace_transfer_conflicts to authenticated;

comment on table public.marketplace_transfer_conflicts is
  'Fila durável (somente leitura) de conflitos TRANSFER_* recusados pelo webhook. Registrar não altera saque/saldo/ledger/processed_webhook_events nem resolve o conflito; fotografia local é a da primeira observação.';

create or replace function public.record_marketplace_transfer_conflict(
  p_reason text,
  p_event_type text,
  p_event_key text,
  p_notification_id text,
  p_provider_transfer_id text,
  p_reference_class text,
  p_referenced_withdrawal_id uuid,
  p_fee_class text,
  p_fee_cents int
) returns table (outcome text, conflict_id uuid, occurrence_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy record;
  v_id uuid;
  v_count int;
  v_now timestamptz;
  v_window timestamptz;
  v_used int;
  v_ek_class text := case when p_event_key is null then 'absent' when length(p_event_key) > 256 then 'excessive'
    when p_event_key ~ '^[A-Za-z0-9_.:-]+$' then 'accepted' else 'invalid' end;
  v_ni_class text := case when p_notification_id is null then 'absent' when length(p_notification_id) > 256 then 'excessive'
    when p_notification_id ~ '^[A-Za-z0-9_.:-]+$' then 'accepted' else 'invalid' end;
  v_tr_class text := case when p_provider_transfer_id is null then 'absent' when length(p_provider_transfer_id) > 256 then 'excessive'
    when p_provider_transfer_id ~ '^[A-Za-z0-9_.:-]+$' then 'accepted' else 'invalid' end;
  -- projeção preservada: valor exato só quando aceito
  v_ek text := case when v_ek_class = 'accepted' then p_event_key end;
  v_ni text := case when v_ni_class = 'accepted' then p_notification_id end;
  v_tr text := case when v_tr_class = 'accepted' then p_provider_transfer_id end;
begin
  -- identificadores não recusam a captura (ver classes acima); o resto do contrato sim
  if p_reason is null or p_reason not in ('terminal_outcome_conflict', 'event_key_conflict', 'transfer_identity_unproven',
       'provider_transfer_id_mismatch', 'missing_transfer_id', 'reference_mismatch', 'withdrawal_not_found')
     or p_event_type is null or p_event_type not in ('TRANSFER_CREATED', 'TRANSFER_PENDING', 'TRANSFER_IN_BANK_PROCESSING',
       'TRANSFER_BLOCKED', 'TRANSFER_DONE', 'TRANSFER_FAILED', 'TRANSFER_CANCELLED')
     or p_reference_class is null or p_reference_class not in ('absent', 'uuid', 'invalid')
     or (p_reference_class = 'uuid') <> (p_referenced_withdrawal_id is not null)
     or p_fee_class is null or p_fee_class not in ('absent', 'valid', 'invalid')
     or (p_fee_class = 'valid') <> (p_fee_cents is not null)
     or p_fee_cents < 0 then
    raise exception 'CONFLICT_CAPTURE_INVALID_INPUT';
  end if;

  select p.capacity, p.window_seconds into v_policy from public.marketplace_transfer_conflict_policy p;
  if not found then
    raise exception 'CONFLICT_CAPTURE_POLICY_MISSING';
  end if;

  -- serializa só capturas entre si; nunca toca locks de saque/transfer id
  perform pg_catalog.pg_advisory_xact_lock(20038, 90);

  v_now := pg_catalog.clock_timestamp();

  -- repetição reconhecida: só contador e última observação; não consome vaga
  update public.marketplace_transfer_conflicts c
     set occurrence_count = c.occurrence_count + 1, last_observed_at = v_now
   where c.reason = p_reason and c.event_type = p_event_type
     and c.event_key is not distinct from v_ek and c.event_key_class = v_ek_class
     and c.notification_id is not distinct from v_ni and c.notification_id_class = v_ni_class
     and c.provider_transfer_id is not distinct from v_tr and c.provider_transfer_id_class = v_tr_class
     and c.reference_class = p_reference_class
     and c.referenced_withdrawal_id is not distinct from p_referenced_withdrawal_id
     and c.fee_class = p_fee_class
     and c.fee_cents is not distinct from p_fee_cents
  returning c.id, c.occurrence_count into v_id, v_count;
  if found then
    return query select 'repeated'::text, v_id, v_count;
    return;
  end if;

  v_window := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from v_now) / v_policy.window_seconds) * v_policy.window_seconds);
  insert into public.marketplace_transfer_conflict_windows (window_seconds, window_start, used)
    values (v_policy.window_seconds, v_window, 0)
    on conflict do nothing;
  select w.used into v_used from public.marketplace_transfer_conflict_windows w
   where w.window_seconds = v_policy.window_seconds and w.window_start = v_window;
  if v_used >= v_policy.capacity then
    raise exception 'CONFLICT_CAPTURE_CAPACITY_EXCEEDED';
  end if;
  update public.marketplace_transfer_conflict_windows w set used = w.used + 1
   where w.window_seconds = v_policy.window_seconds and w.window_start = v_window;

  insert into public.marketplace_transfer_conflicts (
    reason, event_type, event_key, event_key_class, notification_id, notification_id_class,
    provider_transfer_id, provider_transfer_id_class, reference_class, referenced_withdrawal_id,
    fee_class, fee_cents, first_observed_at, local_link_state, local_withdrawal_ids, local_company_ids,
    local_withdrawal_statuses, local_link_bases, occurrence_count, last_observed_at)
  select p_reason, p_event_type, v_ek, v_ek_class, v_ni, v_ni_class, v_tr, v_tr_class, p_reference_class,
         p_referenced_withdrawal_id, p_fee_class, p_fee_cents, v_now,
         case count(l.id) when 0 then 'none' when 1 then 'single' else 'multiple' end,
         coalesce(array_agg(l.id order by l.id) filter (where l.id is not null), '{}'),
         coalesce(array_agg(l.company_id order by l.id) filter (where l.id is not null), '{}'),
         coalesce(array_agg(l.status order by l.id) filter (where l.id is not null), '{}'),
         coalesce(array_agg(l.basis order by l.id) filter (where l.id is not null), '{}'),
         1, v_now
    from (
      -- leitura sem lock: fotografia, não decisão
      select w.id, w.company_id, w.status,
             case when w.id = p_referenced_withdrawal_id and w.provider_transfer_id = p_provider_transfer_id then 'both'
                  when w.id = p_referenced_withdrawal_id then 'reference' else 'transfer' end as basis
        from public.marketplace_withdrawals w
       where w.id = p_referenced_withdrawal_id or w.provider_transfer_id = p_provider_transfer_id
    ) l
  returning id into v_id;

  return query select 'recorded'::text, v_id, 1;
end;
$$;

revoke all on function public.record_marketplace_transfer_conflict(text, text, text, text, text, text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.record_marketplace_transfer_conflict(text, text, text, text, text, text, uuid, text, int) to service_role;
