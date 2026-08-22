-- Limpa passeios (tours) duplicados e evita novos.
--
-- Duplicatas surgiram porque criar saída com "Novo passeio..." + nome digitado sempre
-- inseria um tour novo, sem checar se já existia um igual. Aqui a gente junta os
-- repetidos (por empresa, mesmo nome ignorando maiúsculas/espaços) num "canônico",
-- repointa as saídas e apaga os extras -- depois cria um índice único parcial como
-- rede de segurança (o app também passou a reaproveitar em vez de duplicar).

-- 1) repointa as saídas dos duplicados pro passeio canônico de cada grupo
--    (canônico = de preferência um ativo, e o mais antigo)
with ranked as (
  select
    id,
    first_value(id) over (
      partition by company_id, lower(btrim(name))
      order by active desc, created_at asc, id asc
    ) as canonical_id
  from public.tours
)
update public.departures d
set tour_id = r.canonical_id
from ranked r
where d.tour_id = r.id
  and r.id <> r.canonical_id;

-- 2) apaga os passeios duplicados (não-canônicos), agora sem nenhuma saída apontando
--    pra eles (a FK departures.tour_id é "on delete restrict")
with ranked as (
  select
    id,
    first_value(id) over (
      partition by company_id, lower(btrim(name))
      order by active desc, created_at asc, id asc
    ) as canonical_id
  from public.tours
)
delete from public.tours t
using ranked r
where t.id = r.id
  and r.id <> r.canonical_id;

-- 3) no máximo um passeio ATIVO por empresa com o mesmo nome (ignora maiúsculas/espaços).
--    Parcial em "active": excluir/desativar um passeio libera o nome pra reuso depois.
create unique index if not exists tours_company_active_name_unique
  on public.tours (company_id, lower(btrim(name)))
  where active;
