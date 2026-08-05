-- Registra quando o usuário aceitou os Termos de Uso e a Política de Privacidade
-- no cadastro (evidência de consentimento, exigida pela LGPD).

alter table public.profiles add column if not exists terms_accepted_at timestamptz;

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
    insert into public.subscriptions (company_id, plan_id, status) values (v_company_id, v_plan_id, 'ativa');
  end if;

  return new;
end;
$$;
