-- Corrige o bug de fato: auth.users.invited_at NAO vem preenchido no INSERT
-- que dispara on_auth_user_created -- o GoTrue grava a linha primeiro e só
-- preenche invited_at num UPDATE logo em seguida (confirmado com um log de
-- diagnóstico temporário: new.invited_at chegou null no gatilho de INSERT
-- mesmo para um convite real, com raw_user_meta_data.invited_to_company_id
-- já certo). Por isso a condição "if new.invited_at is not null" da migration
-- 0018/0023 nunca era verdadeira, e todo convite caía no caminho de "cadastro
-- normal" -- criava empresa nova pro convidado, sempre como company_admin.
--
-- Correção: handle_new_user() (AFTER INSERT) agora só cria empresa/perfil na
-- hora se NÃO houver sinal de convite (raw_user_meta_data sem
-- invited_to_company_id) -- fluxo normal de "Criar conta", sem mudança
-- nenhuma. Se houver esse sinal, não faz nada ainda e espera o gatilho novo
-- abaixo, que dispara quando invited_at É preenchido de verdade pelo GoTrue
-- (só a API admin.inviteUserByEmail, que exige service_role, preenche esse
-- campo -- nunca o signUp() público, então continua impossível forjar).
--
-- Isso preserva a mesma garantia de segurança da migration 0018 (nunca confia
-- em invited_to_company_id sozinho, só quando confirmado por invited_at vindo
-- do próprio GoTrue), só move a checagem pro momento em que o dado realmente
-- existe.

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
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  -- ha sinal de convite no metadata: nao cria nada agora -- espera
  -- on_auth_user_invited confirmar via invited_at (preenchido num UPDATE
  -- logo depois deste INSERT, ainda na mesma operacao do GoTrue)
  if nullif(new.raw_user_meta_data->>'invited_to_company_id', '') is not null then
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

create or replace function public.handle_invited_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invited_company_id uuid;
  v_user_name text;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  v_invited_company_id := nullif(new.raw_user_meta_data->>'invited_to_company_id', '')::uuid;

  if v_invited_company_id is not null and exists (select 1 from public.companies where id = v_invited_company_id) then
    v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);

    insert into public.profiles (id, company_id, role, name, email)
    values (new.id, v_invited_company_id, 'staff', v_user_name, new.email);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_invited on auth.users;
create trigger on_auth_user_invited
  after update of invited_at on auth.users
  for each row
  when (old.invited_at is null and new.invited_at is not null)
  execute function public.handle_invited_user();

-- limpeza do diagnostico temporario (migration 0024)
drop trigger if exists on_auth_user_created_debug on auth.users;
drop table if exists public._debug_trigger_log;
