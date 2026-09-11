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

## Editar/pausar uma regra reconcilia -- nunca deixa saída obsoleta vendável

**Revisado em hardening antes do merge.** A primeira versão desta decisão
("editar só gera pra frente, nunca remove") permitia que uma saída
automática obsoleta (ex: horário antigo, depois de trocar 10h por 14h)
continuasse vendável indefinidamente -- inaceitável: o operador editaria a
agenda esperando que ela refletisse a mudança, mas o ToursFlow continuaria
oferecendo o horário errado. Corrigido com `reconcile_departures_for_
schedule_rule(uuid)` (nova RPC, `service_role` only), chamada SEMPRE antes
de `generate_departures_for_schedule_rule` pelo server action.

Pra cada departure automática (`schedule_rule_id` = a regra), futura, ainda
`agendada` (o próprio `WHERE` já exclui passada/encerrada/cancelada/manual
-- nunca tocadas, por construção da query, não por uma checagem condicional
que poderia ter um bug):

1. **Tem reserva/hold "relevante"** -- `confirmada`, ou `pendente` com hold
   ainda válido (MESMA definição de "consome capacidade" de
   `check_departure_capacity`, 0042). Deliberadamente mais estreita que
   `deleteDeparture()` (bloqueia remoção manual por qualquer reserva
   histórica, mesmo cancelada) -- reconciliação automática usa um critério
   mais preciso porque é uma ação do sistema, não uma decisão humana
   explícita. → **protegida**: nunca removida, nunca tem preço/capacidade
   alterados, contrato com o cliente intocado.
2. **Sem reserva relevante, ainda bate com a regra atual** (mesma
   embarcação, dia/horário dentro do horizonte, regra ativa) → **mantida**,
   mas preço/capacidade são reconciliados pra refletir a configuração
   ATUAL (`coalesce(price_cents_override, tour.base_price_cents)` /
   `coalesce(capacity_override, vessel.commercial_capacity)`).
3. **Sem reserva relevante, não bate mais** (regra editada, ou pausada) →
   **removida de verdade** (`DELETE`, mesmo estilo de `deleteDeparture`:
   apaga `manifests` primeiro, redundante com `ON DELETE CASCADE` mas
   consistente com o padrão já existente).

Idempotente por construção -- é um "diff contra a verdade atual", não um
contador com estado: rodar duas vezes seguidas a segunda vez não encontra
mais nada obsoleto. `pg_advisory_xact_lock` (mesma chave usada por
`generate_departures_for_schedule_rule`) serializa as duas contra execuções
concorrentes da mesma regra.

**Pausar** (`active=false`) roda a MESMA reconciliação -- como nenhum slot
é "válido" pra uma regra inativa, toda departure automática sem reserva
relevante é removida (retira da disponibilidade), as protegidas continuam
vendáveis normalmente (têm um cliente real, pausar a automação não deveria
fazer o compromisso já assumido desaparecer). **Reativar** (`active=true`)
só chama `generate` de novo -- idempotente, recria apenas o que falta,
nada precisa ser "restaurado" porque nada além do que a pausa já fez foi
alterado.

