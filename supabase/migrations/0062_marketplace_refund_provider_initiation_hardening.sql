-- ============================================================================
-- HARDENING de mark_marketplace_refund_processing (0061) -- corrige um bug
-- real de rollback de transação encontrado em revisão, ANTES de 0061 ser
-- aplicada em produção (nunca editar uma migration já publicada/aplicada --
-- 0061 permanece intocada, este é um create or replace numa nova migration,
-- mesmo padrão usado em todo o projeto pra estender uma função existente).
--
-- O BUG: no ramo de provider_refund_id DIVERGENTE, 0061 fazia
--   UPDATE ... SET status = 'manual_review' ...
--   RAISE EXCEPTION 'PROVIDER_REFUND_ID_MISMATCH';
-- na MESMA chamada de função. Uma função SECURITY DEFINER chamada via RPC
-- roda dentro da transação da chamada (PostgREST abre uma transação por
-- request) -- uma exception não capturada propaga e força ROLLBACK de tudo
-- que aconteceu nessa transação, incluindo o UPDATE que acabou de rodar.
-- Resultado real: o refund NUNCA ficava marcado manual_review de verdade --
-- o estado anômalo era perdido silenciosamente, e o chamador só via um erro
-- de RPC, sem nenhum rastro persistido pra um humano revisar depois.
--
-- A CORREÇÃO: persistir o manual_review via RETURN normal (sem exception) --
-- o UPDATE fica dentro da mesma transação de sucesso da chamada, comita
-- normalmente. O provider_refund_id ANTIGO nunca é sobrescrito (mesma
-- garantia de antes -- nunca mascara um reembolso duplicado real no
-- provider). O CHAMADOR (server action) passa a decidir o que fazer olhando
-- o status retornado, nunca um exception -- mesmo padrão já usado em
-- create_marketplace_refund_request (0055), que também devolve
-- status='manual_review' como uma linha normal, nunca como erro.
-- ============================================================================

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

  -- replay idempotente: mesmo provider_refund_id já persistido, nada a
  -- fazer -- devolve o estado atual tal como está.
  if v_r.provider_refund_id = p_provider_refund_id then
    return query select v_r.id, v_r.status, v_r.provider_refund_id;
    return;
  end if;

  -- provider_refund_id DIFERENTE do já persistido -- estado anômalo.
  -- CORRIGIDO (0062): persiste manual_review via RETURN normal, nunca via
  -- exception (ver nota no topo do arquivo) -- o UPDATE agora comita de
  -- verdade. provider_refund_id ANTIGO preservado intacto, nunca
  -- sobrescrito.
  if v_r.provider_refund_id is not null then
    update public.marketplace_refunds set status = 'manual_review', updated_at = now() where id = p_refund_id;
    return query select v_r.id, 'manual_review'::text, v_r.provider_refund_id;
    return;
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

-- ACL preservada explicitamente igual a 0061 -- nenhuma ampliação de
-- permissão, mesmo já persistindo automaticamente através de um `create or
-- replace function` (reafirmado aqui por clareza/auditoria, mesmo padrão
-- usado quando 0057 estendeu check_payments_financial_snapshot_immutable
-- de 0053).
revoke all on function public.mark_marketplace_refund_processing(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_marketplace_refund_processing(uuid, text) to service_role;

comment on function public.mark_marketplace_refund_processing(uuid, text) is
  'Persiste provider_refund_id logo após POST /payments/{id}/refund responder com sucesso -- pending -> processing. Nunca completed aqui; webhook (reconcile_marketplace_refund_webhook_event) é a autoridade final. Mismatch de provider_refund_id persiste manual_review via RETURN normal (0062 -- corrige bug de rollback de 0061), nunca via exception.';
