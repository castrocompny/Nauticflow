-- 0092 -- concessão de trial de Staging em uma única transação.
--
-- A leitura de companies.asaas_customer_id, a atualização da assinatura e a
-- auditoria não podem ser chamadas REST separadas: um vínculo Asaas concorrente
-- poderia entrar entre a leitura e a concessão, e uma falha da auditoria poderia
-- deixar estado parcial. Esta função bloqueia primeiro a empresa e depois a
-- assinatura (mesma ordem de link_asaas_subscription, migration 0030), verifica
-- elegibilidade sob os locks, atualiza paid_until e grava auditoria na mesma
-- transação PostgreSQL. Qualquer erro desfaz tudo.
--
-- A função só é executável pelo backend com service_role. A Server Action
-- continua exigindo super_admin + MFA aal2 e valida flag/URL de Staging antes
-- de chamar esta RPC. Ela não chama Asaas nem registra pagamento.

create or replace function public.grant_staging_trial(
  p_company_id uuid,
  p_admin_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_asaas_customer_id text;
  v_subscription_id uuid;
  v_status text;
  v_paid_until timestamptz;
  v_asaas_subscription_id text;
  v_admin_name text;
  v_new_paid_until timestamptz;
  v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_company_id is null then
    raise exception 'INVALID_COMPANY_ID';
  end if;
  if p_admin_id is null then
    raise exception 'INVALID_ADMIN_ID';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 200 then
    raise exception 'INVALID_TRIAL_REASON';
  end if;

  select coalesce(p.name, 'Super admin')
    into v_admin_name
    from public.profiles p
    where p.id = p_admin_id and p.role = 'super_admin';
  if not found then
    raise exception 'ADMIN_NOT_AUTHORIZED';
  end if;

  -- Ordem intencional: empresa antes da assinatura. link_asaas_subscription
  -- também atualiza a empresa antes de tocar na assinatura; assim as duas
  -- operações serializam pelo mesmo lock e esta leitura vê o vínculo vencedor.
  select c.asaas_customer_id
    into v_company_asaas_customer_id
    from public.companies c
    where c.id = p_company_id
    for update;
  if not found then
    return jsonb_build_object('status', 'company_not_found');
  end if;
  if v_company_asaas_customer_id is not null then
    return jsonb_build_object('status', 'company_asaas_linked');
  end if;

  select s.id, s.status, s.paid_until, s.asaas_subscription_id
    into v_subscription_id, v_status, v_paid_until, v_asaas_subscription_id
    from public.subscriptions s
    where s.company_id = p_company_id
    order by s.created_at desc
    limit 1
    for update;
  if not found then
    return jsonb_build_object('status', 'subscription_not_found');
  end if;

  if v_status is distinct from 'ativa'
     or v_asaas_subscription_id is not null
     or v_paid_until is null
     or not isfinite(v_paid_until)
     or v_paid_until > transaction_timestamp() then
    return jsonb_build_object('status', 'subscription_not_eligible');
  end if;

  v_new_paid_until := transaction_timestamp() + interval '168 hours';
  update public.subscriptions s
    set paid_until = v_new_paid_until
    where s.id = v_subscription_id
      and s.company_id = p_company_id
      and s.status = 'ativa'
      and s.asaas_subscription_id is null
      and s.paid_until = v_paid_until;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'STAGING_TRIAL_UPDATE_NOT_APPLIED';
  end if;

  insert into public.admin_audit_log (
    admin_id,
    admin_name,
    action,
    target_company_id,
    details
  ) values (
    p_admin_id,
    v_admin_name,
    'conceder_trial_staging',
    p_company_id,
    jsonb_build_object(
      'days', 7,
      'reason', btrim(p_reason),
      'previous_paid_until', v_paid_until,
      'new_paid_until', v_new_paid_until,
      'provider', 'none'
    )
  );

  return jsonb_build_object(
    'status', 'granted',
    'days', 7,
    'previous_paid_until', v_paid_until,
    'new_paid_until', v_new_paid_until
  );
end;
$$;

revoke all on function public.grant_staging_trial(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.grant_staging_trial(uuid, uuid, text) to service_role;
