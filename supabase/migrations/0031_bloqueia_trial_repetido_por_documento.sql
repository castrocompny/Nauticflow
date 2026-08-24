-- Impede reaproveitar o trial de 7 dias infinitas vezes: excluir a conta e criar
-- outra com e-mail diferente pra ganhar mais 7 dias grátis de novo.
--
-- A trava é por CNPJ/CPF (agora obrigatório no cadastro, ver signUp() em
-- src/app/login/actions.ts), guardado numa tabela SEPARADA de "companies" -- não dá
-- pra usar a própria tabela companies pra isso porque excluir a conta apaga a linha
-- (companies.on delete cascade a partir de vários lugares), e o documento precisa
-- continuar "lembrado" mesmo depois da empresa sumir. Essa tabela nunca é apagada
-- por nenhum fluxo do app (sem FK pra companies, sem cascade nenhum).
create table public.trial_history (
  document text primary key, -- CPF/CNPJ, só dígitos
  first_used_at timestamptz not null default now(),
  company_name text
);

-- ninguém acessa essa tabela via API normal (nem select) -- só o gatilho abaixo,
-- que roda como security definer. RLS habilitada sem nenhuma policy = fechada por
-- padrão pra authenticated/anon; só postgres/service_role passam por cima da RLS.
alter table public.trial_history enable row level security;

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
  v_cnpj_digits text;
  v_terms_accepted boolean;
  v_documento_ja_usado boolean;
  v_trial_until timestamptz;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  if nullif(new.raw_user_meta_data->>'invited_to_company_id', '') is not null then
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
    -- normaliza pra só dígitos (o form manda com pontuação: 000.000.000-00 etc)
    v_cnpj_digits := nullif(regexp_replace(coalesce(v_cnpj, ''), '[^0-9]', '', 'g'), '');

    if v_cnpj_digits is null then
      -- sem documento (nao deveria acontecer, campo é obrigatório na tela, mas o
      -- signUp() público pode ser chamado direto na API) -- sem trial, direto pro
      -- "vencido" (mesmo efeito que getSubscriptionStatus já trata hoje).
      v_trial_until := now();
    else
      select exists(select 1 from public.trial_history where document = v_cnpj_digits) into v_documento_ja_usado;
      if v_documento_ja_usado then
        v_trial_until := now();
      else
        v_trial_until := now() + interval '7 days';
        insert into public.trial_history (document, company_name) values (v_cnpj_digits, v_company_name);
      end if;
    end if;

    insert into public.subscriptions (company_id, plan_id, status, paid_until)
    values (v_company_id, v_plan_id, 'ativa', v_trial_until);
  end if;

  return new;
end;
$$;
