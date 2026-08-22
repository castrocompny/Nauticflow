-- Adiciona "táxi marítimo" como tipo de embarcação.
-- O type da tabela vessels tem um CHECK que lista os tipos aceitos; precisa recriar
-- o constraint incluindo o novo valor (senao inserir/editar como taxi_maritimo falha).

alter table public.vessels drop constraint if exists vessels_type_check;

alter table public.vessels
  add constraint vessels_type_check
  check (type in ('escuna', 'lancha', 'jet_ski', 'catamara', 'taxi_maritimo', 'outro'));
