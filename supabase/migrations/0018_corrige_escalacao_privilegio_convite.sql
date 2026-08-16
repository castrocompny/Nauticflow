-- Corrige escalacao de privilegio critica: handle_new_user() (migration 0013)
-- confiava em invited_to_company_id/role vindos de raw_user_meta_data sem
-- validar que o usuario foi criado de fato via convite. Como esses metadados
-- tambem podem ser enviados livremente por QUALQUER pessoa via
-- supabase.auth.signUp() publico (a anon key e publica por design), um
-- atacante conseguia se auto-atribuir o company_id de qualquer empresa, e ate
-- role='super_admin' -- a mesma classe de bug que a migration 0003 ja tinha
-- corrigido (ali via UPDATE em profiles), reaberta aqui via INSERT dentro da
-- funcao SECURITY DEFINER, que ignora a restricao de coluna do GRANT.
--
-- auth.users.invited_at so e preenchido pelo GoTrue quando o usuario e criado
-- via admin.inviteUserByEmail (endpoint que exige service_role key, nunca
-- exposta ao client) -- nunca via signUp() publico. Usamos isso como sinal
-- confiavel de "foi convidado de verdade", ja que nao vem de
-- raw_user_meta_data e nao pode ser forjado pelo cliente. Alem disso, role de
-- colaborador convidado agora e sempre 'staff', fixo, ignorando qualquer valor
-- de role que venha no metadata (a UI de convite, em equipe/actions.ts, nunca
-- manda outra coisa mesmo).

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
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  if new.invited_at is not null then
    v_invited_company_id := nullif(new.raw_user_meta_data->>'invited_to_company_id', '')::uuid;
  end if;

  if v_invited_company_id is not null and exists (select 1 from public.companies where id = v_invited_company_id) then
    -- colaborador convidado de verdade: entra direto na empresa que o convidou,
    -- sem criar empresa/assinatura novas. role sempre 'staff'.
    v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);

    insert into public.profiles (id, company_id, role, name, email)
    values (new.id, v_invited_company_id, 'staff', v_user_name, new.email);

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
