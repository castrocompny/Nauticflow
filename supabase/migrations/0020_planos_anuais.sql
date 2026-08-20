-- Planos anuais: cobranca no ciclo YEARLY do Asaas, com "2 meses gratis" (10x o mensal).
--
-- Como o webhook do Asaas descobre a assinatura pela empresa (nao sabe o ciclo do
-- pagamento em si), o ciclo precisa ficar gravado NA subscription pra ele saber somar
-- 30 ou 365 dias. O preco anual fica na tabela plans (um preco por tier, sem duplicar
-- planos "start_anual").

-- ciclo da assinatura -- fonte da verdade que webhook/admin leem pra somar o prazo certo
alter table public.subscriptions
  add column if not exists billing_cycle text not null default 'mensal'
    check (billing_cycle in ('mensal', 'anual'));

-- preco anual por plano (2 meses gratis = 10x o mensal)
alter table public.plans add column if not exists price_cents_yearly int;

update public.plans set price_cents_yearly = 147000 where code = 'start';
update public.plans set price_cents_yearly = 297000 where code = 'profissional';
update public.plans set price_cents_yearly = 597000 where code = 'premium';

-- recria a funcao de vinculo com o parametro de ciclo. A assinatura da funcao mudou
-- (3 -> 4 args), entao dropamos a antiga antes de recriar.
drop function if exists public.link_asaas_subscription(text, text, text);

create or replace function public.link_asaas_subscription(
  p_customer_id text,
  p_subscription_id text,
  p_plan_code text,
  p_billing_cycle text default 'mensal'
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
  v_cycle text;
begin
  v_company_id := public.current_company_id();
  if v_company_id is null then
    raise exception 'Usuário sem empresa vinculada.';
  end if;

  -- so aceita ciclos validos; qualquer outra coisa cai pra mensal
  v_cycle := case when p_billing_cycle = 'anual' then 'anual' else 'mensal' end;

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
    insert into public.subscriptions (company_id, plan_id, status, asaas_subscription_id, billing_cycle)
    values (v_company_id, v_plan_id, 'pendente', p_subscription_id, v_cycle);
  else
    update public.subscriptions
      set plan_id = v_plan_id, asaas_subscription_id = p_subscription_id, billing_cycle = v_cycle
      where id = v_sub_id;
  end if;
end;
$$;

grant execute on function public.link_asaas_subscription(text, text, text, text) to authenticated;
