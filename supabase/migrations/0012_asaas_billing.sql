-- Integracao com Asaas para cobranca recorrente dos planos do NauticFlow.

alter table public.companies add column if not exists asaas_customer_id text;
alter table public.subscriptions add column if not exists asaas_subscription_id text;

-- vincula a assinatura do Asaas a assinatura da PROPRIA empresa do usuario logado.
-- security definer + current_company_id() evita que o cliente precise de permissao
-- de UPDATE direta em subscriptions (que hoje so o super admin tem via RLS).
create or replace function public.link_asaas_subscription(
  p_customer_id text,
  p_subscription_id text,
  p_plan_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_plan_id uuid;
  v_sub_id uuid;
begin
  v_company_id := public.current_company_id();
  if v_company_id is null then
    raise exception 'Usuário sem empresa vinculada.';
  end if;

  update public.companies set asaas_customer_id = p_customer_id where id = v_company_id;

  select id into v_plan_id from public.plans where code = p_plan_code;
  if v_plan_id is null then
    raise exception 'Plano inválido.';
  end if;

  select id into v_sub_id from public.subscriptions
    where company_id = v_company_id
    order by created_at desc
    limit 1;

  if v_sub_id is null then
    insert into public.subscriptions (company_id, plan_id, status, asaas_subscription_id)
    values (v_company_id, v_plan_id, 'pendente', p_subscription_id);
  else
    update public.subscriptions
      set plan_id = v_plan_id, asaas_subscription_id = p_subscription_id
      where id = v_sub_id;
  end if;
end;
$$;

grant execute on function public.link_asaas_subscription(text, text, text) to authenticated;
