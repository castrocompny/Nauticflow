-- Próxima etapa financeira do marketplace ToursFlow: chave Pix de destino do
-- operador (pra onde um saque futuro transferiria o saldo `available`) +
-- painel financeiro read-only pro operador ver o próprio saldo. NENHUMA
-- transferência real, NENHUM saque real, NENHUMA validação de titularidade no
-- provider acontece por causa desta migration -- só cadastro/leitura seguros,
-- mascarados, testados isoladamente. Ver docs/adr/0003-marketplace-payout-
-- destination-and-release-policy.md para a decisão completa.
--
-- NÃO editar 0052/0053 (ainda não aplicadas) -- migration nova, mesmo padrão
-- de sempre neste projeto.
--
-- DIFERENÇA DE MODELO DE CONFIANÇA em relação às RPCs de 0052/0053: aquelas
-- são server-to-server (ToursFlow -> NauticFlow via service_role, nunca uma
-- sessão de usuário). As RPCs desta migration são o OPOSTO -- self-service do
-- PRÓPRIO operador, chamadas pela sessão autenticada normal dele
-- (authenticated, nunca service_role) -- é o operador cadastrando/vendo a
-- própria conta de recebimento pelo painel do NauticFlow, não o ToursFlow
-- fazendo nada. Por isso o padrão de ACL aqui é invertido: revoke de
-- public/anon/service_role, grant só pra authenticated -- e toda RPC deriva
-- company_id/role de auth.uid() internamente, nunca aceita um id de fora
-- (fecha IDOR por construção -- não existe parâmetro "company_id" em nenhuma
-- RPC desta migration pro chamador informar).

-- ============================================================================
-- CHAVE PIX -- nunca senha bancária, nunca credencial de banco. Só o tipo +
-- valor da chave, o mínimo pra um provider real (Fase futura) processar um
-- payout. Validar FORMATO aqui não confirma TITULARIDADE -- ver comentário no
-- topo de src/lib/payout-accounts.ts (mesma lógica espelhada nos dois
-- lugares, mesmo contrato de manutenção já usado pra CPF/CNPJ/comissão/
-- reembolso neste projeto).
-- ============================================================================

create table public.marketplace_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  pix_key_type text not null check (pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'evp')),
  -- valor JÁ NORMALIZADO (dígitos puros pra cpf/cnpj/telefone, minúsculas pra
  -- email/evp) -- nunca o texto bruto como o operador digitou. NUNCA lido
  -- cru por ninguém fora das RPCs desta migration (nem service_role -- ver
  -- REVOKE abaixo). Sem uso real de transferência ainda -- quando a
  -- integração real com o Asaas existir, uma RPC NOVA e dedicada (service_
  -- role-only) lerá isto, não esta migration.
  pix_key_normalized text not null,
  -- 'unverified': formato validado, titularidade NÃO confirmada no provider
  -- (não existe integração real ainda). 'superseded': linha histórica, nunca
  -- apagada -- substituída por uma troca de chave posterior. Nenhum estado
  -- "verified"/"active" existe nesta fase -- seria inventar uma confirmação
  -- que não aconteceu de verdade.
  status text not null default 'unverified' check (status in ('unverified', 'superseded')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  superseded_at timestamptz
);

create index on public.marketplace_payout_accounts (company_id);

-- no máximo UMA conta "corrente" (não substituída) por empresa por vez --
-- trocar a chave nunca apaga a anterior, só marca como superseded (histórico/
-- auditabilidade preservados, pedido explícito desta fase).
create unique index marketplace_payout_accounts_one_current_per_company
  on public.marketplace_payout_accounts (company_id)
  where status <> 'superseded';

alter table public.marketplace_payout_accounts enable row level security;
-- NENHUM SELECT/INSERT/UPDATE direto pra ninguém, nem service_role -- só as
-- RPCs abaixo (SECURITY DEFINER, dono da tabela) tocam nesta tabela. Mais
-- rígido que o padrão de payments/trial_identity_secret (que ao menos
-- liberam SELECT pro service_role) -- decisão deliberada: não existe HOJE
-- nenhuma necessidade legítima de ler a chave crua (nenhum payout real
-- ainda), então nenhum caminho de leitura crua existe, nem pro backend.
-- Quando a integração real existir, essa é uma decisão nova, explícita,
-- de uma migration futura.
revoke all on table public.marketplace_payout_accounts from public, anon, authenticated, service_role;

