-- BOOTSTRAP DE TESTE -- não é migration de produto; nunca aplicar em ambiente
-- remoto.
--
-- Por quê: nenhuma migration do repositório concede ao service_role
-- privilégios nas quatro tabelas abaixo (a 0053 concede SELECT só no ledger);
-- o app depende dos default privileges da plataforma Supabase.
-- Evidência fornecida pelo usuário (ambiente não identificado na captura)
-- mostra service_role com todos os privilégios de tabela nessas tabelas. A
-- imagem local recente (postgres 17.6.1.158, CLI 2.114.0) concede, em tabelas
-- criadas por `postgres`, só TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (`Dxtm`) --
-- então uma chain aplicada do zero fica sem o que o webhook usa.
--
-- O que concede: só os privilégios que o webhook Asaas exige (ver
-- supabase/tests/database/service_role_payments_privilege.test.sql). Nada para
-- anon/authenticated/PUBLIC.
--
-- Uso: só no ensaio local isolado, copiado para o workdir externo como última
-- migration (99990_*). Passo a passo completo em supabase/tests/README.md.
grant select on public.payments to service_role;
grant select on public.marketplace_withdrawals to service_role;
grant select, insert, delete on public.processed_webhook_events to service_role;
grant select, update on public.subscriptions to service_role;
