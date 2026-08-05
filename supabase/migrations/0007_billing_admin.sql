-- Cobranca do SaaS: cada assinatura tem uma data "paga ate". Contas novas ganham
-- 7 dias de teste gratis (definido no gatilho de cadastro). Quando essa data passa,
-- o app bloqueia o acesso da empresa (ver layout.tsx) ate o pagamento ser renovado
-- manualmente pelo super admin (voce) no painel /admin.

alter table public.subscriptions add column if not exists paid_until timestamptz;

-- empresas ja existentes (de teste) ganham 30 dias pra nao serem bloqueadas por engano
update public.subscriptions set paid_until = now() + interval '30 days' where paid_until is null;

-- dai pra frente, todo cadastro novo comeca com 7 dias de teste gratis
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_plan_id uuid;
  v_company_name text;
  v_user_name text;
  v_terms_accepted boolean;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  v_company_name := coalesce(nullif(new.raw_user_meta_data->>'company', ''), 'Minha empresa');
  v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);
  v_terms_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);

  insert into public.companies (name) values (v_company_name) returning id into v_company_id;

  insert into public.profiles (id, company_id, role, name, email, terms_accepted_at)
  values (new.id, v_company_id, 'company_admin', v_user_name, new.email, case when v_terms_accepted then now() else null end);

  select id into v_plan_id from public.plans where code = 'start';
  if v_plan_id is not null then
    insert into public.subscriptions (company_id, plan_id, status, paid_until)
    values (v_company_id, v_plan_id, 'ativa', now() + interval '7 days');
  end if;

  return new;
end;
$$;

-- funcao auxiliar: le o role do usuario logado ignorando RLS (mesmo padrao de current_company_id)
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false);
$$;

-- super admin enxerga todas as empresas e pode gerenciar (renovar) qualquer assinatura
create policy "super admin - ve todas as empresas" on public.companies
  for select to authenticated using (public.is_super_admin());

create policy "super admin - gerencia assinaturas" on public.subscriptions
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- promove a conta que vai administrar o SaaS
update public.profiles set role = 'super_admin' where email = 'castrocompny@gmail.com';