comment on table public.marketplace_payout_accounts is
  'Chave Pix de destino de saque do operador (marketplace) -- NUNCA senha bancária. Formato validado, titularidade NÃO confirmada (sem integração real com provider ainda). Histórico preservado via status=superseded, nunca DELETE. Coluna pix_key_normalized nunca lida crua por ninguém -- só via RPCs desta migration, que devolvem sempre a versão MASCARADA.';

-- ============================================================================
-- MASCARAMENTO -- espelha exatamente src/lib/payout-accounts.ts::maskPixKey.
-- Função interna (nunca exposta diretamente) -- só as duas RPCs de leitura
-- abaixo chamam.
-- ============================================================================

create or replace function public.mask_pix_key(p_pix_key_type text, p_pix_key_normalized text)
returns text
language plpgsql
immutable
as $$
declare
  v_at int;
begin
  if p_pix_key_normalized is null then
    return null;
  end if;

  case p_pix_key_type
    when 'cpf' then
      return '***.***.***-' || right(p_pix_key_normalized, 2);
    when 'cnpj' then
      return '**.***.***/****-' || right(p_pix_key_normalized, 2);
    when 'telefone' then
      return '(**) *****-' || right(p_pix_key_normalized, 4);
    when 'email' then
      v_at := position('@' in p_pix_key_normalized);
      if v_at <= 1 then
        return '***';
      end if;
      return left(p_pix_key_normalized, least(2, v_at - 1)) || '***@' || substr(p_pix_key_normalized, v_at + 1);
    when 'evp' then
      return left(p_pix_key_normalized, 8) || '...' || right(p_pix_key_normalized, 6);
    else
      return '***';
  end case;
end;
$$;

revoke all on function public.mask_pix_key(text, text) from public, anon, authenticated, service_role;

-- ============================================================================
-- CADASTRAR/TROCAR A CHAVE -- self-service do operador, `authenticated`
-- (nunca service_role). Revalida formato AQUI DENTRO também (nunca confia
-- que o chamador -- mesmo sendo a UI oficial -- já validou de verdade, mesmo
-- espírito de "amount sempre recalculado server-side" já usado em todo o
-- marketplace). company_id vem SEMPRE de auth.uid() -> profiles, nunca de um
-- parâmetro -- fecha IDOR por construção.
-- ============================================================================

