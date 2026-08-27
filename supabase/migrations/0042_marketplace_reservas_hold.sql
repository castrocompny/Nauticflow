-- Fundação de reservas do ToursFlow (fase 6/7): hold temporário de vaga,
-- idempotência de retry, e infraestrutura mínima de rate limit para a futura
-- rota servidor-servidor POST /api/marketplace/bookings.
--
-- Escopo desta migration: SOMENTE o que a etapa aprovada pede -- hold + idempotência
-- + capacidade + rate limit. Nada de checkout/Asaas/split/voucher/QR (fora de escopo,
-- ver DOCUMENTACAO.md). 100% aditivo: nenhuma coluna existente muda de tipo/nome,
-- nenhuma linha existente é tocada além do preenchimento óbvio de NOT NULL abaixo.

-- ============================================================================
-- HOLD — reserva 'pendente' segura a vaga por um prazo, sem depender de cron
-- ============================================================================

alter table public.reservations
  add column if not exists hold_expires_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

comment on column public.reservations.hold_expires_at is
  'Prazo do hold temporário (reservas marketplace nascem "pendente" e seguram a vaga até este instante). NULL para reservas manuais/confirmadas -- nunca consomem por prazo, só por status. A leitura de "vaga ocupada" sempre compara hold_expires_at > now() no momento da consulta -- nenhuma rotina precisa rodar para uma vaga voltar a ficar livre.';
comment on column public.reservations.idempotency_key is
  'Chave de idempotência enviada pelo ToursFlow (header Idempotency-Key). NULL para reservas manuais/de outros canais -- só reservas source=marketplace usam isto. Retry com a mesma chave deve reaproveitar a reserva já criada, nunca duplicar (garantido pelo índice único abaixo, não por SELECT-antes-de-INSERT).';
comment on column public.reservations.request_fingerprint is
  'Hash (sha256) de departureId+quantity+nome+e-mail+telefone+cpf do cliente (cada campo normalizado de forma determinística antes do hash) no momento da criação -- não guarda dado sensível cru, só o hash. Achado na revisão pré-deploy: uma Idempotency-Key só identifica UMA operação lógica; se o ToursFlow reenviar a MESMA key com QUALQUER um desses campos DIFERENTE (bug no cliente), isto detecta a divergência e recusa com 409 IDEMPOTENCY_CONFLICT (ver create_marketplace_booking) em vez de devolver silenciosamente a reserva antiga como se fosse a nova.';

-- único só entre reservas do marketplace -- não muda em nada o comportamento de
-- reservas manuais/outros canais (nunca tiveram idempotency_key e continuam sem)
create unique index if not exists reservations_marketplace_idempotency_key_unique
  on public.reservations (idempotency_key)
  where source = 'marketplace' and idempotency_key is not null;

-- ============================================================================
-- CAPACIDADE — mesma trava de concorrência da migration 0003 (SELECT ... FOR
-- UPDATE), agora também contando hold ativo como ocupação. Um hold vencido
-- (hold_expires_at <= now()) deixa de contar automaticamente, mesmo que a linha
-- continue "pendente" -- a correção de disponibilidade depende só desta
-- comparação de timestamp, nunca de uma rotina de limpeza rodar.
-- ============================================================================

create or replace function public.check_departure_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity int;
  v_booked int;
  v_new_consumes boolean;
begin
  v_new_consumes := new.status = 'confirmada'
    or (new.status = 'pendente' and new.hold_expires_at is not null and new.hold_expires_at > now());

  if not v_new_consumes then
    return new;
  end if;

  -- trava a saida ate o fim da transacao: serializa reservas/holds concorrentes
  -- pela ULTIMA vaga (mesmo mecanismo da 0003, agora cobrindo tambem o hold)
  perform 1 from public.departures where id = new.departure_id for update;

  select capacity into v_capacity from public.departures where id = new.departure_id;

  select coalesce(sum(people_count), 0) into v_booked
    from public.reservations
    where departure_id = new.departure_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and (
        status = 'confirmada'
        or (status = 'pendente' and hold_expires_at is not null and hold_expires_at > now())
      );

  if v_booked + new.people_count > v_capacity then
    raise exception 'Capacidade excedida: % vaga(s) disponível(is), % solicitada(s).',
      greatest(v_capacity - v_booked, 0), new.people_count;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- RATE LIMIT — infraestrutura mínima em Postgres (sem serviço externo) para a
