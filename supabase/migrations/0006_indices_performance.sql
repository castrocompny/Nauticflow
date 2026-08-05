-- Indices que faltavam nas colunas mais filtradas do sistema (Dashboard, Agenda,
-- Financeiro, Relatorios sempre filtram saidas por data e reservas por data de criacao).
-- Sem eles, essas consultas fazem varredura completa da tabela conforme o historico
-- cresce. Nenhum dado muda, so acelera leitura.

create index if not exists idx_departures_departs_at on public.departures (departs_at);
create index if not exists idx_departures_status on public.departures (status);
create index if not exists idx_reservations_created_at on public.reservations (created_at);
create index if not exists idx_reservations_status on public.reservations (status);
