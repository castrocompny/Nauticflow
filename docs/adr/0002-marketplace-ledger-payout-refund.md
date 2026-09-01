# ADR 0002 — Ledger financeiro, retenção D+1, saque e motor de reembolso

- Status: aceita
- Data: 2026-08-29
- Contexto: Fase 4B (marketplace ToursFlow), depois da Fase 4A (fundação de payments/idempotência de tentativa, `docs/adr/0001-...`)

## Por que NÃO usar Split Asaas imediato

Split imediato repassa o valor do operador no MOMENTO em que o cliente paga.
Isso não é compatível com o modelo desejado: o operador só deveria ter
acesso ao dinheiro depois que o serviço for efetivamente prestado (mesmo
padrão de marketplaces de reserva/hospedagem que retêm o repasse até a
estada/experiência acontecer). Split imediato transferiria o dinheiro antes
de sabermos se o passeio vai mesmo acontecer, tornando qualquer reembolso
posterior uma cobrança de volta do operador (mais difícil, mais atrito) em
vez de simplesmente não liberar um saldo que ainda não tinha saído da
plataforma. Por isso a plataforma retém o valor internamente
(`marketplace_ledger_entries`) e só decide fazer uma transferência de
verdade (saque) depois da retenção D+1.

## Modelo de ledger escolhido — eventos semânticos com bucket explícito

Duas famílias de modelo foram avaliadas:

- **A) Saldo por conta com +/-**: uma única "conta corrente" por operador,
  cada linha só soma ou subtrai do total. Rejeitado: não distingue
  NATURALMENTE entre "bloqueado" e "disponível" sem um campo de estado
  adicional em cada linha, dificultando derivar os 4 saldos exigidos
  (blocked/available/pending_withdrawal/transferred) com uma soma simples.
- **B) Eventos semânticos com bucket** (escolhido): cada linha é um FATO —
  moveu X centavos pro bucket Y, por causa do motivo Z (`entry_type`),
  referente a um pagamento/liberação/saque/reembolso específico
  (`reference_type`/`reference_id`). Os 4 saldos são cada um uma soma
  simples (`SUM(amount_cents) WHERE bucket = X`), sem lógica condicional
  espalhada.

Dentro do modelo B, reclassificar dinheiro entre dois buckets (liberar
blocked→available, mover available→withdrawal_pending, etc.) nunca edita
uma linha existente — insere um **par balanceado** de novas linhas na MESMA
transação (débito de um bucket, crédito de outro, mesmo `entry_type`,
diferenciadas pelo `bucket`). Isso é o que torna o ledger genuinamente
append-only: nenhuma linha é jamais alterada depois de inserida, e o "total
de patrimônio do operador" (soma de todos os buckets, exceto
`platform_revenue`) só muda quando dinheiro de verdade entra
(`operator_blocked`) ou sai (`customer_refund`) — reclassificar nunca altera
esse total, é uma propriedade auditável, verificável a qualquer momento.

`payments` e `marketplace_withdrawals`, por outro lado, **não são
append-only** — são ENTIDADES com ciclo de vida (`pending → paid`, `pending
→ completed/failed`). Essa distinção é deliberada: o ledger registra fatos
financeiros imutáveis; as tabelas de entidade registram o estado ATUAL de
um pagamento/saque específico. Confundir os dois conceitos foi o erro que
este ADR evita.

## Saldos derivados, nunca armazenados

`get_marketplace_operator_balances(company_id)` — `SUM` ao vivo, sem
cache/materialização (não necessário nesta fase; se o volume um dia exigir,
fica para uma migration futura dedicada, não implementado especulativamente
agora).

## D+1 — objetivo, baseado em `service_at_snapshot`, não em `departs_at` ao vivo

Definição escolhida: **exatamente 24 horas corridas depois da hora da
saída** — não "24h depois de quando o operador marcou como encerrada", e não
"próximo dia calendário" (ambíguo por fuso horário e menos previsível).

