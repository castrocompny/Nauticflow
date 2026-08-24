-- REPLICA IDENTITY FULL nas tabelas com Realtime habilitado (migration 0026).
--
-- Sem isso, eventos de UPDATE/DELETE do Realtime só carregam a chave primária da
-- linha antiga (padrão do Postgres), sem as outras colunas -- e a checagem de RLS
-- que filtra quem recebe cada evento (só quem a policy de SELECT deixaria ver
-- aquela linha, ex: mesma empresa) depende de conseguir avaliar a política contra
-- os dados da linha. Sem o "old record" completo, o Realtime não consegue confirmar
-- que o assinante tem permissão de ver aquela linha apagada/editada -- documentado
-- pelo próprio Supabase como pré-requisito pra RLS funcionar direito com Realtime
-- em UPDATE/DELETE (INSERT não depende disso, já usa o "new record" completo).
alter table public.vessels replica identity full;
alter table public.clients replica identity full;
alter table public.partners replica identity full;
alter table public.departures replica identity full;
alter table public.reservations replica identity full;
