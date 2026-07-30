-- Adiciona o status "pendente" para reservations.status.
-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query).
--
-- Este projeto não tem Supabase CLI/migrations aplicadas automaticamente, então este
-- arquivo serve como referência: ele precisa ser executado manualmente no painel.

-- 1) (opcional) Rode isto primeiro se quiser confirmar como a coluna está definida:
--
--   select data_type, udt_name
--   from information_schema.columns
--   where table_name = 'reservations' and column_name = 'status';
--
-- Se "data_type" vier "USER-DEFINED", a coluna usa um enum nativo do Postgres — pule para
-- a seção 3 (ALTER TYPE) e troque "reservation_status" pelo valor de "udt_name" retornado.
-- Se vier "text"/"character varying", a coluna usa CHECK constraint — use a seção 2 abaixo
-- (caso mais provável neste projeto, dado que os triggers lançam mensagens customizadas em
-- vez de erros de enum).

-- 2) Caso mais provável: coluna text com CHECK constraint.
do $$
declare
  c_name text;
begin
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.reservations'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';

  if c_name is not null then
    execute format('alter table public.reservations drop constraint %I', c_name);
  end if;

  alter table public.reservations
    add constraint reservations_status_check
    check (status in ('confirmada', 'cancelada', 'pendente'));
end $$;

-- 3) Alternativa: se a coluna for um enum nativo (rode só isto, substituindo o nome do tipo
-- pelo "udt_name" da consulta do passo 1, e comente/ignore a seção 2 acima):
--
--   alter type reservation_status add value if not exists 'pendente';
