-- Reafirma handle_new_user() exatamente como definido na migration 0018.
--
-- Motivo: em produção, convites recentes (auth.users criado via
-- admin.inviteUserByEmail, com invited_at preenchido e
-- raw_user_meta_data.invited_to_company_id apontando pra uma empresa
-- existente de verdade) estavam caindo no ramo de "cadastro normal" do
-- gatilho -- criando uma empresa nova ("Minha empresa") com o convidado
-- como company_admin, em vez de entrar como staff na empresa de quem
-- convidou. O comportamento observado bate exatamente com a versão
-- ORIGINAL da função (migration 0002, antes de qualquer lógica de convite
-- existir) -- sinal de que o banco de produção ficou com uma versão
-- desatualizada da função, apesar do histórico de migrations (tabela
-- supabase_migrations.schema_migrations) mostrar 0018 como aplicada.
--
-- Este script não muda nenhuma lógica -- é uma cópia idêntica do corpo da
-- migration 0018 (já revisada por segurança na época: corrige escalação de
-- privilégio via invited_at/invited_to_company_id forjável). Reaplicar via
-- CREATE OR REPLACE garante que o banco de produção rode exatamente essa
-- versão, resolvendo o desalinhamento independente da causa raiz dele.

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