-- futura rota server-to-server. Atômico via lock de linha (mesmo padrão já
-- confiável de FOR UPDATE usado acima e na 0003), funciona igual em qualquer
-- quantidade de instâncias serverless porque o estado vive no banco, não em
-- memória local de processo. Genérico por "consumer_key" (hoje só "toursflow"),
-- não guarda nenhum dado sensível (só um contador e um timestamp de janela).
-- ============================================================================

create table if not exists public.api_rate_limits (
  consumer_key text primary key,
  window_start timestamptz not null default now(),
  request_count int not null default 0
);

alter table public.api_rate_limits enable row level security;
-- sem nenhuma policy: só service_role acessa (mesmo padrão de payments/0036,
-- trial_history/0031, processed_webhook_events/0037)

create or replace function public.check_rate_limit(
  p_consumer_key text,
  p_max_requests int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  -- CONFIRMADO NA REVISÃO: primeira chamada concorrente sem linha pré-existente
  -- pra este consumer_key é segura por construção -- "INSERT ... ON CONFLICT"
  -- concorrente sobre a MESMA chave é um caso que o próprio Postgres trata: se
  -- duas transações tentam este mesmo INSERT ao mesmo tempo, a segunda BLOQUEIA
  -- (não lança unique_violation) até a primeira terminar, e só então reavalia o
  -- conflito -- resultado, nunca um erro 500 aqui, mesmo nas duas primeiras
  -- chamadas literalmente simultâneas. Por isso este INSERT vem ANTES do
  -- "SELECT ... FOR UPDATE" abaixo: SELECT FOR UPDATE não trava linha
  -- inexistente, mas a este ponto a linha já existe (própria ou da concorrente).
  insert into public.api_rate_limits (consumer_key, window_start, request_count)
  values (p_consumer_key, now(), 0)
  on conflict (consumer_key) do nothing;

  select window_start, request_count into v_window_start, v_count
  from public.api_rate_limits
  where consumer_key = p_consumer_key
  for update;

  if now() - v_window_start > make_interval(secs => p_window_seconds) then
    update public.api_rate_limits
      set window_start = now(), request_count = 1
      where consumer_key = p_consumer_key;
    return true;
  end if;

  if v_count >= p_max_requests then
    return false;
  end if;

  update public.api_rate_limits
    set request_count = request_count + 1
    where consumer_key = p_consumer_key;
  return true;
end;
$$;

-- ACHADO CRÍTICO DA REVISÃO PRÉ-DEPLOY: toda função Postgres recebe EXECUTE pra
-- `PUBLIC` por padrão (diferente de tabela, onde o padrão é NENHUM acesso pra
-- ninguém além do dono) -- confirmado testando de verdade contra produção que
-- `anon` já consegue chamar hoje uma função SECURITY DEFINER existente
-- (`is_super_admin()`) só com a chave anônima pública, via
-- `POST /rest/v1/rpc/is_super_admin`. Sem o REVOKE abaixo, `anon` conseguiria
-- chamar `check_rate_limit` diretamente (bypassando por completo a rota
-- /api/marketplace/bookings e sua checagem de Bearer) e manipular o contador do
-- consumidor "toursflow" à vontade -- zerar/inflar a janela do consumidor real,
-- ou chamar com `p_consumer_key` arbitrário repetidas vezes pra fazer a tabela
-- crescer sem limite (cada chave nova vira uma linha nova). Isto é
-- especialmente importante aqui por ser `security definer`: se o EXECUTE
-- vazasse, a função rodaria com privilégio elevado independente de quem a
-- chamou.
revoke execute on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- ============================================================================
-- CRIAÇÃO ATÔMICA DA RESERVA — achado na revisão pré-deploy: a implementação
-- original fazia resolução de cliente + insert da reserva como chamadas
-- SEPARADAS a partir do TypeScript (múltiplas idas ao banco, sem transação
-- única as amarrando). Dois problemas reais disso:
--
--   1) CLIENTE ÓRFÃO: duas requisições concorrentes com a MESMA Idempotency-Key
--      e cliente SEM CPF (não há chave natural de dedupe sem CPF) cada uma cria
--      seu próprio `client` antes de disputar o insert da reserva -- a que
--      perde a corrida do índice único fica com um `client` sem nenhuma
--      reserva apontando pra ele.
--   2) ATOMICIDADE: se o insert da reserva falhasse (capacidade OU
--      idempotência), o `client` já criado pela mesma requisição não era
--      desfeito.
--
-- Resolvido com UMA função só, chamada em UMA única invocação de RPC a partir
-- da rota: tudo roda dentro da mesma transação implícita da chamada. Se
-- qualquer coisa depois do insert do cliente falhar (ou for capturado no bloco
-- de exceção abaixo), o Postgres desfaz TUDO que o bloco fez, cliente incluso
-- -- nunca sobra órfão. A trava de capacidade (SELECT ... FOR UPDATE, função
-- check_departure_capacity acima) continua intacta e dispara normalmente a
-- partir do INSERT feito aqui dentro -- gatilho de tabela não se importa se o
-- INSERT veio de uma função ou de uma chamada direta.
-- ============================================================================