**Revisão final da Fase 4B (hardening) — por que não usar `departures.
departs_at` ao vivo**: a primeira versão desta fase usava `departs_at`
diretamente na hora de liberar (seção original deste ADR). Isso foi
identificado como uma falha real: `departs_at` é **mutável** — um operador
pode reagendar uma saída livremente (funcionalidade legítima, sem guard,
porque reagendar é uma operação operacional normal) — inclusive depois que
um pagamento já foi confirmado e o dinheiro já está `blocked`. Se a
liberação lesse `departs_at` ao vivo, reagendar a saída pra uma data
qualquer (inclusive pro passado, "backdate") mudaria retroativamente
QUANDO um pagamento já confirmado é elegível pra liberação — a autoridade
financeira ficaria, na prática, nas mãos do próprio operador que recebe o
dinheiro.

**Correção**: `payments.service_at_snapshot` — capturado **uma única vez**,
exclusivamente dentro de `record_marketplace_payment_confirmed`, lido
diretamente de `departures.departs_at` NAQUELE INSTANTE (a saída real da
reserva sendo confirmada). Depois de gravado, nunca é alterado por nenhuma
outra RPC — protegido por um `CHECK`/trigger de imutabilidade (ver seção
"Imutabilidade dos snapshots financeiros" abaixo). Nenhuma API/RPC aceita um
`serviceAt`/`departureAt` vindo de fora como autoridade — o valor é sempre
derivado pelo próprio banco, nunca por um parâmetro de chamada (nem do
ToursFlow, nem de um operador, nem de um futuro webhook do Asaas).
`release_marketplace_reservation_balance` usa exclusivamente
`payments.service_at_snapshot + 24h <= now()` — nunca `departures.
departs_at` ao vivo. Reagendar ou backdatar a saída **depois** da
confirmação do pagamento não tem nenhum efeito sobre quando aquele
pagamento específico é liberado (testado explicitamente — ver seção
"Testes" da revisão final no `DOCUMENTACAO.md`, seção 78).

**O que isso NÃO resolve** (limitação aceita, documentada): se o operador
editar `departs_at` para uma data passada **antes** de qualquer pagamento
ser confirmado para aquela saída, o snapshot capturado na confirmação
seguinte já nasce "backdatado" de boa-fé (o sistema não tem como saber que
aquela é uma data fraudulenta vs. uma correção legítima de agenda). Esse é
um vetor de fraude anterior à cadeia de custódia financeira, fora do escopo
desta correção (que protege a IMUTABILIDADE pós-confirmação, não a
veracidade do dado operacional em si) — seria endereçado por controles
operacionais/antifraude separados, não por este ADR.

## Critério de conclusão — dois sinais, nenhum sozinho confiável

