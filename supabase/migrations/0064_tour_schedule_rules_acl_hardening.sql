-- ============================================================================
-- ACL HARDENING de tour_schedule_rules -- achado real em validação funcional
-- no Supabase STAGING (ddlgkrpjzmtgmoucangh), depois de 0063 já aplicada.
--
-- ACHADO (confirmado via has_table_privilege() direto no banco, não
-- suposição): `authenticated` conseguia INSERT/UPDATE/DELETE diretos em
-- public.tour_schedule_rules, mesmo a 0063 só tendo escrito
-- `grant select on public.tour_schedule_rules to authenticated;`.
--
-- CAUSA RAIZ: mesmo padrão já documentado em 0043_fecha_execute_rpc_
-- marketplace.sql, mas do lado de TABELA em vez de FUNÇÃO -- este projeto
-- Supabase tem, a nível de projeto (fora do controle de qualquer migration
-- deste repositório), uma política de privilégio padrão que concede
-- INSERT/UPDATE/DELETE em toda TABELA NOVA do schema `public` diretamente
-- para `authenticated` (visível em information_schema.role_table_grants,
-- grantor = postgres, não referenciado em nenhum GRANT explícito de 0063).
-- `grant select ...` na 0063 ADICIONOU select (redundante com o default),
-- mas nunca REVOGOU o insert/update/delete que o projeto já concede por
-- padrão -- exatamente o mesmo tipo de lacuna já visto com EXECUTE em
-- função (0043) e SELECT de anon (ver DOCUMENTACAO.md/memória do projeto:
-- "Supabase concede grants por padrão -- GRANT restrito sozinho não protege
-- nada sem REVOKE explícito antes").
--
-- A policy RLS "agenda do passeio da empresa" (0063) foi criada `for all to
-- authenticated` -- com o privilégio de tabela default já presente, essa
-- policy também autorizava escrita direta (com row-scope da própria
-- company) via INSERT/UPDATE/DELETE, contornando a garantia de atomicidade
-- de save_recurring_schedule()/pause_recurring_schedule()/
-- reactivate_recurring_schedule() (release candidate da 0063): um cliente
-- autenticado podia, por exemplo, fazer UPDATE direto ignorando reconcile/
-- generate, produzindo exatamente o estado "regra mudou, saídas antigas
-- continuam vendáveis" que a 0063 existe pra impedir.
--
-- Esta migration NÃO reabre/edita 0063 (já aplicada e registrada em
-- staging) -- corrige cirurgicamente, como migration nova, igual ao padrão
-- já usado em 0043 para o achado análogo de EXECUTE.
-- ============================================================================

-- 1) Revoga escrita direta explicitamente -- não confia que "a 0063 só deu
-- select" seja suficiente; nomeia authenticated e anon explicitamente
-- (mesma lição de 0043: revogar só de PUBLIC não basta quando o projeto
-- concede direto aos roles).
revoke insert, update, delete, truncate, references, trigger
  on public.tour_schedule_rules
  from authenticated, anon, public;

-- Reafirma o único privilégio que deve sobrar: SELECT pra authenticated.
-- anon não tem e nunca teve select aqui (0063 nunca concedeu) -- reafirmado
-- via revoke all acima por precaução, sem grant correspondente.
grant select on public.tour_schedule_rules to authenticated;

-- 2) Substitui a policy FOR ALL por uma policy só de leitura. FOR ALL
-- também cobria INSERT/UPDATE/DELETE (com row-scope da company) -- mesmo
-- com o privilégio de tabela revogado acima, não faz sentido manter uma
-- policy de escrita para uma tabela que não deve mais aceitar escrita
-- direta nenhuma.
drop policy if exists "agenda do passeio da empresa" on public.tour_schedule_rules;

create policy "agenda do passeio da empresa (leitura)" on public.tour_schedule_rules
  for select to authenticated
  using (company_id = public.current_company_id());

-- Nenhuma policy de INSERT/UPDATE/DELETE é recriada -- de propósito.
-- Escritas continuam existindo SOMENTE via save_recurring_schedule() /
-- pause_recurring_schedule() / reactivate_recurring_schedule(), que são
-- SECURITY DEFINER (rodam como o dono da função, com sua própria
-- autoridade de escrita na tabela, independente do GRANT de tabela do
-- chamador) e já validam auth.uid()/company/tour/vessel internamente antes
-- de escrever -- ver 0063. Revogar o privilégio de tabela de authenticated
-- não quebra essas RPCs.

-- 3) RPC ACL -- reconfirmado nesta migration (sem alteração necessária,
-- já estava correto desde a 0063, conferido linha a linha):
--   save_recurring_schedule / pause_recurring_schedule /
--   reactivate_recurring_schedule -> authenticated = EXECUTE (únicas com
--   esse grant), revogadas de public/anon/service_role.
--   generate_departures_for_schedule_rule / reconcile_departures_for_
--   schedule_rule / reconcile_departures_for_tour /
--   tour_schedule_departure_has_active_reservation -> só service_role,
--   revogadas de public/anon/authenticated.
--   create_marketplace_booking -> só service_role (idêntico à 0044/0063).
-- Reafirmadas aqui como no-op idempotente, só para deixar a intenção
-- auditável nesta migration também (mesmo valor de "reafirmar não tem
-- custo" já usado em 0043).
revoke all on function public.save_recurring_schedule(uuid, uuid, smallint[], time[], int, int, int, boolean) from public, anon, service_role;
grant execute on function public.save_recurring_schedule(uuid, uuid, smallint[], time[], int, int, int, boolean) to authenticated;

revoke all on function public.pause_recurring_schedule(uuid) from public, anon, service_role;
grant execute on function public.pause_recurring_schedule(uuid) to authenticated;

revoke all on function public.reactivate_recurring_schedule(uuid) from public, anon, service_role;
grant execute on function public.reactivate_recurring_schedule(uuid) to authenticated;

revoke all on function public.generate_departures_for_schedule_rule(uuid) from public, anon, authenticated;
grant execute on function public.generate_departures_for_schedule_rule(uuid) to service_role;

revoke all on function public.reconcile_departures_for_schedule_rule(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_departures_for_schedule_rule(uuid) to service_role;

revoke all on function public.reconcile_departures_for_tour(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_departures_for_tour(uuid) to service_role;

revoke all on function public.tour_schedule_departure_has_active_reservation(uuid) from public, anon, authenticated;
grant execute on function public.tour_schedule_departure_has_active_reservation(uuid) to service_role;

revoke all on function public.create_marketplace_booking(uuid, int, int, text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.create_marketplace_booking(uuid, int, int, text, text, text, text, text, text, int) to service_role;

-- 4) Sobre ALTER DEFAULT PRIVILEGES: de propósito, esta migration NÃO mexe
-- nisso -- mudaria o comportamento para QUALQUER tabela/função futura do
-- projeto inteiro, não só tour_schedule_rules, e é uma decisão maior que
-- merece auditoria própria e separada (mesma decisão já tomada em 0043
-- para o achado análogo de funções). Fica registrada como pendência em
-- DOCUMENTACAO.md: toda tabela/função nova precisa de revoke explícito
-- de escrita/execução dos roles que não devem ter, não dá pra confiar no
-- default do projeto.
