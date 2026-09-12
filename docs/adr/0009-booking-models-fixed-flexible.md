# ADR 0009 — Modelos de reserva: `fixed_schedule` e `flexible_private`

- Status: aceita
- Data: 2026-09-12
- Contexto: dois modelos operacionais distintos coexistindo no mesmo NauticFlow -- passeios de horário fixo/compartilhado (escuna, venda por pessoa) e passeios de horário flexível/privativo (lancha, cliente escolhe início/fim, embarcação exclusiva). Branch `main`, migration `0073_booking_models_flexible_private.sql`.

## Três conceitos que pareciam um só, e não são

Antes desta migration, o NauticFlow já tinha `category` (`passeio_privativo`,
`por_do_sol`, `praias`...) e `price_type` (`por_pessoa`, `por_grupo`,
`a_partir_de`). Era tentador inferir "modelo operacional" a partir de um dos
dois -- por exemplo, `category = passeio_privativo` "parece" implicar horário
flexível. **Essa inferência foi deliberadamente rejeitada.** Os três
conceitos respondem perguntas diferentes:

- `category`: **comercial** -- como o passeio é vitrinado/buscado no
  marketplace. Não muda em nada.
- `price_type`: **como precificar** -- multiplica por pessoa, valor fixo por
  grupo, ou "a partir de" (catálogo, não vendável). Não muda em nada.
- `booking_model` (novo): **como a reserva funciona operacionalmente** --
  várias pessoas compartilhando a mesma `departure` até a capacidade, ou uma
  única reserva exclusiva por período escolhido pelo cliente.

Um passeio `passeio_privativo` (category) pode perfeitamente ser
`fixed_schedule` (uma lancha que sai sempre às 10h e 15h, por pessoa, mas
"privativa" só no sentido de marketing). Um passeio `passeio_compartilhado`
(category) poderia teoricamente ser `flexible_private` (embora isso seja
incomum na prática). Os três campos são ortogonais -- `booking_model` nunca é
derivado dos outros dois, sempre uma escolha explícita do operador.

## `booking_model` -- `fixed_schedule` (default) e `flexible_private`

`tours.booking_model text not null default 'fixed_schedule' check (... in
('fixed_schedule', 'flexible_private'))`. Default é `fixed_schedule`
deliberadamente -- **nenhum passeio existente muda de comportamento** com
esta migration; todo o fluxo de agenda recorrente, datas específicas,
reserva de balcão e (quando existir) marketplace continua exatamente como
sempre foi para todo passeio já cadastrado.

## `fixed_schedule` -- nada mudou, exceto uma regra que estava errada

O comportamento inteiro (agenda recorrente via `tour_schedule_rules`,
"datas específicas" via `createDeparture`, `departures` compartilhadas,
capacidade por passageiro, `create_counter_reservation`, automação de 90
dias, cron de extensão, preço por saída) **não foi reescrito**. A única
mudança real: a janela global **08:00-19:00 foi removida**.

Essa janela era uma regra histórica de negócio (migration `0014`, pensada
pra evitar erro de digitação numa época em que só existia um tipo de
operação), nunca uma trava de segurança. Como regra GLOBAL ela estava
simplesmente errada -- um passeio de pôr do sol pode sair às 17:30 e voltar
depois das 19h; uma saída de pesca pode sair às 05:00. Removida de:
`check_departure_schedule()` (trigger em `departures`, só "não pode ser no
passado" continua), `check_tour_schedule_rule_days_times()` (trigger em
`tour_schedule_rules`, só duplicata de dias/horários continua), e de toda
validação equivalente em `saidas/actions.ts`, `reservas/actions.ts`,
`reservas/page.tsx` e os atributos HTML `min`/`max` dos inputs de hora.
Horário permitido agora é decidido pelo modelo/regra de CADA passeio -- para
`fixed_schedule` continua sendo "o operador decide", sem teto artificial;
para `flexible_private` é a `window_start`/`window_end` da própria regra
(abaixo), configurável por operador, nunca mais um número fixo do
NauticFlow inteiro.

