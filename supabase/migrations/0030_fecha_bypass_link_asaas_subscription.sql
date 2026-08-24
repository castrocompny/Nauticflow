-- 🔴 CRÍTICO: link_asaas_subscription() tinha "grant execute ... to authenticated"
-- (migrations 0012/0020) -- qualquer usuário logado (staff, company_admin, de
-- qualquer empresa) conseguia chamar essa função DIRETO pelo client do Supabase no
-- navegador, sem passar por startAsaasCheckout nem pelo Asaas de verdade:
--
--   supabase.rpc('link_asaas_subscription', {
--     p_customer_id: 'x', p_subscription_id: 'qualquer-coisa',
--     p_plan_code: 'premium', p_billing_cycle: 'anual'
--   })
--
-- A função é security definer e só grava na PRÓPRIA empresa (current_company_id()),
-- então não dava pra mexer em empresa de outro cliente -- mas dava pra qualquer um
-- se auto-promover pro plano Premium de graça, sem pagar nada e sem gerar cobrança
-- real no Asaas: a função só troca plan_id/asaas_subscription_id, nunca confere se o
-- p_subscription_id corresponde a uma assinatura de verdade. getSubscriptionStatus()
-- (src/lib/subscription.ts) só olha paid_until/suspended_at pra liberar uso -- nunca
-- confere subscriptions.status -- então enquanto paid_until não vencesse (ex: os 7
-- dias de trial que todo cadastro já ganha), o limite de embarcações/usuários do
-- plano Premium valia de verdade, sem pagamento nenhum.
--
-- Correção: a função para de confiar em quem a chama (não é mais "authenticated" que
-- decide qual é a empresa dela mesma) -- agora exige p_company_id explícito e só
-- pode ser chamada pelo service_role (nosso backend, depois que o pagamento real já
-- foi criado no Asaas em startAsaasCheckout). Nenhuma mudança de comportamento pro
-- fluxo legítimo, só fecha a porta que deixava chamar direto do navegador.

drop function if exists public.link_asaas_subscription(text, text, text, text);

create or replace function public.link_asaas_subscription(
  p_company_id uuid,
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
  v_plan_id uuid;
  v_sub_id uuid;
  v_cycle text;
begin
  if p_company_id is null then
    raise exception 'Empresa não informada.';
  end if;

  v_cycle := case when p_billing_cycle = 'anual' then 'anual' else 'mensal' end;

  update public.companies set asaas_customer_id = p_customer_id where id = p_company_id;

  select id into v_plan_id from public.plans where code = p_plan_code;
  if v_plan_id is null then
    raise exception 'Plano inválido.';
  end if;

  select id into v_sub_id from public.subscriptions
    where company_id = p_company_id
    order by created_at desc
    limit 1;

  if v_sub_id is null then
    insert into public.subscriptions (company_id, plan_id, status, asaas_subscription_id, billing_cycle)
    values (p_company_id, v_plan_id, 'pendente', p_subscription_id, v_cycle);
  else
    update public.subscriptions
      set plan_id = v_plan_id, asaas_subscription_id = p_subscription_id, billing_cycle = v_cycle
      where id = v_sub_id;
  end if;
end;
$$;

revoke execute on function public.link_asaas_subscription(uuid, text, text, text, text) from public;
revoke execute on function public.link_asaas_subscription(uuid, text, text, text, text) from authenticated;
revoke execute on function public.link_asaas_subscription(uuid, text, text, text, text) from anon;
grant execute on function public.link_asaas_subscription(uuid, text, text, text, text) to service_role;