create or replace function public.set_marketplace_payout_account(
  p_pix_key_type text,
  p_pix_key_normalized text
) returns table (
  id uuid,
  pix_key_type text,
  pix_key_masked text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_new_id uuid;
  v_created_at timestamptz;
begin
  select p.company_id, p.role into v_company_id, v_role
    from public.profiles p
    where p.id = auth.uid();

  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;
  -- staff não mexe em recebimento -- mesmo corte já usado na página
  -- Financeiro (src/app/(app)/financeiro/page.tsx: "faturamento nao e coisa
  -- de operador (staff) ver"), reforçado aqui no banco, não só na UI.
  if v_role not in ('company_admin', 'super_admin') then
    raise exception 'FORBIDDEN';
  end if;

  if p_pix_key_type not in ('cpf', 'cnpj', 'email', 'telefone', 'evp') then
    raise exception 'INVALID_PIX_KEY_TYPE';
  end if;
  if p_pix_key_normalized is null or length(p_pix_key_normalized) = 0 then
    raise exception 'INVALID_PIX_KEY';
  end if;

  -- checksum REAL pra cpf/cnpj -- reaproveita as funções já existentes e já
  -- testadas da Fase de trial anti-abuso (migration 0045), nunca duplica o
  -- algoritmo em mais um lugar de SQL. Regex/tamanho pros demais tipos.
  if p_pix_key_type = 'cpf' and not public.trial_validate_cpf(p_pix_key_normalized) then
    raise exception 'INVALID_PIX_KEY';
  end if;
  if p_pix_key_type = 'cnpj' and not public.trial_validate_cnpj(p_pix_key_normalized) then
    raise exception 'INVALID_PIX_KEY';
  end if;
  if p_pix_key_type = 'email' and (
    p_pix_key_normalized !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_pix_key_normalized) > 320
  ) then
    raise exception 'INVALID_PIX_KEY';
  end if;
  if p_pix_key_type = 'telefone' and p_pix_key_normalized !~ '^\d{10,11}$' then
    raise exception 'INVALID_PIX_KEY';
  end if;
  if p_pix_key_type = 'evp' and p_pix_key_normalized !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INVALID_PIX_KEY';
  end if;

  -- substitui a conta corrente -- NUNCA apaga (histórico/auditabilidade).
  -- Race de duas trocas concorrentes da MESMA empresa: serializada
  -- naturalmente pelo lock de linha do UPDATE (a segunda espera a primeira
  -- committar, depois vê a linha da primeira já "corrente" e a substitui por
  -- cima -- último a committar vence, sem violar o unique index e sem
  -- precisar de advisory lock: não há checagem de saldo/recurso finito aqui,
  -- é só "qual foi a última chave que o operador salvou", mesmo espírito de
  -- um formulário de configurações comum).
  update public.marketplace_payout_accounts
    set status = 'superseded', superseded_at = now()
    where company_id = v_company_id and status <> 'superseded';

  insert into public.marketplace_payout_accounts (company_id, pix_key_type, pix_key_normalized, created_by)
  values (v_company_id, p_pix_key_type, p_pix_key_normalized, auth.uid())
  returning marketplace_payout_accounts.id, marketplace_payout_accounts.created_at
    into v_new_id, v_created_at;

  return query select v_new_id, p_pix_key_type, public.mask_pix_key(p_pix_key_type, p_pix_key_normalized),
    'unverified'::text, v_created_at;
end;
$$;

revoke all on function public.set_marketplace_payout_account(text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_marketplace_payout_account(text, text) to authenticated;

-- ============================================================================
-- LER A CONTA CORRENTE (mascarada) -- mesmo modelo de confiança do SET.
-- ============================================================================

create or replace function public.get_marketplace_payout_account()
returns table (
  id uuid,
  pix_key_type text,
  pix_key_masked text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_row record;
begin
  select p.company_id, p.role into v_company_id, v_role
    from public.profiles p
    where p.id = auth.uid();

  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;
  if v_role not in ('company_admin', 'super_admin') then
    raise exception 'FORBIDDEN';
  end if;

  select a.id, a.pix_key_type, a.pix_key_normalized, a.status, a.created_at
    into v_row
    from public.marketplace_payout_accounts a
    where a.company_id = v_company_id and a.status <> 'superseded'
    limit 1;

  if not found then
    return; -- nenhuma conta cadastrada ainda -- zero linhas, não erro
  end if;

  return query select v_row.id, v_row.pix_key_type,
    public.mask_pix_key(v_row.pix_key_type, v_row.pix_key_normalized), v_row.status, v_row.created_at;
end;
$$;

revoke all on function public.get_marketplace_payout_account() from public, anon, authenticated, service_role;
grant execute on function public.get_marketplace_payout_account() to authenticated;

-- ============================================================================
-- PAINEL FINANCEIRO -- saldo (blocked/available/pending_withdrawal/
-- transferred, derivado ao vivo -- ver get_marketplace_operator_balances,
-- 0053) + conta de recebimento mascarada, tudo numa chamada só, sempre
-- escopado à PRÓPRIA empresa do chamador (nunca um parâmetro de company_id).
-- Não expõe o ledger bruto -- só os 4 saldos agregados, mesma superfície que
-- o ToursFlow nunca vê e o operador não precisa ver linha a linha aqui.
-- ============================================================================

create or replace function public.get_marketplace_financial_summary()
returns table (
  blocked_balance_cents bigint,
  available_balance_cents bigint,
  pending_withdrawal_cents bigint,
  transferred_cents bigint,
  payout_pix_key_type text,
  payout_pix_key_masked text,
  payout_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_role text;
  v_balances record;
  v_payout record;
begin
  select p.company_id, p.role into v_company_id, v_role
    from public.profiles p
    where p.id = auth.uid();

  if v_company_id is null then
    raise exception 'SESSION_INVALID';
  end if;
  if v_role not in ('company_admin', 'super_admin') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_balances from public.get_marketplace_operator_balances(v_company_id);

  select a.pix_key_type, a.pix_key_normalized, a.status
    into v_payout
    from public.marketplace_payout_accounts a
    where a.company_id = v_company_id and a.status <> 'superseded'
    limit 1;

  return query select
    v_balances.blocked_balance_cents,
    v_balances.available_balance_cents,
    v_balances.pending_withdrawal_cents,
    v_balances.transferred_cents,
    v_payout.pix_key_type,
    case when v_payout.pix_key_type is not null
      then public.mask_pix_key(v_payout.pix_key_type, v_payout.pix_key_normalized)
      else null
    end,
    v_payout.status;
end;
$$;

revoke all on function public.get_marketplace_financial_summary() from public, anon, authenticated, service_role;
grant execute on function public.get_marketplace_financial_summary() to authenticated;
