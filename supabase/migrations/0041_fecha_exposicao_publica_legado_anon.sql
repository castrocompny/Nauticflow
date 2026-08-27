-- ACHADO CRÍTICO da revisão pré-deploy das migrations 0032-0038 (agora renomeadas
-- 0039/0040, ver nota nelas): a implementação anterior do ToursFlow -- removida do
-- REPOSITÓRIO a pedido, mas cujas alterações de banco já tinham sido APLICADAS de
-- fato e nunca desfeitas -- deixou o papel `anon` (visitante SEM login, é a chave
-- pública embutida em qualquer app cliente) com GRANT completo
-- (SELECT/INSERT/UPDATE/DELETE) em praticamente TODAS as tabelas do schema
-- `public`: tours, companies, tour_photos, departures, payments, reservations,
-- clients, passengers, vessels, profiles, subscriptions, plans, invoices,
-- manifests, admin_audit_log, trial_history.
--
-- Isso NUNCA foi a intenção original do projeto: a migration 0000 (schema inicial)
-- só concede `usage on schema public` para `anon`, e todo GRANT de tabela vai só
-- para `authenticated` -- inclusive `plans`, a única tabela pensada como "meio
-- pública" (preços dos planos), nunca recebeu grant de `anon`. O objetivo sempre
-- foi: visitante sem login NUNCA fala direto com o Postgres/PostgREST -- passa
-- pela API dedicada (/api/public/*, item 20 do pedido original do ToursFlow), que
-- usa service_role internamente e decide explicitamente, campo a campo, o que sai.
--
-- Na prática, hoje (RLS ainda bloqueando a maioria via falta de policy pra `anon`)
-- isso só vira exploração de verdade em duas tabelas, porque só elas têm policy de
-- RLS permissiva pra `anon`:
--   - public.tours: policy "passeios publicados - leitura publica" (usa marketplace_
--     status='published' and active) -- combinada com o GRANT, deixa qualquer
--     linha de passeio PUBLICADO legível via `GET .../rest/v1/tours` puro, sem
--     passar pela API com DTO curado.
--   - public.companies: policy "operador com passeio publicado - leitura publica"
--     -- MAS esta tabela especificamente não tinha SELECT no grant de `anon`, só
--     INSERT/UPDATE/DELETE (que RLS já bloqueia, por não haver policy de
--     INSERT/UPDATE/DELETE pra `anon`) -- então esta policy estava, por sorte,
--     inerte. Mesmo assim é removida abaixo, porque um `grant select` futuro e
--     desavisado nesta tabela reativaria a exposição de CNPJ/e-mail/dados do Asaas
--     na hora.
--   - public.tour_photos (tabela + Storage): já corrigido na migration 0034
--     (policies "fotos de passeios publicados - leitura publica" e "fotos de
--     passeio publicado - leitura anonima" removidas lá).
--
-- HOJE (26/08/2026) nenhum passeio está "published" (os 5 existentes são de teste,
-- todos "draft") -- ou seja, NADA está vazando neste exato momento. Mas a primeira
-- aprovação de passeio via /admin/passeios (fluxo já implementado) ativaria a
-- exposição na hora, contornando toda a curadoria da API pública. Por isso esta
-- migration precisa entrar JUNTO com as demais, antes de qualquer aprovação real.

revoke all on all tables in schema public from anon;

drop policy if exists "passeios publicados - leitura publica" on public.tours;
drop policy if exists "operador com passeio publicado - leitura publica" on public.companies;
