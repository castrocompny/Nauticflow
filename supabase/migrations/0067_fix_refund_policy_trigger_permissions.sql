-- ============================================================================
-- BUG REAL encontrado em Production, confirmado ao vivo (não suposição de
-- revisão de código) -- criação de passeio (createTourDraft, INSERT mínimo
-- em public.tours com só company_id/name) falhava pra QUALQUER operador
-- authenticated:
--
--   CREATE_TOUR_DEBUG | code=42501 | message=permission denied for function
--   is_valid_marketplace_refund_policy
--
-- CAUSA RAIZ: `is_valid_marketplace_refund_policy(jsonb)` (0055) foi
-- deliberadamente revogada de TODOS os roles (`revoke all ... from public,
-- anon, authenticated, service_role`) -- só o dono da função (postgres)
-- pode executá-la diretamente. `check_marketplace_refund_policy_guard()`
-- (0055) é uma trigger `before insert or update of marketplace_refund_
-- policy on public.tours` que CHAMA essa função auxiliar -- e, como a
-- trigger em si NÃO é `security definer`, ela roda com o privilégio de
-- quem disparou o INSERT/UPDATE (o `authenticated` da sessão do
-- operador), não do dono. Sem SECURITY DEFINER, chamar uma função
-- revogada de dentro de outra função não herda privilégio nenhum do
-- dono -- Postgres recusa com 42501 exatamente como confirmado ao vivo.
--
-- Por que isso só apareceu agora: a trigger dispara em TODO insert de
-- `tours`, mesmo quando `marketplace_refund_policy` nunca é passado (nulo
-- por default) -- `before insert or update OF <coluna>` dispara sempre em
-- INSERT (não existe "old" pra comparar), então mesmo um insert mínimo
-- como o de createTourDraft (só company_id/name) já entra na trigger e já
-- tenta chamar a função revogada, muito antes de chegar na condição `new.
-- marketplace_refund_policy is not null` que decidiria se a validação real
-- era necessária.
--
-- CORREÇÃO: `check_marketplace_refund_policy_guard()` recriada com
-- `security definer` + `set search_path = public` -- passa a rodar com o
-- privilégio do DONO (postgres), então a chamada interna a `is_valid_
-- marketplace_refund_policy` também roda como o dono, sem precisar
-- conceder EXECUTE a `authenticated`/`anon`/`service_role` em NENHUMA das
-- duas funções -- mesmo padrão de bypass interno já usado em toda RPC
-- financeira deste projeto (ex: trg_tours_base_price_reconcile, 0063).
-- `is_valid_marketplace_refund_policy` continua INTOCADA -- privada,
-- revogada de todos, nunca chamável diretamente por ninguém além do dono
-- (ou de uma função SECURITY DEFINER do mesmo dono, como esta).
--
-- Esta migration NÃO reabre/edita 0055 (já aplicada em staging e
-- Production) -- corrige cirurgicamente como migration nova, mesmo padrão
-- já usado em toda esta cadeia (0043/0064/0065/0066) pra achados
-- pós-aplicação. NÃO recria a trigger (`create or replace function`
-- atualiza o corpo que a trigger existente já referencia -- CREATE OR
-- REPLACE preserva o OID da função, então `trg_tours_marketplace_refund_
-- policy_guard` passa a executar a versão nova automaticamente, sem
-- precisar de `drop trigger`/`create trigger` de novo).
-- ============================================================================

create or replace function public.check_marketplace_refund_policy_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.marketplace_refund_policy is not null and not public.is_valid_marketplace_refund_policy(new.marketplace_refund_policy) then
    raise exception 'INVALID_REFUND_POLICY';
  end if;
  return new;
end;
$$;

-- ACL reafirmada explicitamente -- CREATE OR REPLACE preserva o GRANT que
-- já existia (revogado de tudo desde 0055), mas reafirmado aqui mesmo
-- assim, defesa em profundidade, mesmo valor já documentado em 0043/0064/
-- 0065/0066. Nenhum EXECUTE concedido a authenticated -- a trigger não
-- precisa disso (roda com o privilégio do dono via SECURITY DEFINER), e
-- ninguém deveria poder chamar esta função diretamente fora do mecanismo
-- de trigger mesmo.
revoke all on function public.check_marketplace_refund_policy_guard() from public, anon, authenticated;

-- is_valid_marketplace_refund_policy: NENHUMA alteração -- continua
-- privada, revogada de todos os roles, exatamente como a 0055 deixou.
-- Não precisa de GRANT nenhum agora que quem a chama (a trigger acima) já
-- roda como o dono.
