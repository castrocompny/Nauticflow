-- NAUTICFLOW — NF-01: operador não pode mais alterar colunas administrativas
-- da própria empresa (suspensão, integração Asaas) via UPDATE direto.
--
-- Achado da auditoria pós-hardening (2026-09-22): a policy "propria empresa -
-- update" (migration 0000) libera UPDATE na linha inteira da própria empresa
-- pra qualquer `authenticated` -- não restringe coluna nenhuma. O único guard
-- existente (trg_company_asaas_receiver_guard, 0052) cobre só asaas_wallet_id/
-- asaas_receiver_status. Resultado: uma empresa suspensa conseguia apagar a
-- própria suspensão com um PATCH direto no PostgREST usando o próprio JWT:
--
--   supabase.from('companies').update({ suspended_at: null }).eq('id', <própria>)
--
-- e do mesmo jeito trocar asaas_customer_id (vínculo da cobrança SaaS). A
-- checagem de cargo em updateSettings (src/app/(app)/configuracoes/actions.ts)
-- também só existia na Server Action -- staff conseguia editar os dados da
-- empresa chamando o PostgREST direto.
--
-- Por que trigger e não GRANT por coluna: super_admin usa o MESMO papel de
-- banco `authenticated` que o operador (suspendCompany/unsuspendCompany em
-- src/app/admin/actions.ts rodam com a sessão do super admin, não com
-- service_role) -- revogar a coluna do papel travaria o painel admin também.
-- O trigger consegue distinguir quem é quem (is_super_admin()), mesmo padrão
-- já usado em 0044 (suspensão de passeio) e 0052.
--
-- ALLOWLIST, não blacklist: o operador só pode mudar as colunas listadas em
-- v_tenant_editable -- qualquer outra coluna, inclusive colunas NOVAS que
-- forem adicionadas no futuro, fica bloqueada por padrão até alguém incluir
-- aqui de propósito. Hoje a lista é exatamente o que updateSettings grava.
--
-- IDENTIDADE = a do REQUEST (claims do JWT via auth.role()/auth.uid()),
-- NUNCA current_user. Dentro de uma função SECURITY DEFINER, current_user
-- vira o DONO da função (postgres) -- liberar por current_user deixaria
-- qualquer SECURITY DEFINER futura que faça UPDATE em companies passar
-- direto pelo guard mesmo chamada por um operador. As claims do JWT, ao
-- contrário, continuam sendo as de quem originou o request em qualquer
-- profundidade de chamada. Mesmo modelo de 0052/0053/0058.
--
-- DEFAULT DENY -- só passa o que está reconhecido explicitamente:
--   - auth.role() = 'service_role': backend (admin client / Edge Functions),
--     inclusive SECURITY DEFINER chamada por ele, ex.: link_asaas_subscription
--     (0030), que grava asaas_customer_id;
--   - auth.role() = 'authenticated':
--       super_admin (is_super_admin(), derivado de auth.uid() ->
--       profiles.role, que o próprio usuário não altera desde a 0003) -> livre;
--       company_admin -> só a allowlist;
--       staff (ou sem profile) -> nenhuma alteração;
--   - qualquer outra coisa -- anon, role desconhecido, sessão SEM JWT
--     (migration via db push, SQL direto como postgres) -> bloqueado.
--
-- session_user NÃO é usado: em todo request do PostgREST ele é sempre o
-- papel de conexão (authenticator), então não separa uma SECURITY DEFINER
-- chamada por authenticated de uma chamada por service_role; e em sessão
-- direta o nome do papel de login varia por ferramenta (não confirmável
-- a partir deste repositório). Manutenção SQL direta, quando realmente
-- necessária, precisa se identificar EXPLICITAMENTE na mesma transação --
-- mesmo caminho de um request do backend, nunca uma liberação implícita:
--
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   update public.companies set ... where id = '...';
--   commit;
--
-- (Nenhuma RPC exposta chama set_config -- um operador não consegue forjar
-- essas claims pelo PostgREST; só quem já tem SQL direto no banco.)
--
-- Comparação via to_jsonb(old/new) com IS DISTINCT FROM: reenviar o MESMO
-- valor numa coluna protegida é no-op e passa (não muda nada); qualquer
-- mudança real -- inclusive pra/de NULL -- aborta o statement inteiro, sem
-- gravar parcialmente as colunas permitidas do mesmo UPDATE.
--
-- Sem SECURITY DEFINER: a função roda como quem fez o UPDATE e só lê o
-- próprio profile (policy "proprio perfil - select", 0000) e chama
-- is_super_admin() (que já é definer e executável por authenticated).
-- search_path fixo mesmo assim.

create or replace function public.check_company_tenant_update_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tenant_editable text[] := array[
    'name',
    'cnpj',
    'city',
    'phone',
    'weather_latitude',
    'weather_longitude',
    'weather_location_name'
  ];
  v_request_role text := auth.role();
  v_role text;
begin
  if v_request_role = 'service_role' then
    return new;
  end if;

  if v_request_role is distinct from 'authenticated' then
    raise exception 'Alteração de empresa não autorizada para este contexto.'
      using errcode = '42501';
  end if;

  if public.is_super_admin() then
    return new;
  end if;

  if (to_jsonb(new) - v_tenant_editable) is distinct from (to_jsonb(old) - v_tenant_editable) then
    raise exception 'Somente o super admin pode alterar dados administrativos desta empresa.'
      using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'company_admin' and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Só o administrador da empresa pode alterar os dados da empresa.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_company_tenant_update_guard on public.companies;
create trigger trg_company_tenant_update_guard
  before update on public.companies
  for each row execute function public.check_company_tenant_update_guard();

revoke all on function public.check_company_tenant_update_guard() from public, anon, authenticated;
