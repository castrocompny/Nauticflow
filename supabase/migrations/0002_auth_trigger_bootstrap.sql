-- Corrige a causa raiz do cadastro "pela metade": antes, a criação da empresa dependia
-- de uma chamada RPC feita pelo navegador logo após o signUp, autenticada com a sessão
-- do usuário recém-criado. Se a confirmação de e-mail estiver ativa (ou a sessão demorar,
-- ou a aba fechar, ou a rede falhar nesse meio-tempo), essa chamada roda sem usuário
-- autenticado e falha silenciosamente, deixando um auth.users sem empresa/perfil.
--
-- Este gatilho roda dentro do próprio banco, na mesma transação que cria o usuário em
-- auth.users — não depende de nenhuma requisição HTTP subsequente ter sucesso.
-- Nome da empresa e do usuário vêm de options.data no supabase.auth.signUp() do cliente
-- (fica em raw_user_meta_data). Rode este script no SQL Editor do Supabase.

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
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  v_company_name := coalesce(nullif(new.raw_user_meta_data->>'company', ''), 'Minha empresa');
  v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);

  insert into public.companies (name) values (v_company_name) returning id into v_company_id;

  insert into public.profiles (id, company_id, role, name, email)
  values (new.id, v_company_id, 'company_admin', v_user_name, new.email);

  select id into v_plan_id from public.plans where code = 'start';
  if v_plan_id is not null then
    insert into public.subscriptions (company_id, plan_id, status) values (v_company_id, v_plan_id, 'ativa');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- a função antiga fica sem uso (o app não chama mais supabase.rpc('bootstrap_company', ...)),
-- mas não precisa apagar: manter não tem custo e evita quebrar algo que ainda referencie ela.
