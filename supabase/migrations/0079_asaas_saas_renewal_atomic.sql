-- NF-04 (parte A) -- renovação da assinatura SaaS pelo webhook do Asaas passa a
-- ser ATÔMICA.
--
-- Problema: src/app/api/webhooks/asaas/route.ts gravava a marca de dedupe em
-- processed_webhook_events (0037) e SÓ DEPOIS buscava e atualizava
-- subscriptions, em chamadas REST separadas e sem checar erro de nenhuma das
-- duas. Se o SELECT ou o UPDATE falhasse (rede, timeout, erro do Postgres), a
-- rota respondia 200, a marca já estava gravada e qualquer reenvio do Asaas (ou
-- o PAYMENT_RECEIVED depois do PAYMENT_CONFIRMED) batia na unique constraint
-- como "duplicado" -- pagamento confirmado, plano nunca renovado, nada no log.
--
-- Correção: marca + leitura + renovação numa ÚNICA função, numa única
-- transação. Qualquer erro em qualquer etapa desfaz TUDO (inclusive a marca),
-- a rota responde 5xx e o reenvio do Asaas processa de novo do zero.
--
-- Concorrência: dois webhooks idênticos ao mesmo tempo -- o segundo INSERT
-- ... ON CONFLICT espera a transação do primeiro no índice único. Se o
-- primeiro commitar, o segundo vira 'duplicate' sem renovar; se o primeiro
-- der rollback, o segundo insere a marca e renova normalmente. Nunca renova
-- duas vezes, nunca perde a renovação.
--
-- Chave de dedupe: continua sendo o payment.id do Asaas CRU (sem tipo de
-- evento), igual à 0037 -- é o que impede PAYMENT_CONFIRMED e PAYMENT_RECEIVED
-- do MESMO pagamento somarem o prazo duas vezes, e mantém compatibilidade com
-- as marcas já gravadas em produção.
--
-- SECURITY INVOKER de propósito: o único chamador é o service_role (rota do
-- webhook), que já tem acesso às duas tabelas -- a função não precisa de
-- nenhum privilégio a mais do que quem chama. EXECUTE só pro service_role.
--
-- p_company_id vem do externalReference que a rota já conferiu na API do
-- Asaas (verifyAsaasPaymentSettled) -- nunca do corpo do webhook sozinho.
--
-- Retorno:
--   'renewed'         -- marca gravada e paid_until renovado (commit)
--   'duplicate'       -- esse pagamento já renovou antes, nada muda
--   'no_subscription' -- empresa sem assinatura; NADA fica gravado (nem a
--                        marca), então um reenvio depois de corrigir o
--                        cadastro ainda renova
-- Qualquer outra situação é exceção (rollback total).

create or replace function public.renew_subscription_from_asaas_payment(
  p_company_id uuid,
  p_provider_payment_id text,
  p_event_type text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_marker_id uuid;
  v_sub record;
  v_base timestamptz;
  v_rows int;
begin
  if p_company_id is null then
    raise exception 'INVALID_COMPANY_ID';
  end if;
  if p_provider_payment_id is null or length(btrim(p_provider_payment_id)) = 0 or length(p_provider_payment_id) > 128 then
    raise exception 'INVALID_PROVIDER_PAYMENT_ID';
  end if;
  if p_event_type is null or p_event_type not in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') then
    raise exception 'INVALID_EVENT_TYPE';
  end if;

  insert into public.processed_webhook_events (provider, event_type, event_key)
  values ('asaas', p_event_type, p_provider_payment_id)
  on conflict (provider, event_key) do nothing
  returning id into v_marker_id;

  if v_marker_id is null then
    return 'duplicate';
  end if;

  -- mesma escolha de antes (assinatura mais recente da empresa), agora com
  -- lock de linha -- nenhuma outra transação muda paid_until entre a leitura
  -- e a escrita abaixo.
  select s.id, s.paid_until, s.billing_cycle
    into v_sub
    from public.subscriptions s
    where s.company_id = p_company_id
    order by s.created_at desc
    limit 1
    for update;

  if not found then
    -- desfaz a marca desta mesma transação -- ver 'no_subscription' acima
    delete from public.processed_webhook_events where id = v_marker_id;
    return 'no_subscription';
  end if;

  -- renova pelo tamanho do ciclo, a partir do que for maior entre o
  -- vencimento atual e agora (mesma regra que a rota fazia em JS)
  v_base := case
    when v_sub.paid_until is not null and v_sub.paid_until > now() then v_sub.paid_until
    else now()
  end;

  update public.subscriptions
    set paid_until = v_base + case when v_sub.billing_cycle = 'anual' then interval '365 days' else interval '30 days' end,
        status = 'ativa'
    where id = v_sub.id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'SUBSCRIPTION_RENEWAL_NOT_APPLIED';
  end if;

  return 'renewed';
end;
$$;

revoke all on function public.renew_subscription_from_asaas_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.renew_subscription_from_asaas_payment(uuid, text, text) to service_role;
