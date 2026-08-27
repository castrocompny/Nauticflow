-- Correção urgente de segurança, isolada da 0042 (já aplicada em produção --
-- NÃO editar aquele arquivo, ver DOCUMENTACAO.md). Exclusivamente permissões:
-- nenhuma tabela, RLS, corpo de função ou dado é alterado aqui.
--
-- ACHADO EM PRODUÇÃO (confirmado via pg_proc.proacl, leitura direta, não
-- suposição): as duas funções SECURITY DEFINER criadas pela migration 0042
-- (public.check_rate_limit, public.create_marketplace_booking) tinham EXECUTE
-- concedido a `anon` e `authenticated` -- não via PUBLIC (o "revoke ... from
-- public" da 0042 funcionou exatamente como deveria pra esse papel), mas via
-- concessão DIRETA e independente a esses dois roles. Causa: o Supabase
-- configura, a nível de projeto (fora do controle desta migration ou de
-- qualquer outra no repositório), uma política de privilégio padrão que
-- concede EXECUTE em toda função nova do schema `public` diretamente para
-- `anon`/`authenticated`/`service_role` -- independente do pseudo-role
-- PUBLIC. Revogar de PUBLIC não tocava essas concessões diretas.
--
-- Impacto real confirmado: `anon` (a chave pública embutida em qualquer app
-- cliente, sem exigir nenhum login) conseguia chamar create_marketplace_booking
-- -- uma função SECURITY DEFINER que roda com privilégio pleno, bypassando RLS
-- -- diretamente via `POST /rest/v1/rpc/create_marketplace_booking`, contornando
-- por completo a autenticação Bearer da rota /api/marketplace/bookings.
--
-- Correção cirúrgica: revoga EXECUTE de PUBLIC/anon/authenticated nomeando os
-- três explicitamente (não confia que revogar só de PUBLIC baste, foi
-- exatamente isso que já se mostrou insuficiente), e reafirma o GRANT pra
-- service_role (que já tinha, mas reafirmar não tem custo e documenta a
-- intenção explicitamente nesta migration). De propósito, NÃO mexe em
-- `ALTER DEFAULT PRIVILEGES` -- isso mudaria o comportamento para QUALQUER
-- função futura do projeto, não só estas duas, e é uma decisão maior que
-- merece auditoria própria, separada (fica registrada como pendência em
-- DOCUMENTACAO.md).

revoke execute on function public.check_rate_limit(
  p_consumer_key text, p_max_requests integer, p_window_seconds integer
) from public, anon, authenticated;

grant execute on function public.check_rate_limit(
  p_consumer_key text, p_max_requests integer, p_window_seconds integer
) to service_role;

revoke execute on function public.create_marketplace_booking(
  p_departure_id uuid, p_quantity integer, p_total_cents integer,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_customer_cpf text, p_idempotency_key text, p_request_fingerprint text,
  p_hold_minutes integer
) from public, anon, authenticated;

grant execute on function public.create_marketplace_booking(
  p_departure_id uuid, p_quantity integer, p_total_cents integer,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_customer_cpf text, p_idempotency_key text, p_request_fingerprint text,
  p_hold_minutes integer
) to service_role;
