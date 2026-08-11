-- Move a validação de horário de saída (08:00-19:00, não pode ser no passado) para
-- dentro do banco, além da checagem que já existe no app (saidas/actions.ts).
--
-- Por quê: a checagem no app usa o relógio da máquina que roda o servidor Next.js.
-- Em dev local isso é o computador de quem está testando -- então mudar a hora/fuso
-- do sistema operacional muda o que o app enxerga como "agora" e dá pra burlar a
-- regra. Em produção isso já não seria possível (o servidor roda em outra máquina,
-- fora do alcance do usuário), mas colocar a regra também no banco fecha a brecha
-- por completo: mesmo que alguém chame a API do Supabase direto (sem passar pelo
-- app) ou rode isso em qualquer ambiente, o gatilho usa o relógio do Postgres do
-- Supabase -- controlado pela infraestrutura da nuvem, nunca pelo cliente.
--
-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query).

create or replace function public.check_departure_schedule()
returns trigger
language plpgsql
as $$
declare
  v_local_time time;
begin
  -- comparação de timestamptz é sempre por instante absoluto, então isto vale
  -- independente do fuso horário de quem inseriu o registro
  if new.departs_at < now() then
    raise exception 'Não é possível criar uma saída em um horário que já passou.';
  end if;

  -- aqui sim precisamos converter para o fuso de Brasília, pra checar o horário
  -- comercial (08:00-19:00) do jeito que o negócio realmente opera
  v_local_time := (new.departs_at at time zone 'America/Sao_Paulo')::time;
  if v_local_time < time '08:00' or v_local_time > time '19:00' then
    raise exception 'O horário de saída deve ser entre 08:00 e 19:00 (horário de Brasília).';
  end if;

  return new;
end;
$$;

-- só na criação: edições de saídas antigas (antes desta regra existir, ou fora do
-- horário comercial por algum outro motivo) continuam permitidas, igual já decidido
-- no app.
drop trigger if exists trg_departure_schedule on public.departures;
create trigger trg_departure_schedule
  before insert on public.departures
  for each row execute function public.check_departure_schedule();
