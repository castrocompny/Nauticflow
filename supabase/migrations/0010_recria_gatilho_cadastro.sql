-- O gatilho on_auth_user_created sumiu do banco (a funcao handle_new_user continuava
-- existindo, mas nada mais chamava ela em cadastros novos). Recria o gatilho.

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- conserta manualmente a conta que ficou sem empresa por causa disso
do $$
declare
  v_user_id uuid;
  v_company_id uuid;
  v_plan_id uuid;
begin
  select id into v_user_id from auth.users where email = 'davimagi1234@gmail.com';
  if v_user_id is null then
    raise exception 'Usuário não encontrado em auth.users.';
  end if;

  if exists (select 1 from public.profiles where id = v_user_id) then
    raise notice 'Perfil já existe para este usuário, nada a fazer.';
    return;
  end if;

  insert into public.companies (name) values ('Minha empresa') returning id into v_company_id;

  insert into public.profiles (id, company_id, role, name, email)
  values (v_user_id, v_company_id, 'company_admin', 'davimagi1234@gmail.com', 'davimagi1234@gmail.com');

  select id into v_plan_id from public.plans where code = 'start';
  if v_plan_id is not null then
    insert into public.subscriptions (company_id, plan_id, status, paid_until)
    values (v_company_id, v_plan_id, 'ativa', now() + interval '7 days');
  end if;
end $$;