create or replace function public.create_marketplace_booking(
  p_departure_id uuid,
  p_quantity int,
  p_total_cents int,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_cpf text, -- já normalizado (só dígitos) ou null -- decisão de cpf/dedupe é da rota, não desta função
  p_idempotency_key text,
  p_request_fingerprint text,
  p_hold_minutes int
) returns table (
  booking_id uuid,
  hold_expires_at timestamptz,
  people_count int,
  total_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_client_id uuid;
  v_existing record;
  v_new_id uuid;
  v_hold timestamptz;
begin
  -- ==========================================================================
  -- SERIALIZA por Idempotency-Key ANTES de tocar em qualquer dado de negócio.
  --
  -- ACHADO NA REVISÃO: sem isto, duas chamadas concorrentes com a MESMA key
  -- podiam violar a garantia "mesma key simultânea -> mesmo bookingId". O
  -- motivo é a ORDEM de execução do Postgres: o trigger de capacidade
  -- (check_departure_capacity) é BEFORE INSERT, e todo BEFORE ROW trigger roda
  -- ANTES de qualquer índice único ser checado -- inclusive o de
  -- idempotency_key. Cenário sem a trava abaixo: A e B com a MESMA key, saída
  -- com 1 vaga -- A entra no bloco, insere o client, chega no insert da
  -- reserva, o trigger de capacidade trava a saída, aprova (0 ocupado), insere
  -- e comita, liberando a trava da saída. B, que estava esperando só a trava
  -- da SAÍDA (não da idempotency_key -- não existia trava nenhuma pra isso),
  -- só então consegue prosseguir, o trigger dele agora vê 1 ocupado e RECUSA
  -- por capacidade -- ANTES de o INSERT de B chegar perto do índice único de
  -- idempotency_key. Resultado: A=201, B=409 capacidade, quando deveria ser
  -- A=201, B=200 replay do MESMO bookingId.
  --
  -- Corrigido com um advisory lock de TRANSAÇÃO (pg_advisory_xact_lock) --
  -- libera sozinho no commit/rollback, nunca precisa de unlock manual. Duas
  -- chamadas com a MESMA key competem pelo MESMO lock: a segunda fica
  -- bloqueada aqui, parada, até a primeira terminar (commitar ou reverter) --
  -- só depois disso ela sequer CHEGA no trigger de capacidade. Keys diferentes
  -- hasheiam (hashtext, determinístico) pra valores diferentes e não se
  -- bloqueiam entre si. Uma colisão de hash entre duas keys DIFERENTES
  -- (hashtext não é criptográfico, mas seria necessário colidir em 32 bits)
  -- na pior hipótese apenas serializa duas operações que não precisavam
  -- esperar uma pela outra -- nunca causa inconsistência, porque a checagem
  -- de verdade logo abaixo continua sendo pela STRING da idempotency_key, não
  -- pelo hash do lock.
  -- ==========================================================================
  perform pg_advisory_xact_lock(hashtext('marketplace_booking'), hashtext(p_idempotency_key));

  select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint
    into v_existing
    from public.reservations r
    where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
    return;
  end if;

  select company_id into v_company_id from public.departures where id = p_departure_id;
  if v_company_id is null then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  -- bloco próprio: se QUALQUER coisa aqui dentro falhar (capacidade excedida --
  -- a única coisa que ainda pode disparar unique_violation de idempotency_key
  -- aqui seria uma falha de raciocínio no lock acima, tratada como defesa em
  -- profundidade, nunca esperada em uso normal), o Postgres desfaz
  -- automaticamente tudo que este bloco fez até aqui -- inclusive o insert do
  -- cliente logo abaixo -- ao voltar pro savepoint implícito do início do
  -- bloco.
  begin
    if p_customer_cpf is not null then
      -- upsert atômico: se já existe cliente com este cpf na empresa, a
      -- corrida é resolvida pelo próprio Postgres (ON CONFLICT), sem round-trip
      -- de SELECT-depois-INSERT que teria a mesma janela de corrida do
      -- problema que este bloco inteiro existe pra evitar.
      insert into public.clients (company_id, name, cpf, phone, email)
      values (v_company_id, p_customer_name, p_customer_cpf, p_customer_phone, p_customer_email)
      on conflict (company_id, cpf) do update set cpf = excluded.cpf
      returning id into v_client_id;
    else
      -- sem cpf não há chave natural de dedupe -- cria um cliente novo pra esta
      -- reserva (nunca supõe nome/e-mail únicos). Se esta linha ficar
      -- "perdedora" de uma corrida de idempotency_key, o EXCEPTION abaixo
      -- desfaz este insert junto, sem deixar órfão.
      insert into public.clients (company_id, name, phone, email)
      values (v_company_id, p_customer_name, p_customer_phone, p_customer_email)
      returning id into v_client_id;
    end if;

    v_hold := now() + make_interval(mins => p_hold_minutes);

    insert into public.reservations (
      company_id, departure_id, client_id, people_count, total_cents,
      status, source, origin_name, created_by, partner_id,
      hold_expires_at, idempotency_key, request_fingerprint
    ) values (
      v_company_id, p_departure_id, v_client_id, p_quantity, p_total_cents,
      'pendente', 'marketplace', 'ToursFlow', null, null,
      v_hold, p_idempotency_key, p_request_fingerprint
    )
    returning id into v_new_id;

    return query select v_new_id, v_hold, p_quantity, p_total_cents, false;
    return;
  exception
    when unique_violation then
      -- pode ser a MESMA idempotency_key (outra requisição concorrente venceu a
      -- corrida) -- qualquer outra unique_violation (ex: id duplicado, cenário
      -- praticamente impossível com gen_random_uuid) sobe sem tratamento
      -- especial, vira erro 500 genérico na rota, nunca uma resposta enganosa.
      if sqlerrm not like '%reservations_marketplace_idempotency_key_unique%' then
        raise;
      end if;

      select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint
        into v_existing
        from public.reservations r
        where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;
      if v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;

      return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
      return;
  end;
end;
$$;

-- mesmo motivo do REVOKE em check_rate_limit acima: função SECURITY DEFINER,
-- EXECUTE pra PUBLIC é o padrão do Postgres e precisa ser fechado explicitamente.
-- Só o service_role (usado pela rota /api/marketplace/bookings) pode chamar --
-- nunca anon, nunca authenticated (um operador logado não tem nenhum motivo
-- legítimo pra criar uma reserva "de origem ToursFlow" direto via RPC).
revoke execute on function public.create_marketplace_booking(
  uuid, int, int, text, text, text, text, text, text, int
) from public;
grant execute on function public.create_marketplace_booking(
  uuid, int, int, text, text, text, text, text, text, int
) to service_role;
