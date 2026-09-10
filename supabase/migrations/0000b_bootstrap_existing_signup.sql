-- Rode DEPOIS de 0000_init_schema.sql.
-- Completa manualmente o cadastro da conta que já foi criada no Supabase Auth
-- (castrocompny@gmail.com) mas ficou sem empresa porque o bootstrap_company falhou
-- antes do schema existir. Não precisa criar a conta de novo — só entrar depois.

do $$
declare
  v_user_id uuid;
  v_company_id uuid;
  v_plan_id uuid;
begin
  -- replay-safe (achado ao validar 0000->0063 num Supabase novo/staging):
  -- este backfill só faz sentido pra corrigir a conta específica que
  -- existia em Production no momento em que esta migration foi escrita.
  -- Num banco novo, sem esse usuário, é NO-OP seguro. Nota à parte: este
  -- arquivo já é ignorado pelo `supabase db push` por causa do nome
  -- ("0000b" não bate o padrão `<timestamp>_name.sql` esperado pelo CLI) --
  -- não foi a causa do erro observado em staging (isso foi 0010), mas
  -- corrigido aqui por consistência, pro caso de algum dia ser aplicado por
  -- outro caminho (ex: colado manualmente no SQL Editor).
  select id into v_user_id from auth.users where email = 'castrocompny@gmail.com';
  if v_user_id is null then
    raise notice 'Usuário alvo (castrocompny@gmail.com) não existe neste ambiente; backfill histórico ignorado.';
    return;
  end if;

  if exists (select 1 from public.profiles where id = v_user_id) then
    raise notice 'Perfil já existe para este usuário, nada a fazer.';
    return;
  end if;

  insert into public.companies (name) values ('castro compny') returning id into v_company_id;

  insert into public.profiles (id, company_id, role, name, email)
  values (v_user_id, v_company_id, 'company_admin', 'joao lucas', 'castrocompny@gmail.com');

  select id into v_plan_id from public.plans where code = 'start';
  if v_plan_id is not null then
    insert into public.subscriptions (company_id, plan_id, status) values (v_company_id, v_plan_id, 'ativa');
  end if;
end $$;
