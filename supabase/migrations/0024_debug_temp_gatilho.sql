-- TEMPORARIO -- so pra diagnosticar por que o gatilho de convite nao esta
-- pegando o caminho certo mesmo com a logica da 0018/0023 aplicada. Remove
-- depois numa migration seguinte assim que o diagnostico terminar.

create table if not exists public._debug_trigger_log (
  id serial primary key,
  created_at timestamptz default now(),
  new_id uuid,
  invited_at timestamptz,
  raw_user_meta_data jsonb
);

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
  v_city text;
  v_cnpj text;
  v_terms_accepted boolean;
  v_invited_company_id uuid;
begin
  insert into public._debug_trigger_log (new_id, invited_at, raw_user_meta_data)
  values (new.id, new.invited_at, new.raw_user_meta_data);

  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  if new.invited_at is not null then
    v_invited_company_id := nullif(new.raw_user_meta_data->>'invited_to_company_id', '')::uuid;
  end if;

  if v_invited_company_id is not null and exists (select 1 from public.companies where id = v_invited_company_id) then
    v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);

    insert into public.profiles (id, company_id, role, name, email)
    values (new.id, v_invited_company_id, 'staff', v_user_name, new.email);

    return new;
  end if;

  v_company_name := coalesce(nullif(new.raw_user_meta_data->>'company', ''), 'Minha empresa');
  v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);
  v_city := nullif(new.raw_user_meta_data->>'city', '');
  v_cnpj := nullif(new.raw_user_meta_data->>'cnpj', '');
  v_terms_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);

  insert into public.companies (name, city, cnpj) values (v_company_name, v_city, v_cnpj) returning id into v_company_id;

  insert into public.profiles (id, company_id, role, name, email, terms_accepted_at)
  values (new.id, v_company_id, 'company_admin', v_user_name, new.email, case when v_terms_accepted then now() else null end);

  select id into v_plan_id from public.plans where code = 'profissional';
  if v_plan_id is not null then
    insert into public.subscriptions (company_id, plan_id, status, paid_until)
    values (v_company_id, v_plan_id, 'ativa', now() + interval '7 days');
  end if;

  return new;
end;
$$;
