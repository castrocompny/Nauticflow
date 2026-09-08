-- ============================================================================
-- INICIAÇÃO REAL DE REEMBOLSO NO PROVIDER (fecha o gap documentado no ADR
-- 0007: "nenhum provider refund real está ativado"). create_marketplace_
-- refund_request (0055) já reserva o efeito internamente (refund_pending);
-- complete_marketplace_refund_request (0055) já finaliza quando o webhook
-- confirma. O que faltava: um jeito seguro de, entre essas duas pontas,
-- persistir o provider_refund_id logo após uma chamada POST bem-sucedida
-- ao Asaas (síncrona), ANTES do webhook chegar -- sem isso, o webhook só
-- conseguia correlacionar pelo heurístico "exatamente um candidato aberto"
-- (0060), nunca pelo id real.
--
-- Duas funções novas, ambas service_role-only (mesmo espírito de
-- mark_marketplace_withdrawal_processing/mark_marketplace_payment_
-- provider_created): a autorização de QUEM pode disparar um reembolso real
-- (super_admin) vive na camada de aplicação (server action), nunca aqui --
-- estas RPCs são chamadas de trás, depois que a autorização já foi
-- verificada, e leem/escrevem uma tabela que nem service_role pode tocar
-- direto (marketplace_refunds revoga até de service_role desde 0055).
-- ============================================================================

-- Leitura mínima necessária pra decidir se é seguro chamar o provider: o
-- pagamento precisa estar 'paid' e ter um provider_payment_id real; o
-- reembolso precisa estar 'pending' (nunca chama o provider de novo se já
-- está processing/completed/failed/manual_review). Nenhum dado sensível
-- além do estritamente necessário -- nunca CPF/e-mail/telefone do cliente.
create or replace function public.get_marketplace_refund_provider_context(p_refund_id uuid)
returns table (
  refund_id uuid,
  refund_status text,
  customer_refund_cents int,
  provider_refund_id text,
  payment_status text,
  provider_payment_id text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.status, r.customer_refund_cents, r.provider_refund_id, p.status, p.provider_payment_id
  from public.marketplace_refunds r
  join public.payments p on p.id = r.payment_id
  where r.id = p_refund_id;
$$;

revoke all on function public.get_marketplace_refund_provider_context(uuid) from public, anon, authenticated;
grant execute on function public.get_marketplace_refund_provider_context(uuid) to service_role;

-- Persiste o provider_refund_id assim que o POST /payments/{id}/refund
-- responde com sucesso, e avança pending -> processing. NUNCA marca
-- completed aqui -- o webhook continua sendo a única autoridade pra
-- confirmar que o dinheiro voltou de verdade (reconcile_marketplace_
-- refund_webhook_event, 0060, já sabe correlacionar por este id).
--
-- Idempotência: replay com o MESMO provider_refund_id é no-op seguro
-- (cobre retry do server action após um timeout de rede no nosso lado,
-- depois que o Postgres já tinha persistido da primeira vez). Um
-- provider_refund_id DIFERENTE do já persistido é tratado como anomalia --
-- nunca sobrescrito silenciosamente (poderia mascarar um reembolso
-- duplicado de verdade no provider) -- cai pra manual_review.
create or replace function public.mark_marketplace_refund_processing(
  p_refund_id uuid,
  p_provider_refund_id text
) returns table (id uuid, status text, provider_refund_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  if p_provider_refund_id is null or length(btrim(p_provider_refund_id)) = 0 then
    raise exception 'INVALID_PROVIDER_REFUND_ID';
  end if;

  select id, status, provider_refund_id into v_r
    from public.marketplace_refunds
    where id = p_refund_id
    for update;

  if not found then
    raise exception 'REFUND_NOT_FOUND';
  end if;

  if v_r.provider_refund_id = p_provider_refund_id then
    return query select v_r.id, v_r.status, v_r.provider_refund_id;
    return;
  end if;

  if v_r.provider_refund_id is not null then
    update public.marketplace_refunds set status = 'manual_review', updated_at = now() where id = p_refund_id;
    raise exception 'PROVIDER_REFUND_ID_MISMATCH';
  end if;

  if v_r.status <> 'pending' then
    raise exception 'REFUND_NOT_PENDING';
  end if;

  update public.marketplace_refunds
    set status = 'processing', provider_refund_id = p_provider_refund_id, updated_at = now()
    where id = p_refund_id;

  return query select p_refund_id, 'processing'::text, p_provider_refund_id;
end;
$$;

revoke all on function public.mark_marketplace_refund_processing(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_marketplace_refund_processing(uuid, text) to service_role;

comment on function public.get_marketplace_refund_provider_context(uuid) is
  'Leitura service_role-only pro server action que dispara reembolso real no Asaas (super_admin, verificado na aplicação) -- decide se é seguro chamar o provider (payment paid + refund pending).';
comment on function public.mark_marketplace_refund_processing(uuid, text) is
  'Persiste provider_refund_id logo após POST /payments/{id}/refund responder com sucesso -- pending -> processing. Nunca completed aqui; webhook (reconcile_marketplace_refund_webhook_event) é a autoridade final.';
