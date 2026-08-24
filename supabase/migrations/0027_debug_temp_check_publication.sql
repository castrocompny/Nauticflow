-- TEMPORARIO -- so pra diagnosticar por que o Realtime nao esta entregando eventos de
-- postgres_changes mesmo com a tabela adicionada na publication (migration 0026).
-- Remove numa migration seguinte assim que o diagnostico terminar.
create or replace function public.debug_realtime_publication_tables()
returns table(tablename text)
language sql
security definer
set search_path = public
as $$
  select tablename::text from pg_publication_tables where pubname = 'supabase_realtime';
$$;

grant execute on function public.debug_realtime_publication_tables() to service_role;