Auditoria do schema existente encontrou `departures.status` já com o valor
`'encerrada'` (migration `0000`, não inventado nesta fase) — mas essa coluna
é editável livremente por qualquer operador da empresa (RLS "própria
empresa", sem guard adicional), com propósito operacional geral, não
financeiro. Usar SÓ esse status como gatilho de liberação seria o "bypass
óbvio" que a auditoria pediu para impedir.

**Critério final, combinando dois sinais independentes**:
1. `departures.status = 'encerrada'` (sinal operacional — alguém confirmou
   que o passeio aconteceu).
2. `departures.departs_at + 24h <= now()` (o relógio real já passou — não
   depende de quando o operador clicou em nada).

Mesmo que o operador marque `'encerrada'` prematuramente (hoje já é
possível, comportamento pré-existente não alterado por esta fase), a
condição 2 ainda bloqueia a liberação até a data real do passeio + 1 dia
terem passado de verdade.

**Quem pode marcar `departures.status = 'encerrada'`**: qualquer membro
autenticado da company (`company_admin`/`staff`) via a RLS "própria empresa"
já existente desde a migration `0000` — não restringido nesta fase, e
deliberadamente não é preciso restringir: o status por si só **nunca**
libera dinheiro (é só um dos dois sinais exigidos), e o relógio imutável
(`service_at_snapshot`, ver seção acima) é o segundo sinal obrigatório,
fora do controle de quem marca o status.

**Limitação conhecida e aceita, reduzida (não eliminada) pela revisão final
da Fase 4B**: como `service_at_snapshot` congela a hora da saída assim que o
pagamento é confirmado, editar `departs_at` DEPOIS desse ponto — pra
qualquer data, passada ou futura — não tem mais nenhum efeito sobre a
liberação daquele pagamento (ver seção "D+1" acima). O vetor que resta é
mais restrito: editar `departs_at` para uma data passada **antes** de
qualquer confirmação de pagamento — nesse caso o snapshot nasceria já
adiantado. Fora do escopo desta correção (que garante imutabilidade
pós-confirmação, não veracidade do dado operacional pré-confirmação);
registrado como pendência de antifraude futura, não resolvido aqui.

**Reservation outcome (completed/no_show/cancelled)**: não existe hoje como
campo confiável a nível de reserva — `reservations.status` só tem
`confirmada/cancelada/pendente` (mistura "reserva ativa" com "resultado do
passeio"); `passengers.status` tem granularidade de PASSAGEIRO individual
(`ausente` = no-show), não de reserva agregada. `calculateRefund()` aceita
`reservationOutcome` como parâmetro (testável), mas **nenhuma coluna
persiste esse outcome ainda** — proposta mínima para o futuro: uma coluna
`reservations.outcome` (ou agregação a partir de `passengers`), não
implementada nesta fase (nenhum refund real acontece ainda de qualquer
forma).

## Motor de reembolso — função pura, sem execução real

`calculateRefund()` (`src/lib/marketplace-ledger.ts`) — entrada:
valor pago, valor do operador (já líquido de comissão), data da partida,
data do cancelamento, **snapshot** da política (nunca a política "atual"),
outcome da reserva, `legalOverride` opcional. Saída: quanto volta pro
cliente, quanto o operador efetivamente fica, quanto da comissão é
ajustado — sempre balanceados (`refund + operatorCompensation +
comissãoRestante = valor pago`, verificado em teste).

**`legalOverride` sempre vence a política comercial** — inclusive quando
`reservationOutcome = 'completed'`. Nenhuma interpretação jurídica está
codificada aqui — o mecanismo existe (um percentual de reembolso que, se
presente, ignora tudo o mais), mas QUEM decide se uma obrigação legal se
aplica e qual o percentual correto é uma decisão externa, tomada por quem
tem autoridade para isso, nunca inferida pelo código.

**No-show não é tratado como "operador fica com 100%" automaticamente** —
usa a mesma tabela de faixas da política (a menos que haja
`legalOverride`), decisão explícita da auditoria: o percentual depende da
política aplicável ao caso, não de uma regra fixa por tipo de desfecho.

**Política de cancelamento**: formato definido (`CancellationPolicy` — lista
de faixas `hoursBeforeDeparture` → `customerRefundPercentBasisPoints`,
ordenadas de forma decrescente e validadas), mas **nenhuma fonte real de
configuração por passeio existe no produto ainda**. `payments.
cancellation_policy_snapshot` (jsonb, nullable) foi adicionado como
preparação estrutural para quando essa fonte existir — fica `NULL` até lá.
Os percentuais usados em teste (48h→100%, 24h→50%, 0h→0%) são **puramente
sintéticos**, nunca documentados como regra comercial oficial.

## Comissão da plataforma

`marketplace_fee_config` — tabela versionada, nunca `UPDATE` (uma nova
comissão é uma linha nova; a vigente é sempre a mais recente por
`created_at`). **Vazia por padrão, nenhum percentual inventado** — enquanto
vazia, `record_marketplace_payment_confirmed()` falha com
`MARKETPLACE_FEE_NOT_CONFIGURED`, nunca assume 0% nem qualquer valor
default. Só `service_role`/`super_admin` podem inserir (mesmo guard de
`asaas_wallet_id`, migration `0052`).

`calculateMarketplaceAmounts()`: arredondamento determinístico — a comissão
é sempre arredondada para BAIXO (`floor`), o valor do operador é sempre o
RESTO (nunca calculado independentemente) — garante por construção que
`platformFee + operatorAmount = gross` sempre, sem exceção de
arredondamento residual perdido.

## Snapshot financeiro do payment

`payments.gross_amount_cents` / `platform_fee_cents` / `operator_amount_cents`
— preenchidos uma única vez, no momento de `record_marketplace_payment_confirmed`
(não no momento da tentativa, `0052` — só sabemos a comissão vigente e
congelamos os valores quando o pagamento é confirmado de verdade). Uma
mudança futura na comissão global nunca afeta vendas já confirmadas —
verificado pelo `CHECK` `payments_amounts_balance_check` (ou os três estão
`NULL`, ou os três estão preenchidos e balanceados).

## Receiver / conta do operador

Sem mudança nesta fase além do já existente (guard da `0052`): operador não
edita `asaas_wallet_id`/`asaas_receiver_status` diretamente — continua
exigindo `service_role`/`super_admin`. `create_marketplace_withdrawal`
recusa (`RECEIVER_NOT_ACTIVE`) se `asaas_receiver_status <> 'active'`.

## Saque — idempotência e concorrência

**Achado real da própria revisão desta fase**: a primeira versão de
`create_marketplace_withdrawal` não tinha proteção de idempotência — um
retry de rede (mesmo pedido de saque reenviado) criaria um SEGUNDO
`withdrawal` distinto, debitando `available` duas vezes. Corrigido com
`idempotency_key` própria (mesmo padrão de toda escrita deste projeto) +
`unique index` parcial.

**Concorrência real** (dois pedidos de saque distintos, não replay, da MESMA
empresa, que juntos excederiam o disponível): protegida por
`pg_advisory_xact_lock(hashtext('marketplace_withdrawal'), hashtext(company_id))`
— serializa TODAS as tentativas da mesma empresa (incluindo replays),
adquirido ANTES até da checagem de idempotência, mesma ordem de
`create_marketplace_booking` (`0042`). Empresas diferentes nunca disputam o
mesmo lock. Isso não é resolvível só desabilitando um botão no frontend — a
proteção real é no banco.

## Concorrência saque × reembolso — mesma trava, mesma chave

**Achado da revisão final da Fase 4B**: a trava de saque acima só protegia
saque contra saque. Um reembolso que deduz de `available` (caso "já
liberado") consome o MESMO saldo compartilhado que um saque — cenário
concreto pedido na revisão: `available = 100000`; um saque reserva `80000`
e, concorrentemente, um reembolso precisa deduzir `50000` — juntos excedem o
saldo. Sem uma trava compartilhada, os dois poderiam ler `100000` (saldo
ainda não decrementado por nenhum dos dois) e ambos prosseguirem, deixando
`available` em `-30000`.

**Correção**: `record_marketplace_refund` adquire a MESMA chave de lock de
`create_marketplace_withdrawal`
(`pg_advisory_xact_lock(hashtext('marketplace_withdrawal'), hashtext(company_id))`)
sempre que precisa tocar `available` (bucket já liberado) — nunca uma chave
separada, por preferência explícita (uma trava por company cobrindo TODA
operação que consome `available`, em vez de uma trava por operação
diferente para cada tipo). Com a trava, a segunda operação a chegar sempre
lê o saldo JÁ atualizado pela primeira e falha corretamente
(`INSUFFICIENT_AVAILABLE_BALANCE` ou `REFUND_EXCEEDS_AVAILABLE_BALANCE`) em
vez de deixar o saldo negativo. Testado explicitamente (simulação
sequencial equivalente à serialização real do lock).

**Trava adicional por reserva** (não pedida explicitamente pelo cenário do
saque, mas necessária pela mesma lógica): `release_marketplace_reservation_
balance` e `record_marketplace_refund` (quando ainda em `blocked`) também
disputam o MESMO saldo bloqueado de uma reserva específica — protegido por
uma segunda chave, `pg_advisory_xact_lock(hashtext('marketplace_reservation_
balance'), hashtext(reservation_id))`, adquirida por ambas as funções.
**Ordem fixa de aquisição em `record_marketplace_refund`** (company primeiro,
depois reserva) para nunca criar uma ordem de lock inversa em relação a
qualquer chamada futura que precise das duas — `release_marketplace_
reservation_balance` só adquire a trava de reserva, nunca a de company, então
não há caminho de deadlock entre as duas funções.

## Reembolso após liberação / após saque

- **Saldo ainda em `blocked`** (não liberado): `record_marketplace_refund`
  deduz diretamente do bucket `blocked`.
- **Saldo já `available`** (liberado, mas ainda não sacado): deduz do bucket
  `available` — detectado automaticamente checando se já existe o par
  `operator_released` para a reserva.
- **Já sacado (`transferred`)**: **não implementado nesta fase** — a função
  não tem lógica para deduzir de um bucket já transferido (deduziria de
  `available`, que pode não ter saldo suficiente, gerando o cenário
  "dívida do operador"). Documentado como pendência explícita, conforme
  pedido — nenhuma cobrança automática da dívida foi implementada ou
  sequer desenhada aqui.

**Revisão final da Fase 4B — nunca permitir saldo negativo em `blocked`/
`available`**: a primeira versão desta função deduzia o valor pedido sem
checar se o bucket de destino realmente comportava aquele valor. Corrigido:
antes de inserir a linha de `customer_refund`, a função calcula o saldo
REAL do bucket relevante (`blocked` remanescente da reserva, via
`reservation_id`; ou `available` da company inteira, via
`get_marketplace_operator_balances`) e recusa (`REFUND_EXCEEDS_BLOCKED_
BALANCE`/`REFUND_EXCEEDS_AVAILABLE_BALANCE`) se a dedução pedida exceder o
que existe — falha fechada, nenhum modelo de dívida/saldo negativo criado
nesta fase.

**Reembolso parcial antes da liberação**: se um reembolso parcial reduz o
`blocked` de uma reserva antes dela ser liberada,
`release_marketplace_reservation_balance` **nunca** reutiliza
`payments.operator_amount_cents` (o valor ORIGINAL da venda, cego a
qualquer reembolso já ocorrido) — em vez disso, soma o que realmente ainda
está em `blocked` para aquela reserva especificamente
(`marketplace_ledger_entries.reservation_id`, coluna adicionada nesta
revisão para permitir esse cálculo sem depender de `reference_id`, que
aponta para ids diferentes conforme o `entry_type`) e libera exatamente
esse remanescente. Testado explicitamente.

## Invariante: um centavo nunca está simultaneamente disponível e reservado para refund

Garantida estruturalmente pelo próprio modelo de buckets: um centavo em
`available` só sai de lá através de um dos dois caminhos exclusivos
(`withdrawal_reserved` ou `customer_refund`), cada um uma linha de ledger
distinta — não existe um terceiro estado "reservado para refund mas ainda
contando como disponível" no schema.

## Chargeback / disputa futura — extensão sem floresta de estados agora

Não implementado. `payments.status` já tem `failed`/`refunded`/
`partially_refunded` — uma disputa futura (`financial_hold`/`dispute`)
pode, quando necessário, ser modelada como MAIS um valor de `status` ou uma
tabela satélite (`payment_disputes`), sem precisar tocar o modelo de ledger
já existente (o ledger é agnóstico ao MOTIVO de uma dedução — só sabe que
um `customer_refund` reduziu X centavos; se o motivo foi disputa ou pedido
espontâneo do cliente é um detalhe de `payments`/uma tabela satélite, não
do ledger). `paid` nunca deve ser tratado como irreversível no código
futuro — este ADR documenta essa premissa explicitamente para quem
implementar a Fase 4C+.

## Idempotência — resumo das camadas

1. **payment → ledger**: `unique(reference_type='payment', reference_id=payment_id, entry_type, bucket)` — replay de `record_marketplace_payment_confirmed` não duplica `operator_blocked`/`platform_fee`.
2. **release**: checagem explícita de replay (existe o par `operator_released`/`available` para a reserva?) ANTES de qualquer cálculo, com fallback defensivo no mesmo `unique(reference_type='release', ...)` — replay não credita `available` duas vezes, e (revisão final) devolve o valor liberado da primeira vez, nunca recalcula um novo remanescente.
3. **refund**: `unique(reference_type='refund', reference_id=refund_id, entry_type='customer_refund', bucket)`, checado explicitamente no início da função — mesmo evento de refund nunca debita duas vezes.
4. **withdrawal (criação)**: `idempotency_key` própria + `unique index` — retry de rede não cria um segundo saque.
5. **withdrawal (conclusão)**: checagem de `status` (`pending`/`processing` apenas) antes de qualquer efeito — replay de `complete_marketplace_withdrawal` é no-op.

## Imutabilidade dos snapshots financeiros — invariante de banco, não só disciplina de código

**Revisão final da Fase 4B**: `gross_amount_cents`, `platform_fee_cents`,
`operator_amount_cents`, `cancellation_policy_snapshot` e
`service_at_snapshot` formam um CONJUNTO — todos gravados juntos, uma única
vez, dentro de `record_marketplace_payment_confirmed`. Antes desta revisão,
a única proteção contra uma mudança posterior era "nenhuma outra RPC escreve
nessas colunas" — verdade hoje, mas não uma garantia de banco. Adicionado
`trg_payments_financial_snapshot_immutable` (trigger `BEFORE UPDATE` em
`payments`): uma vez que `gross_amount_cents` deixa de ser `NULL`, qualquer
tentativa de `UPDATE` que altere qualquer uma das cinco colunas — de
QUALQUER código, presente ou futuro, incluindo um bug em uma RPC nova que
ninguém revisou contra este invariante — é barrada com
`FINANCIAL_SNAPSHOT_IMMUTABLE`. O `CHECK` `payments_amounts_balance_check`
também passou a exigir `service_at_snapshot IS NOT NULL` como parte do
"conjunto completo ou nada", mesmo raciocínio de "todos preenchidos e
balanceados ou todos `NULL`" já usado para gross/fee/operator.

## Taxas do provider — pendência documentada, não resolvida

Este ADR **não assume** que a taxa cobrada pelo Asaas sobre uma cobrança é
automaticamente devolvida em cenário de reembolso — `calculateRefund()`
ajusta a comissão da PLATAFORMA proporcionalmente ao reembolso, mas não
modela nenhum tratamento contábil da taxa do PROVIDER (Asaas cobra uma taxa
fixa/percentual por transação, que pode ou não ser reembolsável dependendo
do tipo de operação). Fica como pendência explícita para quando a
integração real com o Asaas existir (Fase 4C+) — não inventado aqui.

## Segurança

Todas as RPCs desta fase são `SECURITY DEFINER`, `service_role`-only
(`REVOKE` explícito de `public`/`anon`/`authenticated` em cada uma —
lição da Fase 4A/hotfix `0048`: nenhuma delas chama outra função com
contexto de segurança incompatível, todas rodam exclusivamente como
`service_role` de ponta a ponta). `marketplace_ledger_entries` tem uma
trava a mais: nem `service_role` tem `INSERT`/`UPDATE`/`DELETE` direto via
`GRANT` normal — só as RPCs (que rodam como o DONO da tabela via
`SECURITY DEFINER`, que sempre pode escrever independente de `GRANT`)
conseguem gravar, fechando até o caminho "alguém com a chave de serviço
insere uma linha desbalanceada direto, sem passar pelas validações".

## Renumeração das migrations e relação com o hardening de `main`

`0052_fundacao_pagamento_marketplace.sql` (Fase 4A) e
`0053_marketplace_financial_ledger.sql` (Fase 4B) foram renumeradas de
`0049`/`0050` depois de uma colisão real com um trabalho paralelo de
hardening de segurança, commitado direto em `main` usando os mesmos números
`0049`/`0050`/`0051` (ver `DOCUMENTACAO.md`, seções 76-77, para o histórico
completo do incidente e da correção). **`0049_hardening_revoga_bootstrap_
company.sql`, `0050_hardening_revoga_grants_api_rate_limits.sql` e
`0051_hardening_revoga_grants_payments_webhook_events.sql` são migrations
reais, de outro trabalho, já aplicadas em produção** — não fazem parte da
Fase 4A/4B, não devem ser confundidas com fundação/ledger do marketplace, e
não foram e não devem ser editadas por este trabalho. `0052`/`0053` são as
únicas migrations desta fase (fundação + ledger), ambas ainda **não
aplicadas**.

## Pendências explícitas desta fase

- Coluna de `outcome` por reserva (completed/no_show/cancelled) — não existe, proposta mas não implementada. Ausência não é licença para liberar/reembolsar automaticamente — nenhum código desta fase interpreta "outcome desconhecido" como autorização implícita (fail-closed, sem outcome persistido nenhum refund automático real pode rodar de qualquer forma, já que a Fase 4C nem existe).
- Fonte real de política de cancelamento por passeio — não existe, formato definido mas não implementado. Mesma regra de fail-closed: sem `cancellation_policy_snapshot`, `calculateRefund()` não deve ser chamada (o snapshot é obrigatório, nunca um default implícito).
- Refund após saldo já `transferred` (dívida do operador) — comportamento não implementado, documentado como risco conhecido.
- Chargeback/disputa — extensão futura, sem implementação ainda.
- Taxas do provider Asaas em cenário de reembolso — tratamento contábil não definido.
- Vetor de backdate de `departs_at` ANTES da confirmação do pagamento (ver seção "D+1" acima) — fora do escopo desta revisão, que protege a imutabilidade PÓS-confirmação.
- Ativação real de qualquer coisa desta fase depende da Fase 4C (webhook real) e da configuração real da comissão (`marketplace_fee_config`).
