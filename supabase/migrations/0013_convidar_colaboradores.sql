-- Suporte a convidar colaboradores pra empresa ja existente.
-- Quando o convite e feito via supabase.auth.admin.inviteUserByEmail com
-- options.data.invited_to_company_id preenchido, o gatilho vincula o novo
-- usuario a ESSA empresa (em vez de criar uma empresa nova, como no cadastro normal).

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
  v_invited_role text;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  v_invited_company_id := nullif(new.raw_user_meta_data->>'invited_to_company_id', '')::uuid;

  if v_invited_company_id is not null then
    -- colaborador convidado: entra direto na empresa que o convidou, sem criar empresa/assinatura novas
    v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);
    v_invited_role := coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'staff');

    insert into public.profiles (id, company_id, role, name, email)
    values (new.id, v_invited_company_id, v_invited_role, v_user_name, new.email);

    return new;
  end if;

  -- cadastro normal: cria empresa nova (dono da conta)
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

-- super admin e o proprio company_admin ja enxergam perfis da propria empresa via RLS
-- existente? nao — "proprio perfil - select" so libera o proprio id. Precisa de uma
-- policy pra ver os colegas da mesma empresa.
create policy "colegas da mesma empresa - select" on public.profiles
  for select to authenticated using (company_id = public.current_company_id());
