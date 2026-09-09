# ADR 0008 — Automação de agenda do operador (`tour_schedule_rules`)

- Status: aceita
- Data: 2026-09-08
- Contexto: simplificação total do fluxo do operador -- reduzir o trabalho manual de criar `departures` uma a uma, sem alterar `departures` como unidade real vendável. Branch `feature/operator-schedule-automation`, não mesclada em `main`.

## Objetivo

Hoje o operador precisa ir em Saídas → Nova saída → escolher passeio →
embarcação → data → hora → preço, repetindo isso pra cada saída futura.
Tecnicamente correto, mas péssimo como UX pra quem tem uma agenda fixa
(ex: "todo dia, 10h e 14h"). O operador deve pensar só em: cadastrar
embarcação, criar passeio, dizer quando ele acontece, publicar. O sistema
cuida da granularidade de `departures` por baixo.

## Decisão central -- `departures` continua sendo a única unidade vendável

`tour_schedule_rules` é **só uma camada de automação** que gera `departures`
reais. Nada no marketplace muda: `POST /api/marketplace/bookings` continua
lendo `departures.price_cents`/`departures.capacity` como autoridade
(`src/app/api/marketplace/bookings/route.ts`, inalterado), a capacidade
continua garantida inteiramente no banco via `trg_reservation_capacity`
(em `reservations`, inalterado) e `set_departure_capacity` (em `departures`,
inalterado). Uma `departure` gerada automaticamente é **indistinguível**, pro
resto do sistema, de uma criada manualmente -- a única marca é a coluna nova
`departures.schedule_rule_id` (nullable, só rastreia origem, nunca usada
por nenhuma regra de negócio existente).

## Dois modos, um schema

- **Recorrente**: dias da semana + horários + horizonte -- precisa de uma
  entidade (`tour_schedule_rules`) porque é uma REGRA que se repete e se
  reavalia (auto-extensão).
- **Datas específicas**: criação direta de `departures` avulsas -- **não
  precisa de tabela nova**, é literalmente `createDeparture()`
  (`src/app/(app)/saidas/actions.ts`, reaproveitada sem alteração via
  `createOneOffDepartureForTour()`), só exposta na própria página do
  passeio em vez de exigir navegar até `/saidas`.

Um passeio tem no máximo **uma** regra recorrente ativa por vez (modelo
simples: "quando esse passeio acontece", não uma lista de agendas
nomeadas) -- salvar de novo edita a existente via upsert, nunca cria uma
segunda.

## `tour_schedule_rules` -- campos e por quê

`company_id`/`tour_id`/`vessel_id` (FK + trigger `check_tour_schedule_rule_fk_company`,
mesmo padrão de `check_departure_fk_company`, 0019 -- nunca confia que
vessel_id/tour_id do formulário pertencem à empresa certa), `days_of_week
smallint[]` (convenção `extract(dow from timestamp)` do Postgres: 0=domingo
.. 6=sábado, evita reconverter em outro lugar), `times time[]` (hora local
São Paulo, sem tz -- convertida só no momento da geração), `horizon_days`
(30/60/90, default 90), `capacity_override`/`price_cents_override`
(nullable -- `null` = herda do passeio/embarcação), `auto_extend`, `active`.

**Preço**: `effective_price_cents = coalesce(rule.price_cents_override,
tour.base_price_cents)`. `price_type` da departure gerada é sempre o do
tour (`tours.price_type`) -- só o VALOR é personalizável por agenda, nunca
o tipo. **Capacidade**: `capacity_override` só é aceito se `<=
vessels.commercial_capacity` (validado no SAVE da regra, trigger
`check_tour_schedule_rule_capacity`, mesma regra de `set_departure_capacity`,
0000) -- se `null`, a `departure` nasce sem capacidade explícita e o
trigger JÁ EXISTENTE (`set_departure_capacity`) preenche a partir da
embarcação, exatamente como uma `departure` manual sem capacidade
informada.

## Geração idempotente -- `generate_departures_for_schedule_rule`

SQL, `security definer`, `service_role`-only. Calcula os timestamps UTC
alvo (`(data + hora) AT TIME ZONE '-03:00'`, mesmo offset fixo de
`saoPauloToUTC()` em `src/lib/format.ts` -- Brasil não observa mais
horário de verão, então isso é exato, não uma aproximação) dentro da
janela `[hoje, hoje + horizon_days]`, e insere via `INSERT ... ON CONFLICT
(vessel_id, departs_at) DO NOTHING` -- reaproveita o `unique(vessel_id,
departs_at)` que já existe desde `0000` (nunca duas saídas do mesmo barco
no mesmo instante, seja de agenda ou manual). Um índice único adicional,
`(schedule_rule_id, departs_at) where schedule_rule_id is not null`,
garante que a MESMA regra nunca gera duas linhas pro mesmo instante,
independente do primeiro. `pg_advisory_xact_lock` por `schedule_rule_id`
serializa execuções concorrentes da mesma regra (ex: operador salva duas
vezes rápido, ou o cron roda em paralelo com um save manual).

**Salvar a mesma agenda duas vezes nunca duplica** -- e rodar a geração
depois de uma falha de rede/persistência (o server action chama a RPC
depois de já ter salvo a regra) é seguro pelo mesmo motivo: idempotência
vem do `ON CONFLICT`, não de nenhum estado adicional no server action.

