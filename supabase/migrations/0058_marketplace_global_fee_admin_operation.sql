-- Fecha a comissão global (0057): uma operação administrativa OFICIAL pra
-- configurar marketplace_fee_config -- nunca um INSERT solto executado à
-- mão. NENHUMA chamada real ao Asaas, NENHUM pagamento real ativado por
-- esta migration -- só a RPC em si, testável isoladamente. Ver docs/adr/
-- 0006-marketplace-global-commission.md (seção atualizada) para a decisão
-- completa.
--
-- NÃO editar 0052-0057 (nenhuma ainda aplicada) -- migration nova.
--
-- IMPORTANTE, distinção que resolve o "achado" da migration anterior: o
-- problema era ESPECÍFICO de rodar `insert` dentro do ARQUIVO da migration
-- (conexão de `db push`, sem contexto de JWT -- auth.role() resolve NULL).
-- Uma chamada em TEMPO DE EXECUÇÃO (via app/script usando o client normal
-- do Supabase, seja com a service_role key ou com uma sessão autenticada de
-- super_admin) TEM contexto de JWT de verdade -- auth.role()/auth.uid()
-- resolvem os valores reais da chamada. Por isso a RPC abaixo funciona
-- corretamente em produção, mesmo que um INSERT dentro do arquivo de
-- migration não funcionasse.

-- ============================================================================
-- set_marketplace_global_fee_config -- único caminho oficial pra configurar
-- a comissão GLOBAL (company_id sempre NULL aqui -- override por empresa,
-- se algum dia existir, é uma decisão de produto separada, fora do escopo
-- desta operação). Nunca sobrescreve histórico -- cada chamada INSERE uma
-- linha nova (mesmo modelo já vigente em marketplace_fee_config desde
-- 0053: nunca UPDATE, a vigente é sempre a mais recente por created_at).
--
-- SECURITY DEFINER necessário aqui: a função PRECISA inserir na tabela
-- (que não tem GRANT de INSERT pra ninguém além do dono, 0053) mesmo quando
-- chamada por uma sessão de super_admin (que não é o dono da tabela) -- sem
-- SECURITY DEFINER, um super_admin autenticado normal não teria privilégio
-- de escrita na tabela de jeito nenhum, independente de qualquer checagem
-- de role dentro da função.
--
-- NENHUMA chamada a outra função com ACL própria acontece aqui dentro (só
-- SELECT/INSERT direto na própria tabela + is_super_admin(), que já é
-- SECURITY DEFINER e sempre acessível ao dono) -- sem o padrão de risco que
-- gerou o incidente de ACL das migrations 0044/0048 (uma função interna com
-- GRANT incompatível sendo chamada por engano a partir de um contexto que
-- não deveria alcançá-la). Contexto revisado explicitamente antes de
-- definir os GRANTs abaixo.
-- ============================================================================

create or replace function public.set_marketplace_global_fee_config(
  p_fee_basis_points int,
  p_note text default null
) returns table (
  id uuid,
  fee_basis_points int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
  v_created_at timestamptz;
begin
  -- MESMA regra do guard de INSERT já existente (check_marketplace_fee_
  -- config_guard, trigger BEFORE INSERT, 0053) -- verificada aqui TAMBÉM,
  -- de propósito redundante (defesa em profundidade: mesmo que o trigger
  -- algum dia seja removido/alterado por engano numa migration futura, esta
  -- função continua correta por conta própria). service_role (chamada de
  -- backend/script) OU super_admin (sessão autenticada real) -- nunca
  -- company_admin, nunca staff, nunca authenticated comum, nunca anon.
  if auth.role() <> 'service_role' and not public.is_super_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_fee_basis_points is null or p_fee_basis_points < 0 or p_fee_basis_points > 10000 then
    raise exception 'INVALID_FEE_BASIS_POINTS';
  end if;

  -- nunca sobrescreve -- cada chamada é uma linha NOVA (histórico completo
  -- preservado, mesmo modelo de marketplace_fee_config desde 0053). A
  -- vigente continua sendo sempre a mais recente por created_at
  -- (get_current_marketplace_fee_config, 0053/0057) -- snapshots já
  -- congelados em vendas antigas (payments.fee_basis_points_snapshot,
  -- 0057) nunca são afetados por esta chamada, em nenhuma circunstância
  -- (protegidos pelo trigger de imutabilidade, não por esta função).
  insert into public.marketplace_fee_config (fee_basis_points, company_id, created_by, note)
  values (p_fee_basis_points, null, auth.uid(), p_note)
  returning marketplace_fee_config.id, marketplace_fee_config.created_at
    into v_new_id, v_created_at;

  return query select v_new_id, p_fee_basis_points, v_created_at;
end;
$$;

-- ACL: PUBLIC/anon sem EXECUTE (revogado explicitamente). `authenticated` é
-- concedido de PROPÓSITO (não é uma contradição com "authenticated comum:
-- nunca") -- é o único jeito de um super_admin, que autentica como uma
-- sessão `authenticated` normal (não existe um papel Postgres/PostgREST
-- separado pra super_admin neste projeto), conseguir chamar isto pela API.
-- A restrição real não é a ACL do Postgres -- é a checagem de
-- auth.role()/is_super_admin() DENTRO da função, que barra qualquer
-- authenticated que não seja super_admin com 'FORBIDDEN'. `service_role` é
-- concedido pro caminho de backend/script.
revoke all on function public.set_marketplace_global_fee_config(int, text) from public, anon;
grant execute on function public.set_marketplace_global_fee_config(int, text) to service_role, authenticated;
