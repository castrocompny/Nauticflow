-- Preparação NauticFlow → ToursFlow (fase 4/7): origem estruturada da reserva.
--
-- origin_name (migration 0000) continua existindo e não muda em nada -- é texto
-- livre complementar (ex: nome do hotel/pessoa que indicou), digitado à mão pelo
-- operador. O que faltava era um CANAL estruturado, usável em filtro/relatório
-- programático (ex: "quantas reservas vieram do marketplace este mês"), o que texto
-- livre não permite com confiança.
--
-- Todas as reservas já existentes (e todas as criadas pelo painel atual, sem
-- nenhuma mudança de código) recebem 'manual' -- é exatamente o que o painel do
-- operador sempre foi: alguém do time digitando a reserva na tela. 'operator' fica
-- reservado para uma futura página de reserva pública operada pelo próprio
-- NauticFlow (site do operador), diferente de 'marketplace' (veio do ToursFlow).
--
-- CORRIGIDA na revisão pré-deploy: a implementação anterior (removida do
-- repositório, mas já aplicada de fato neste banco -- ver nota na migration 0039)
-- já tinha criado esta coluna, com o MESMO conjunto de valores permitidos (mesmo
-- nome de constraint, "reservations_source_check"), mas com default 'operator' em
-- vez de 'manual'. Não há nenhuma reserva na tabela hoje (0 linhas) -- corrige o
-- default pra bater com o significado documentado aqui ("manual" = painel interno
-- atual; "operator" fica reservado pra uma futura página pública do operador).
alter table public.reservations add column if not exists source text;

update public.reservations set source = 'manual' where source is null;

alter table public.reservations alter column source set default 'manual';
alter table public.reservations alter column source set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_source_check') then
    alter table public.reservations
      add constraint reservations_source_check
        check (source in ('manual', 'operator', 'website', 'marketplace', 'partner', 'agency'));
  end if;
end $$;

create index if not exists idx_reservations_source on public.reservations (source);