## Editar/pausar uma regra nunca apaga nada

Pedido explícito: "nunca apagar silenciosamente saída com reserva; nunca
alterar histórico passado; nunca apagar reserva; nunca alterar saída
encerrada/cancelada". A decisão mais simples e mais segura: **editar uma
regra e salvar de novo só GERA saídas novas pra frente** (via a mesma
`generate_departures_for_schedule_rule`, que só faz `INSERT`) -- nunca
remove/edita `departures` já existentes, mesmo que elas não batam mais com
os novos parâmetros da regra (ex: operador tira quinta-feira da lista de
dias -- as quintas já geradas continuam existindo, válidas e reserváveis).
Isso elimina inteiramente a necessidade de uma lógica de diffing/cleanup
complexa -- e é consistente com o fato de que `deleteDeparture` (em
`saidas/actions.ts`, inalterado) já bloqueia remoção quando existem
reservas. "Pausar agenda" (`active = false`) só impede geração FUTURA
(nova chamada da RPC, seja manual ou via cron, não faz nada pra uma regra
inativa) -- não toca em nenhuma `departure` já gerada.

## Publicação -- "sem agenda" passa de aviso pra bloqueio

`validate_tour_for_publishing` (`0039`/`0044`) já checava "zero saídas
futuras", mas como **warning** (nunca bloqueava). Migration `0063` eleva
esse MESMO check (`NO_FUTURE_DEPARTURES`) pra `error`, com mensagem nova
("Escolha quando esse passeio acontece -- adicione uma agenda ou pelo
menos uma data."). Nenhuma outra regra do checklist foi tocada -- diff
byte-a-byte confirmado contra a versão de `0044` antes de commitar.
Deliberadamente **não** existe um check separado sobre `tour_schedule_
rules` -- checar `departures` futuras reais é mais geral e correto (cobre
tanto agenda recorrente quanto datas específicas, e corretamente continua
bloqueando se uma regra existe mas ainda não gerou nenhuma saída, por
exemplo horizonte mal configurado). Como o trigger de transição
(`check_tour_marketplace_transition`) só reavalida no MOMENTO da
transição pra `published`, essa mudança não despublica retroativamente
nenhum passeio já publicado sob a regra antiga.

## Auto-extensão -- primeiro cron deste projeto

Nenhuma infraestrutura de cron existia antes (auditado explicitamente --
sem `vercel.json`, sem `/api/cron/*`). Implementado o mínimo necessário:
`vercel.json` com um cron diário (`0 6 * * *`) apontando pra
`/api/cron/extend-schedules`, protegido pelo mecanismo OFICIAL da Vercel
(documentação consultada ao vivo nesta sessão, não inventado): env var
`CRON_SECRET`, header `Authorization: Bearer $CRON_SECRET` injetado
automaticamente pela Vercel, comparação `authHeader !== \`Bearer
${cronSecret}\`` -- fail closed se a env var não existir. `CRON_SECRET`
**não foi configurado** nesta sessão (nenhum secret alterado) -- fica
pendente pro usuário configurar quando este mecanismo for ativado de
verdade em produção. A rota em si não confia em nenhuma outra coisa além
desse header -- nunca aceita nenhum dado do corpo da requisição.

**Idempotência/concorrência do cron** (pedido explícito da própria
documentação da Vercel: "cron jobs should be resilient to both missed
runs and duplicate runs"): cada regra ativa (`active AND auto_extend`) é
processada independentemente, e a geração em si já é idempotente e
protegida por advisory lock -- rodar a mesma execução duas vezes (retry
da Vercel) ou perder uma execução nunca duplica nem corrompe nada.

## O que NÃO foi alterado (confirmado por escopo do diff)

Nenhum arquivo de marketplace/pagamento/webhook/refund foi tocado nesta
etapa -- `POST /api/marketplace/bookings`, criação/resolução automática de
`clients` (`create_marketplace_booking`, inalterada), payment, webhook
Asaas, refund, ledger, comissão, voucher, `X-ToursFlow-Client-Key`, Bearer
ToursFlow, idempotência de reserva/pagamento -- todos intactos. `/saidas`
não foi removida nem alterada -- continua existindo como "agenda
operacional" pra edição avançada, cancelamento, manifesto, e criação
manual excepcional.

## Pendências explícitas

- Migration `0063` não aplicada (nem em produção, nem localmente testada
  contra um Postgres real -- sem Docker/Supabase local neste ambiente,
  mesma limitação estrutural de toda a sessão). Revisada linha a linha,
  diff da função estendida (`validate_tour_for_publishing`) confirmado
  byte-a-byte contra a versão anterior.
- `CRON_SECRET` não configurado -- auto-extensão não funciona de verdade
  até isso ser feito.
- Onboarding com indicador de progresso (✓ Dados / ✓ Embarcação / ○ Agenda
  / ○ Publicar) não implementado nesta etapa -- o checklist de publicação
  já existente (`PublicationPanel`) cobre a mesma necessidade prática
  (mostra o que falta antes de publicar), decisão de não duplicar essa UX
  com um segundo componente de progresso agora.
- Branch não mesclada em `main`, nada deployado, nenhuma migration
  aplicada, nenhum dinheiro movimentado.