## `flexible_private` -- `tour_flexible_booking_rules`, uma regra por passeio

Nova tabela, mesmo espírito de `tour_schedule_rules` (FK company-scoped,
trigger de validação cruzada, `unique(tour_id)`, escrita só via RPC
`SECURITY DEFINER`, leitura direta liberada só pra `authenticated`):
`vessel_id`, `days_of_week` (mesma convenção `extract(dow)`, 0=domingo),
`window_start`/`window_end` (`time`, configurável por operador -- "outro
operador pode configurar 06:00 até 22:00" é o exemplo literal do pedido),
`min_duration_minutes`/`max_duration_minutes`, `slot_interval_minutes`
(restrito a `{15, 30, 60}` -- mesmo padrão já usado em
`tour_schedule_rules.horizon_days`, que também restringe a um conjunto
inicial suportado via `check ... in (...)`), `pricing_mode`
(`fixed`/`per_hour`), `hourly_price_cents`.

**Departures do privativo NUNCA são pré-geradas.** Diferente da agenda
recorrente (que gera `departures` reais com antecedência), o privativo
flexível só materializa uma `departure` no momento exato em que uma reserva
é confirmada -- pedido explícito: "não criar 90 departures vazias". Antes
disso, "disponibilidade" é só a regra (dias + janela + duração + slot),
nunca uma linha na tabela `departures`.

## `ends_at` em `departures`

`departures.ends_at timestamptz null`, `check (ends_at is null or ends_at >
departs_at)`. Nullable de propósito -- toda `departure` fixa histórica
continua com `ends_at = null` a menos que o backfill (abaixo) consiga
inferir. Obrigatório apenas nas NOVAS `departures` criadas pelo fluxo
privativo (`create_flexible_counter_reservation` sempre grava `ends_at`,
nunca null) -- não é uma constraint `NOT NULL` na coluna, que quebraria
todo histórico; é uma garantia da RPC, não do schema.

**Backfill**: `update departures set ends_at = departs_at + (tour.duration_minutes
|| ' minutes')::interval where ends_at is null and tour.duration_minutes >
0`. Nunca inventa duração quando `duration_minutes` é nulo -- essas
`departures` ficam com `ends_at = null` permanentemente, e todo o resto do
sistema (voucher, exibição, overlap) trata isso como "término desconhecido",
nunca como "sem duração real". Volume medido em Staging e Production ANTES
de aplicar (ver DOCUMENTACAO.md, seção da migration 0073) -- não presumido.

## Overlap de embarcação -- por que advisory lock + checagem na transação, não exclusion constraint

O pedido pedia pra avaliar `EXCLUDE` com `tstzrange` + `btree_gist` como
alternativa. **Não usada**, por dois motivos: (1) adicionar uma extensão
nova (`btree_gist`) ao banco é uma mudança de infraestrutura que o pedido
explicitamente pedia pra confirmar necessidade antes de fazer -- e não era
necessária, porque (2) o padrão já estabelecido neste projeto para
concorrência real é **lock explícito + checagem dentro da MESMA transação**
(`trg_reservation_capacity`/`check_departure_capacity`, migrations
0000/0003/0042, usa `select ... for update`; `create_marketplace_booking`,
migrations 0042/0063, usa `pg_advisory_xact_lock(hashtext(...),
hashtext(...))` pra serializar por idempotency key). `create_flexible_counter_reservation`
segue o MESMO padrão: `pg_advisory_xact_lock(hashtext('vessel_schedule'),
hashtext(vessel_id::text))` serializa qualquer tentativa concorrente pra
MESMA embarcação; a checagem de overlap roda DEPOIS do lock, na mesma
transação, contra QUALQUER `departure` ativa daquela embarcação (fixa ou
privativa). Verificado com concorrência REAL (duas conexões simultâneas
distintas, não um proxy sequencial) em Staging -- ver DOCUMENTACAO.md.

**Semântica `[início, fim)`**: uma saída terminando às 14:00 e outra
começando às 14:00 na mesma embarcação são permitidas (não se sobrepõem).
`overlap ⟺ existing.start < new.end AND new.start < existing.end` -- o teste
`>=`/`<=` em vez de `>`/`<` teria bloqueado esse caso legítimo.

**Departure fixa sem `ends_at` conhecido**: quando nem `ends_at` nem
`tour.duration_minutes` existem, o overlap trata essa `departure` como
ocupando a embarcação **até o fim do dia civil em Brasília** a partir de
`departs_at` -- deliberadamente conservador (nunca "finge que está livre"),
em vez de inventar uma duração média. Documentado explicitamente porque é
uma decisão de produto, não uma regra "óbvia": prefere bloquear
demais (falso positivo, o operador tenta outro horário) a permitir demais
(falso negativo, duas embarcações reservadas pro mesmo período real).

**Atualização (migration 0074, NF-001)**: a checagem acima nasceu SÓ dentro
de `create_flexible_counter_reservation` -- correta pra esse caminho, mas
nunca replicada pra criação/edição de saída fixa avulsa (`createDeparture`/
`updateDeparture`) nem pra geração de agenda recorrente
(`generate_departures_for_schedule_rule`), que continuavam protegidas só
pelo `unique(vessel_id, departs_at)` de sempre -- barra timestamp
EXATAMENTE igual, nunca um intervalo sobreposto com início diferente. Uma
auditoria funcional (seção 136 da DOCUMENTACAO.md) reproduziu o overbooking
real: a mesma embarcação aceitava 10:00-14:00 e 12:00-16:00 sem erro. A
correção generalizou a regra pra um gatilho ÚNICO em `departures`
(`trg_departure_vessel_overlap`, função `check_departure_vessel_overlap`),
cobrindo TODO caminho de INSERT/UPDATE -- fixa manual, edição, agenda
recorrente e balcão (fixo e privativo, este último redundante mas nunca
conflitante com a checagem que a RPC já fazia, que permanece intocada). A
expressão do "término efetivo" (mesmos três níveis de fallback acima) virou
uma função só, `departure_effective_end`, usada tanto pelo gatilho novo
quanto (continua) inline em `create_flexible_counter_reservation` -- uma
regra canônica, nunca duas divergentes. `ends_at` também passou a ser
preenchido automaticamente pra `fixed_schedule` (nunca pra `flexible_private`,
que sempre grava o próprio) sempre que `tour.duration_minutes` é conhecido e
ninguém informou um valor explícito -- incluindo recomputar quando
`departs_at`/`tour_id` mudam numa edição, pra nunca deixar um `ends_at`
auto-preenchido ficar desatualizado (stale) e mascarar um overlap real.
Detalhe completo, incluindo os 6 cenários de teste executados (fixed↔fixed,
fixed↔flexible nos dois sentidos, UPDATE, agenda recorrente, concorrência
real) na seção 136 da DOCUMENTACAO.md.

## Exclusividade da reserva privativa

Não bastava `people_count < capacity` -- isso deixaria um segundo grupo
entrar na mesma lancha privativa, desde que a soma de pessoas coubesse. A
exclusividade foi implementada **estendendo o MESMO gatilho compartilhado**
(`check_departure_capacity`, disparado por `trg_reservation_capacity` em
`reservations`), não duplicada numa segunda trava: quando
`tours.booking_model = 'flexible_private'`, qualquer tentativa de segunda
reserva ativa (confirmada ou hold válido) na mesma `departure` é recusada
antes mesmo de chegar na checagem de capacidade. Isso automaticamente
protege também um futuro hold do marketplace (ainda não integrado) sem
precisar de código novo quando esse dia chegar -- é o MESMO caminho de
inserção em `reservations`, sempre.

## Preço do privativo -- `fixed` vs `per_hour`, nunca amarrado a `price_type`

`pricing_mode` é um conceito da REGRA de disponibilidade (`tour_flexible_booking_rules`),
não do passeio -- `tours.price_type` continua existindo e significando o
mesmo de sempre para o resto do sistema (marketplace, relatórios). Sugestão
de valor no balcão: `fixed` sugere `tour.base_price_cents` (fixo,
independente da duração); `per_hour` sugere `hourly_price_cents × duração`,
proporcional aos minutos (2h30 = ×2,5, nunca arredondado pra hora cheia).
Em ambos os casos, o operador continua podendo editar o valor manualmente
no balcão -- a mesma flexibilidade de negociação de sempre, o "sugerido"
nunca é obrigatório. `departures.price_cents`/`departures.price_type` não
foram redefinidos: a `departure` privativa nasce sem preço próprio
(`price_cents = null`), porque o valor da reserva já fica gravado
diretamente em `reservations.total_cents` (RPC recebe `p_total_cents`
calculado/editado no cliente, mesma semântica de `create_counter_reservation`).

## Troca de `booking_model` -- bloqueada com estado conflitante, nunca reconciliada

`trg_tour_booking_model_transition` (em `tours`, `before update of
booking_model`) bloqueia a troca -- nos DOIS sentidos -- se existir qualquer
`departure` futura não cancelada, ou uma agenda recorrente ativa
(saindo de `fixed_schedule`), ou uma regra flexível ativa (saindo de
`flexible_private`). Nunca apaga, pausa ou reconcilia nada sozinho -- só
recusa a troca com uma mensagem clara do que precisa ser resolvido
primeiro (mesma filosofia de "bloquear, nunca surpreender" já usada em
`check_tour_schedule_rule_fk_company`/`check_tour_marketplace_transition`).
Dados históricos (departures/reservas passadas) nunca impedem a troca --
só estado operacional ATIVO/FUTURO conflita.

## `tour_schedule_rules` pertence só a `fixed_schedule`

`check_tour_schedule_rule_fk_company` (estendida nesta migration) recusa
qualquer INSERT/UPDATE de agenda recorrente cujo `tour.booking_model` não
seja `fixed_schedule`, com o código `TOUR_NOT_FIXED_SCHEDULE` -- backend,
não só UI escondida. Simetricamente, `save_flexible_booking_rule` recusa
salvar disponibilidade flexível num passeio `fixed_schedule`
(`TOUR_NOT_FLEXIBLE`).

## ToursFlow ainda não suporta `flexible_private`

Decisão explícita desta etapa: **não alterar o repositório ToursFlow**. Até
lá, um passeio `flexible_private` nunca pode ser vendido/exibido como se
fosse `fixed_schedule`. Três camadas de defesa, nenhuma delas sozinha
suficiente:

1. `validate_tour_for_publishing` (migration 0044/0063, estendida aqui)
   recusa publicar QUALQUER passeio `flexible_private`, com a mensagem
   literal pedida ("Passeios com horário flexível ainda não estão
   habilitados para publicação no ToursFlow.") -- roda tanto no checklist
   visual quanto no gatilho `check_tour_marketplace_transition`, que
   intercepta até uma tentativa de `UPDATE` direto via API do Supabase.
2. As três rotas públicas (`/api/public/tours`, `/api/public/tours/[slug]`,
   `/api/public/tours/[slug]/departures`) filtram explicitamente `.neq("booking_model",
   "flexible_private")` -- defesa em profundidade independente da (1): mesmo
   que `marketplace_status` virasse `published` por algum caminho
   administrativo que ignore a validação normal (o próprio `check_tour_marketplace_transition`
   permite super_admin fazer qualquer transição), a API pública nunca
   listaria/venderia esse passeio.
3. `fixed_schedule` publicado **não sofre regressão nenhuma** -- as três
   rotas continuam funcionando exatamente como antes para todo passeio
   nesse modelo (a cláusula nova é aditiva, não reescreve nenhum filtro
   existente).

## Não tocado

Pagamentos, Asaas, comissão, ledger, withdrawals, catálogo realtime,
condições do vento, arquivamento de passeio, bulk cleanup de saídas.
`MARKETPLACE_PAYMENTS_ENABLED`/`MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED`
continuam `OFF`.