**Conflito de embarcação/horário, sempre reportado, nunca silencioso**:
`generate_departures_for_schedule_rule` retorna uma linha por slot
TENTADO (não só os criados), com `was_conflict`. Bookkeeping normal (o
slot já pertence a ESTA regra -- reconciliação já cuidou dele) nunca é
reportado; só um conflito REAL (outra origem no mesmo vessel+horário) é
contado e mostrado ao operador ("N horário(s) não criado(s) porque a
embarcação já tinha outra saída").

## Publicação -- "sem agenda" passa de aviso pra bloqueio

`validate_tour_for_publishing` (`0039`/`0044`) já checava "zero saídas
futuras", mas como **warning** (nunca bloqueava). Migration `0063` eleva
esse MESMO check (`NO_FUTURE_DEPARTURES`) pra `error`, com mensagem nova
("Escolha quando esse passeio acontece -- adicione uma agenda ou pelo
menos uma data."). **Corrigido em hardening**: o count original contava
qualquer `departure` futura não-cancelada, mesmo sem `price_cents`
configurado -- uma departure sem preço não é vendável de verdade
(`create_marketplace_booking` recusa com `PRICE_NOT_CONFIGURED`), então
deixaria publicar um passeio sem nenhum jeito real de ser comprado. O
`count(*)` agora exige `price_cents is not null` também. Nenhuma outra
regra do checklist foi tocada -- diff byte-a-byte confirmado contra a
versão de `0044` antes de commitar. Deliberadamente **não** existe um
check separado sobre `tour_schedule_rules` -- checar `departures` futuras
reais com preço é mais geral e correto (cobre tanto agenda recorrente
quanto datas específicas -- publicar sem nenhuma regra recorrente sempre
foi possível e continua sendo -- e corretamente continua bloqueando se
uma regra existe mas ainda não gerou nenhuma saída, por exemplo horizonte
mal configurado). Como o trigger de transição
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

## Revisão independente -- blockers reais corrigidos antes de aplicar

**Bug real, teria impedido a aplicação**: o CHECK constraint de validação
de `days_of_week` usava um sub-select (`not exists (select ... from
unnest(...))`) -- Postgres proíbe sub-selects na expressão de um CHECK
constraint (regra do banco, a migration inteira teria falhado ao aplicar).
Corrigido pra `days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]` (operador
de array, sem sub-select). Duplicatas de dias/horários e janela de horário
(08:00-19:00, mesma de `createDeparture`) viraram um trigger novo -- código
PL/pgSQL comum pode usar sub-select livremente, só a expressão do CHECK em
si não pode.

**`UNIQUE (tour_id)`**: a garantia de "uma regra por passeio" agora é do
banco, não de um `SELECT` seguido de `INSERT`/`UPDATE` no server action
(que tinha uma corrida real). Server action trocado por
`upsert(payload, { onConflict: "tour_id" })`.

**Sellability ≠ preservação operacional**: nova coluna
`departures.marketplace_sales_enabled`. "Preservar a saída" (nunca apagar,
nunca mexer em reserva/preço/capacidade de algo com reserva relevante) e
"continuar vendendo a saída" são decisões DIFERENTES -- uma departure
protegida que deixou de bater com a regra atual (editada ou pausada) fica
`sales_enabled=false`: continua existindo, operacional, com a reserva
intacta, mas para de aceitar reserva NOVA. Calculado dentro de
`reconcile_departures_for_schedule_rule` (a mesma função já reconciliava
preço/capacidade -- sellability é só mais uma dimensão da mesma
reconciliação, ver comentário na migration). `POST /api/marketplace/
bookings` e `GET /api/public/tours/[slug]/departures` checam essa coluna
-- únicos dois arquivos de marketplace tocados, contrato HTTP inalterado
(reusam `DEPARTURE_NOT_SELLABLE` e o padrão de filtro que já existia pra
`price_cents is not null`).

**Herança de preço em "Datas específicas"**: `createDeparture()`
(reaproveitada, inalterada) grava `NULL` quando o preço vem vazio -- certo
pro contexto genérico de `/saidas`, errado pra UX da página do passeio
("opcional -- usa o preço do passeio"). Resolvido só na camada nova
(`createOneOffDepartureForTour`, via `resolveOneOffPriceReais()`, pura e
testável): campo vazio → resolve `tours.base_price_cents` no servidor
antes de delegar.

**Preço-base do passeio reconcilia**: `updateTourFull()` chama a nova
`reconcile_departures_for_tour(uuid)` (itera as regras do passeio) quando
`base_price_cents` muda de verdade. Regra com `price_cents_override`
nunca é afetada -- o `coalesce` já ignora o novo `base_price` sozinho.

**Cron -- reconcile antes de generate**: sem isso, o horizonte
auto-estendido nunca refletiria uma edição/pausa manual feita entre duas
execuções do cron.

**Timezone -- avaliado e mantido `-03:00` fixo**: `America/Sao_Paulo`
nomeado foi considerado e descartado -- introduziria uma divergência real
com `saoPauloToUTC()` (offset fixo, usada por "Datas específicas") se o
Brasil algum dia reintroduzir horário de verão. Hoje os dois são
numericamente idênticos; "modernizar" só um lado seria risco sem
benefício. Teste explícito com a função real confirma `2026-09-20 10:00
America/Sao_Paulo -> 2026-09-20T13:00:00Z`.

> **CORRIGIDO (`0066`, achado real em staging -- ver seção "AT TIME ZONE
> '-03:00' não é equivalente..." mais abaixo): esta decisão está
> INCORRETA.** `'-03:00'` (offset numérico) e `'America/Sao_Paulo'` (nome
> IANA) NÃO são tratados de forma equivalente pelo `AT TIME ZONE` do
> Postgres -- o offset numérico cai num caminho de parsing com convenção
> de sinal invertida (estilo POSIX), diferente do nome de zona (ISO-8601).
> A conclusão certa era a oposta: o nome IANA é a opção sem ambiguidade,
> não o offset fixo. Não editado aqui pra preservar o registro histórico
> da decisão original -- ver a correção completa abaixo.

**ACL de todas as 6 funções novas**: as 4 funções-trigger ganharam
`revoke all` explícito (Supabase concede `EXECUTE` por padrão em função
nova pra `anon`/`authenticated`/`service_role`, mesmo achado já
documentado em `0044`) -- revogar não quebra o disparo do trigger em si.

**Honestidade sobre o que não foi testado**: `0063` não foi aplicada nem
validada contra um Postgres real nesta sessão (sem Docker/Supabase local).
O bug do CHECK constraint foi encontrado por conhecimento da regra
documentada do Postgres, não por execução observada. Toda a lógica de
reconciliação foi verificada por revisão de código, não por execução.

## Release candidate -- defesa no banco, vendabilidade exata, atomicidade

**Corrida real fechada na autoridade transacional**: a checagem de
`marketplace_sales_enabled` só existia em TypeScript (`route.ts`), ANTES
de chamar `create_marketplace_booking` -- janela real entre a leitura e a
chamada da RPC (a agenda pode ser pausada/reconciliada nesse meio tempo).
`create_marketplace_booking` (0042/0044, estendida via `create or replace`
em `0063`, corpo idêntico + uma checagem nova) revalida `status='agendada'`
e `marketplace_sales_enabled=true` **na mesma transação que cria a
reserva**, mesmo código de erro (`DEPARTURE_NOT_SELLABLE`) que a rota já
usava -- nenhum contrato HTTP novo.

**"Future sellable departure" definido uma única vez**: `NO_FUTURE_
DEPARTURES` usava `status <> 'cancelada'` (contava `em_andamento`/
`encerrada`/protegidas-mas-fechadas como "válido"). Corrigido pra exigir
`status='agendada' AND departs_at>now() AND price_cents is not null AND
marketplace_sales_enabled=true` -- a MESMA definição que `create_
marketplace_booking` usa pra aceitar uma reserva, nunca duas fontes de
verdade.

**Atomicidade real -- fim do estado parcial**: `save_recurring_schedule`/
`pause_recurring_schedule`/`reactivate_recurring_schedule` (novas,
`authenticated`-scoped, derivam `company_id` de `auth.uid()`) substituem a
orquestração de 2-3 chamadas PostgREST separadas por UMA função cada,
fazendo upsert/update da regra + `reconcile` + `generate` na mesma
transação. Qualquer falha interna aborta tudo -- nunca existe "regra
salva mas nunca reconciliada" ou "pausada mas saída antiga continua
vendável". `authenticated` perdeu `INSERT`/`UPDATE`/`DELETE` direto na
tabela (só `SELECT` continua) -- toda escrita passa pelas três RPCs.
Mudança de preço-base ganhou o mesmo tratamento via TRIGGER (`AFTER
UPDATE OF base_price_cents ON tours`, não uma segunda chamada RPC do
server action) -- genuinamente atômico com o próprio `UPDATE` do preço.

Detalhes completos em `DOCUMENTACAO.md` seção 103.

## ACL efetiva divergia da intenção -- `0064`, achado em Postgres real

A afirmação acima ("`authenticated` perdeu `INSERT`/`UPDATE`/`DELETE`
direto na tabela") era a intenção da migration, escrita e revisada antes
de qualquer execução contra um Postgres real. Quando `0063` foi finalmente
aplicada e testada num Supabase de staging real, `has_table_privilege()`
mostrou que `authenticated` **ainda** tinha `INSERT`/`UPDATE`/`DELETE`
diretos em `tour_schedule_rules` -- o projeto Supabase concede esses
privilégios por padrão a toda tabela nova do schema `public`, mesmo padrão
já documentado em `0043` do lado de `EXECUTE` de função. `grant select
...` da 0063 nunca revogou o que o projeto já concedia por padrão; a
policy `for all to authenticated` também cobria escrita, com row-scope da
própria empresa.

Corrigido em `0064_tour_schedule_rules_acl_hardening.sql` (migration nova,
`0063` não reaberta): `revoke all ... from anon, public` (não só os
privilégios de escrita -- sem prova de que `anon` não recebeu SELECT por
default também, o correto é revogar tudo, não presumir), `revoke insert,
update, delete, truncate, references, trigger ... from authenticated` +
`grant select ... to authenticated` pra deixar só leitura, policy `for
all` substituída por uma `for select` só-leitura, ACL das três RPCs
reconfirmada (já estava correta). Lição geral, já válida antes mas
reforçada aqui com prova real: **nenhuma tabela ou função nova neste
projeto pode confiar em "eu só dei GRANT de X", nem em suposições sobre o
que os outros roles NÃO receberam por default -- é preciso revogar
explicitamente e verificar, sempre**. Detalhes completos em
`DOCUMENTACAO.md` seção 104.

## Ambiguidade de coluna real em `generate_departures_for_schedule_rule` -- `0065`

Achado em Postgres real, durante a validação funcional em staging (a
primeira vez que uma regra recorrente foi de fato gerada contra um
Postgres real): `ERROR: 42702: column reference "departs_at" is
ambiguous`. `generate_departures_for_schedule_rule` é `returns table
(departure_id uuid, departs_at timestamptz, was_conflict boolean)` --
cada coluna de `RETURNS TABLE` vira uma variável OUT implícita com o
mesmo nome; a função também insere em `departures`, que tem uma coluna
real `departs_at`. O `INSERT` em si nunca foi ambíguo (lista de colunas
de INSERT só aceita nome de coluna), mas o alvo do `ON CONFLICT (vessel_
id, departs_at)` fica sujeito à mesma checagem de ambiguidade de uma
referência de coluna comum -- e colide com a variável OUT.

Corrigido em `0065_fix_schedule_generation_conflict_ambiguity.sql`
(migration nova, `0063` não reaberta): `on conflict on constraint
departures_vessel_id_departs_at_key do nothing`, referenciando a
constraint UNIQUE `(vessel_id, departs_at)` (nome determinístico padrão do
Postgres pra constraint sem nome explícito, confirmado estável desde 0000
-- nenhuma migration posterior a toca) pelo NOME em vez da lista de
colunas. Um namespace de constraint nunca colide com namespace de
coluna/variável PL/pgSQL -- elimina a ambiguidade estruturalmente, mesma
constraint, mesma proteção contra corrida/duplicidade, nenhuma mudança de
comportamento. Resto do corpo da função auditado -- nenhuma outra
referência com o mesmo risco (as demais já usavam alias ou a variável
local `v_departs_at`, nunca o nome nu `departs_at`). ACL reafirmada
explicitamente na própria `0065`, mesmo padrão de defesa em profundidade
já usado em `0043`/`0064`. Detalhes completos em `DOCUMENTACAO.md` seção
105.

## `AT TIME ZONE '-03:00'` não é equivalente a `'America/Sao_Paulo'` -- decisão anterior estava INCORRETA, `0066`

Achado em Postgres real, imediatamente depois de `0065` aplicada em
staging (o 42702 parou de ocorrer): `generate_departures_for_schedule_
rule` gerou uma agenda configurada para as **10:00** -- bem no meio da
janela 08:00-19:00 -- e `check_departure_schedule()` (0014) recusou com
"O horário de saída deve ser entre 08:00 e 19:00". A decisão original
desta ADR ("Timezone -- avaliado e mantido `-03:00` fixo", acima) estava
**incorreta**: `'-03:00'` (offset numérico) e `'America/Sao_Paulo'` (nome
IANA) não são tratados de forma equivalente pelo `AT TIME ZONE` do
Postgres. `check_departure_schedule()` usa o NOME de zona, resolvido sem
ambiguidade pela base IANA/Olson. `generate_departures_for_schedule_rule`/
`reconcile_departures_for_schedule_rule` (0063) usavam o OFFSET NUMÉRICO
-- que, por não ser um nome nem uma abreviação reconhecida, cai no mesmo
caminho de parsing de especificações de fuso estilo POSIX, com convenção
de sinal INVERTIDA em relação à ISO-8601 (POSIX trata "positivo" como
OESTE de Greenwich). Prova (consistente com o erro real observado):

```sql
select (timestamp '2026-09-20 10:00' at time zone '-03:00')
         at time zone 'America/Sao_Paulo';
-- 2026-09-20 04:00:00 -- fora de 08:00-19:00, mesmo tipo de rejeição
-- observada de verdade em staging pra uma agenda de 10:00.
```

A preocupação original (evitar reintroduzir horário de verão) não estava
errada como preocupação -- a CONCLUSÃO estava invertida: o nome IANA é
exatamente a opção sem ambiguidade, não o offset fixo.

Corrigido em `0066_fix_schedule_timezone_semantics.sql` (migration nova,
`0063`/`0065` não reabertas): as 6 ocorrências de `AT TIME ZONE '-03:00'`
em `generate_departures_for_schedule_rule`/`reconcile_departures_for_
schedule_rule` trocadas por `AT TIME ZONE 'America/Sao_Paulo'` -- a mesma
zona que `check_departure_schedule()` já usa, eliminando a divergência
estruturalmente (as duas conversões passam a ser literalmente a mesma
chamada). `ON CONFLICT ON CONSTRAINT` da `0065` preservado integralmente.
`reconcile_departures_for_tour` auditada, sem cálculo de fuso próprio, não
precisou ser recriada. ACL das duas funções recriadas reafirmada
explicitamente, mesmo padrão de `0043`/`0064`/`0065`. Detalhes completos
em `DOCUMENTACAO.md` seção 106.

## Fechamento -- validação funcional completa em staging, sem falhas

O script único de validação (0063/0064/0065/0066, com PRE-CLEAN e veículo
dedicado de datas específicas -- ver `DOCUMENTACAO.md` seção 107) rodou
de ponta a ponta no Supabase de staging (`ddlgkrpjzmtgmoucangh`) sem
nenhum `RAISE EXCEPTION`, em nenhuma das 18 transações (PRE-CLEAN + FASE
0 até FASE 13, incluindo FASE 1B). Dado que cada fase levanta exceção
explícita na primeira condição que não bater, e nenhuma fase mascara
conflito com `ON CONFLICT DO NOTHING` nos pontos que precisam provar
criação, essa mensagem final ("SEM NENHUM RAISE EXCEPTION = TUDO PASSOU")
só é alcançável com todas as asserções realmente passando.

Três bugs reais foram encontrados e corrigidos nesta rodada -- todos só
visíveis em execução real contra Postgres, não por revisão de código:
ambiguidade de coluna (`42702`, `0065`), semântica de fuso horário
incorreta (`0066`), e uma colisão de chave única entre dois fixtures do
próprio script de teste (`23505`, corrigida só no script, sem migration
nova). `0063`, `0064`, `0065` e `0066` estão confirmadas com PASS real em
Postgres de staging. A FASE 13 do próprio script removeu todos os
fixtures `[STAGING TEST]` (empresas, veículos, passeios, regras,
departures, reservas, clientes, e o usuário de teste em `auth.users`) --
staging fica sem resíduo de teste. Nenhuma das quatro migrations foi
aplicada em Production (`gggpihphjjxndpfntnvm`) até este ponto. Detalhes
completos em `DOCUMENTACAO.md` seção 108.

## Production pre-flight + tentativa de release real -- dry-run sem conectividade, aplicação manual preparada

Pre-flight somente leitura confirmou as 4 migrations seguras pra Production
como conjunto: nenhuma dependência de fixture/dado de staging, nenhuma
alteração além de schema/função (nunca `UPDATE`/`DELETE` de dado real de
operador), encadeamento de dependência correto entre `0063`→`0064`→`0065`→
`0066`, nenhum toque estruturalmente possível em pagamento/saque/Asaas
(essas flags vivem só como variável de ambiente da Vercel). Mecanismo
oficial de reconciliação de `supabase_migrations.schema_migrations`
reconfirmado via `--help` do CLI: `migration repair --status applied
<versões> --linked`, nunca INSERT manual.

`npx supabase db push --linked --dry-run` contra Production travou em
"Initialising login role..." -- mesma falha de conectividade do protocolo
Postgres já documentada repetidamente nesta sessão, para staging e
Production igualmente. Por instrução explícita do usuário, nenhuma nova
tentativa foi feita e nenhum `db push` real foi executado contra
Production. CLI relinkado de volta a staging.

Como a via CLI não pôde ser validada, foi preparado um único script SQL
(uma transação `begin`/`commit` atômica) com: PRE-FLIGHT FAIL-CLOSED
(aborta antes de qualquer DDL se faltar alguma dependência de `0000`-`0062`
ou se já existir qualquer artefato de `0063`-`0066`, sem tentar
adivinhar/reparar estado parcial); o conteúdo verbatim de `0063`→`0064`→
`0065`→`0066`, byte a byte, sem reescrita; e uma VALIDAÇÃO READ-ONLY final
(schema, ACL de tabela e de RPC, e o texto-fonte das funções corrigidas
por `0065`/`0066` via `pg_get_functiondef()`) -- qualquer falha reverte a
transação inteira. Não insere nada em `supabase_migrations.schema_
migrations`. Nenhuma das 4 migrations foi aplicada em Production nesta
sessão. Detalhes completos em `DOCUMENTACAO.md` seção 109.

## Descoberta: Production já tinha 0063-0066 no schema; migration history reconciliation pendente

O PRE-FLIGHT do script de release abortou em Production com "`tour_
schedule_rules` já existe" -- corretamente, antes de qualquer DDL, sem
alterar nada. Um diagnóstico read-only dedicado (só `SELECT`/inspeção de
catálogo, iterado duas vezes para cobrir ACL de policy INSERT/UPDATE/
DELETE, `anon` nas 4 funções internas, e as 3 condições de `create_
marketplace_booking`) confirmou que o schema de Production já contém
`0063`-`0066` integralmente e corretamente: `tour_schedule_rules` e as 2
colunas novas de `departures` presentes, `0064` (ACL hardening) PASS,
`0065` (`ON CONFLICT ON CONSTRAINT`) PASS, `0066` (`America/Sao_Paulo` nas
duas funções, `-03:00` ausente) PASS. Só `supabase_migrations.schema_
migrations` estava desatualizada -- apenas `0063` registrada como
`applied`, `0064`/`0065`/`0066` ausentes da tabela de controle apesar do
schema real já refletir as 3. Nenhuma migration SQL precisava (ou devia)
ser reaplicada -- só reconciliação de histórico via `migration repair`.

A tentativa de reconciliação (`migration repair --status applied 0064
0065 0066 --linked`) foi bloqueada duas vezes: primeiro pelo classificador
de aprovação automática do ambiente (ação mutável contra Production,
mesmo sendo só bookkeeping do CLI) -- o usuário autorizou explicitamente
uma segunda tentativa; a segunda travou por conectividade (mesmo padrão
de falha do protocolo Postgres direto já documentado repetidamente nesta
sessão). Por instrução do usuário, sem insistir além de uma tentativa.
Nenhum schema foi alterado em nenhuma das duas tentativas. `supabase_
migrations.schema_migrations` de Production continua mostrando só `0063`
como `applied` -- reconciliação de `0064`/`0065`/`0066` fica pendente,
sem impacto no schema real (já correto). Detalhes completos em
`DOCUMENTACAO.md` seções 110-111.

## Migration history reconciliada; achado bloqueante real na automação de cron (pre-merge)

`migration repair --status applied 0064 0065 0066 --linked` completou com
sucesso (confirmado pelo usuário via `migration list --linked`: `0063`-
`0066` alinhadas LOCAL/REMOTE em Production). Só bookkeeping do CLI --
nenhum schema alterado por este comando. CLI relinkado de volta a
staging.

Análise pre-merge (só leitura) da automação de extensão de horários
(`auto_extend`, cron `0 6 * * *` -> `/api/cron/extend-schedules`)
encontrou um achado real, confirmado por comportamento HTTP ao vivo: o
proxy de autenticação do app (`src/proxy.ts`/`src/lib/supabase/
middleware.ts`, a Next.js 16 renomeou `middleware.ts` para `proxy.ts`)
redireciona `/api/cron/extend-schedules` pra `/login` (307) ANTES da
rota sequer checar `Authorization: Bearer $CRON_SECRET` -- a lista
`isPublic` do proxy inclui `/api/webhooks`/`/api/public`/`/api/
marketplace` (os 2 últimos por um achado idêntico já documentado no
próprio código), mas não inclui `/api/cron`. A checagem de `CRON_SECRET`
da rota em si está correta e fail-closed -- o problema é estrutural,
uma camada acima, e impede que a chamada real do cron da Vercel (sem
cookie de sessão) alcance a rota. `CRON_SECRET` em Production não pôde
ser confirmado (ausente da listagem `vercel env ls production`, mas essa
listagem já teve um precedente de omitir variável configurada de
verdade -- `TOURSFLOW_API_SECRET`). Nada foi corrigido nesta etapa --
só análise, a pedido do usuário. Pendência pre-merge: incluir `/api/
cron` na allowlist do proxy + confirmar/configurar `CRON_SECRET` em
Production. Detalhes completos em `DOCUMENTACAO.md` seções 112-113.

## Blocker do cron corrigido -- proxy agora deixa a rota ser alcançada

`src/lib/supabase/middleware.ts` ganhou `path === "/api/cron/extend-
schedules"` na lista `isPublic` (comparação exata, não prefixo -- só
libera a única rota de cron que existe hoje, sem abrir de saída qualquer
cron futuro sem revisão). `src/proxy.ts` não precisou de mudança (seu
matcher já cobre `/api/*`). A rota do cron em si (`src/app/api/cron/
extend-schedules/route.ts`) não foi tocada -- continua exigindo
`Authorization: Bearer $CRON_SECRET`, fail-closed, `401` sem header/
secret correto. `tsc --noEmit`/`eslint .`(0 erros)/`next build` limpos.
Nenhum deploy em Production feito nesta etapa -- a confirmação de que o
redirect parou de acontecer em Production só é possível depois de
deployado. `CRON_SECRET` em Production continua não confirmável a partir
daqui. Detalhes completos em `DOCUMENTACAO.md` seção 114.

## RELEASE -- merge em `main`, deploy Production confirmado por comportamento real

Fast-forward `3bc809d..772939f` de `feature/operator-schedule-
automation` pra `main`, push com sucesso -- histórico linear, nenhum
commit de merge necessário. `npx vercel ls --prod` não listou nenhum
deployment novo (mesma divergência CLI-vs-realidade já documentada nesta
sessão pro alias de produção), mas `curl -I` real contra `/api/cron/
extend-schedules` confirma comportamento novo em Production: `401` em
vez do `307`/`location: /login` de antes da correção, `x-matched-path`
apontando pra rota real -- o blocker do proxy está resolvido em
Production de verdade, não só localmente. Deploy considerado PASS por
essa evidência comportamental direta, com a divergência de listagem da
CLI registrada sem explicação inventada.

Teste autenticado (200 com `CRON_SECRET` real) e os 6 smoke tests
funcionais (agenda recorrente, geração automática, pause/reactivate,
departure protegida, data específica + herança de preço, publicação/
sellability) **não foram executados** -- exigem UI real ou credenciais
de Production indisponíveis nesta sessão, reportados como NÃO TESTADO,
nunca como PASS inventado. `vercel.json` não alterado -- continua
declarando `/api/cron/extend-schedules`. Nenhum pagamento/Asaas/schema/
migration tocado. Detalhes completos em `DOCUMENTACAO.md` seção 115.

## UX do operador simplificada -- agenda em destaque, setup de 1 passo

Backend confirmado em Production, mas a UI ainda tratava "+ Nova saída"
manual como fluxo principal e escondia a agenda recorrente no fim da
edição completa do passeio. Correção 100% front-end, reaproveitando as
mesmas RPCs/validações já existentes -- nenhuma migration/schema/RPC/ACL
tocada.

Novo componente `QuickScheduleSetup` (`passeios/[id]/quick-schedule-
setup.tsx`) vira o primeiro bloco da página assim que um passeio é criado
e ainda não tem regra: embarcação, preço-base, dias, horários -- só isso.
Nova action `quickSetupSchedule` (`schedule-actions.ts`) atualiza
`tours.base_price_cents` e chama a MESMA `save_recurring_schedule`
(0063) com defaults fixos (`capacity_override=null`, `price_cents_
override=null`, `auto_extend=true`, `horizon_days=90`) -- a RPC já
reconcilia+gera as departures na mesma transação, sem o operador
cadastrar nenhuma saída manualmente. `ScheduleSection` decide entre esse
setup e o `ScheduleManager` já existente (edição recorrente, pause/
reactivate, datas específicas -- intocado); a agenda foi movida pro topo
da página (`page.tsx`). Em `tour-form.tsx`, todo o conteúdo comercial
(descrições, roteiro, incluso, embarque etc.) foi agrupado num `<details>`
"Informações para publicação no ToursFlow", deixando nome/preço visíveis
mas o resto fora do caminho do fluxo operacional. Em `/saidas`, "+ Nova
saída" virou ação secundária "Adicionar saída avulsa", com texto
explicando que as saídas normais vêm da agenda do passeio -- mesma
`createDeparture` por baixo, nenhuma mudança de comportamento.

`tsc --noEmit`/`eslint .` (0 erros)/`next build` limpos. Nenhum teste de
UI ao vivo (sem ferramenta de browser nesta sessão) -- validação por
typecheck/lint/build + leitura do fluxo de dados, que reusa RPCs já
validadas em staging/Production. Detalhes completos em `DOCUMENTACAO.md`
seção 116.
