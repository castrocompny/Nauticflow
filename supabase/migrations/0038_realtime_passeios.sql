-- Estende o Realtime (migrations 0026/0029) pra tabela nova `tours`, agora que
-- ela tem uma tela própria de cadastro (/passeios) onde mais de um colaborador da
-- mesma empresa pode mexer. Mesmo raciocínio de isolamento: o Realtime só entrega
-- o evento pra quem a RLS de SELECT de `tours` já deixaria ver aquela linha.
alter publication supabase_realtime add table public.tours;
alter table public.tours replica identity full;
