-- Habilita Realtime (postgres_changes) nas tabelas operacionais que mais de uma
-- pessoa da mesma empresa mexe ao mesmo tempo -- pedido do dono: quando um
-- colaborador cria/edita/apaga um cliente, embarcacao, parceiro, saida ou reserva,
-- os outros logados devem ver a mudanca sozinha, sem precisar sair e voltar da aba.
--
-- O Realtime respeita a RLS que ja existe nessas tabelas (mesma policy de SELECT
-- usada pela API normal) -- um cliente so recebe o evento de uma linha se a policy
-- de leitura dele permitir ver aquela linha, entao continua isolado por empresa
-- sem nenhuma configuracao extra de seguranca.
alter publication supabase_realtime add table
  public.vessels,
  public.clients,
  public.partners,
  public.departures,
  public.reservations;
