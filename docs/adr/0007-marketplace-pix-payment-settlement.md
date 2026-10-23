# ADR 0007 — Cobrança Pix do cliente, QR Code, webhook e liquidação atômica

- Status: aceita
- Data: 2026-08-31
- Contexto: fecha o fluxo de cobrança do turista, depois de comissão global (`docs/adr/0006-...md`) e saque Pix (`docs/adr/0005-...md`)

## Objetivo desta etapa

Implementar o fluxo completo de cobrança PIX do cliente -- criação/
localização do customer no Asaas, cobrança PIX real, QR Code, webhook de
liquidação, confirmação atômica da reserva e efeito financeiro (comissão
10%/90%) -- **sem ativação financeira em produção**. Migration `0059` (não
aplicada). `MARKETPLACE_PAYMENTS_ENABLED` continua `false` por padrão;
`MARKETPLACE_PAYMENTS_MODE` precisa estar explicitamente configurado
(`mock`/`sandbox`/`production`) pra qualquer chamada de rede acontecer.

## Asaas customer -- nunca confundido com o customer da assinatura SaaS

`companies.asaas_customer_id` (migration `0012`) é o customer do
**operador**, pagando a mensalidade do NauticFlow. `clients.asaas_
customer_id` (novo, `0059`) é o customer do **turista**, comprando um
passeio via ToursFlow -- dois clientes completamente diferentes do Asaas,
nunca reaproveitados um pelo outro. `findOrCreateMarketplaceAsaasCustomer()`
é uma função nova e separada de `findOrCreateCustomer()` (a do SaaS) --
mesmo padrão de nunca misturar os dois modelos de payout já estabelecido
(companies.asaas_wallet_id vs. marketplace_payout_accounts, ADR `0005`).

## CPF/CNPJ obrigatório -- checado antes de qualquer coisa

Asaas exige `cpfCnpj` pra criar um customer. O fluxo de booking do
marketplace permite CPF opcional (`create_marketplace_booking`, `0042`).
Por isso `create_marketplace_payment_attempt` (estendida em `0059`, mesma
assinatura de `0052`) valida CPF/CNPJ com checksum real (reaproveita
`trial_validate_cpf`/`trial_validate_cnpj`, `0045` -- nunca duplica o
algoritmo) **antes de inserir a tentativa de pagamento** -- mesma
disciplina de "checar antes de persistir" do achado da revisão da Fase 4A
(provider desabilitado não podia deixar uma tentativa fantasma pra trás).
Sem isso, uma reserva sem documento válido ocuparia o único slot
`pending`/`paid` (`payments_one_active_per_reservation`) com uma tentativa
que nunca conseguiria virar cobrança real, bloqueando pra sempre uma
tentativa futura já com CPF certo. Erro `CUSTOMER_DOCUMENT_REQUIRED` (422)
-- o ToursFlow precisa coletar o documento do cliente antes de chamar este
endpoint. Nenhum CPF é inventado, nem o do operador nem o da empresa.

## Deduplicação de customer e de cobrança -- reconciliação por externalReference

Timeout depois de `POST /customers` ou `POST /payments` (conexão caiu
antes da resposta chegar) **nunca** deve gerar um segundo `POST`. As duas
funções (`findOrCreateMarketplaceAsaasCustomer`,
`createOrReconcileMarketplacePixCharge`) seguem a mesma estratégia: (1)
reutiliza se já persistido localmente; (2) senão, consulta o Asaas por
`externalReference` (`GET /customers?externalReference=X` /
`GET /payments?externalReference=X`) -- cobre o caso de uma tentativa
anterior ter criado o recurso no Asaas mas caído antes de persistirmos o
id; (3) só então cria. Se a consulta encontrar **mais de um** resultado
(situação ambígua -- não deveria acontecer se este fluxo sempre for usado,
mas nunca se adivinha qual é "o certo"), falha fechado
(`AMBIGUOUS_CUSTOMER_MATCH`/`AMBIGUOUS_PAYMENT_MATCH`), precisa de revisão
manual.

## `POST /v3/payments` -- contrato oficial

`customer`, `billingType: "PIX"`, `value` (reais, conversão só na borda via
`centsToReaisForProvider()`, mesma função já usada e testada no saque --
nunca reaproveitada a divisão direta por 100, protegida contra imprecisão
de ponto flutuante), `dueDate`, `externalReference`. `externalReference` é
**sempre** `payments.id` interno -- nunca `reservation_id` cru, CPF,
e-mail, `company_id` ou chave Pix. Mesmo princípio já estabelecido pro
saque (ADR `0005`, seção 12 do pedido original), agora replicado pro lado
da cobrança.

## `GET /payments/{id}/pixQrCode` -- QR Code

Normalizado pro domínio interno (`payload`, `encodedImage`,
`expirationDate`). **Nunca persistido no banco** -- `encodedImage`
(base64) é recuperado do provider e devolvido direto na resposta ao
ToursFlow, tanto na criação quanto num `GET` de status subsequente (a
chamada é uma leitura idempotente, segura de repetir). Nenhum payload
sensível aparece em log.

## Amount -- sempre do NauticFlow, nunca do ToursFlow

`payments.amount_cents` já vinha de `reservations.total_cents` desde a
Fase 4A (`create_marketplace_payment_attempt` nunca aceitou um valor do
corpo da requisição) -- reconfirmado, não alterado. Conversão pra reais
só na chamada ao provider, nunca em cálculo interno.

## Comissão -- reaproveitada, não reimplementada

`marketplace_fee_config` continua vazia -- `MARKETPLACE_FEE_NOT_CONFIGURED`
bloqueia toda liquidação real até a comissão ser configurada de verdade
via `set_marketplace_global_fee_config` (`0058`, ADR `0006`). Nenhum
fallback de 10% foi hardcoded em lugar nenhum. Quando configurada,
`gross_amount_cents`/`platform_fee_cents`/`operator_amount_cents`/
`fee_basis_points_snapshot` são congelados exatamente como já desenhado
(`0053`/`0057`) -- esta migration não muda essa lógica, só a ORQUESTRA a
partir de um novo ponto de entrada (`settle_marketplace_payment_received`).

## `create_marketplace_payment_attempt` -- reaproveitada, uma tentativa por reserva

`payments_one_active_per_reservation` continua garantindo isso -- nenhuma
mudança de comportamento aqui, só a validação de CPF/CNPJ adicionada antes
do insert (seção acima).

## Idempotência do provider -- reconciliação, nunca criação duplicada

Coberto na seção "Deduplicação" acima -- o mesmo padrão vale tanto pro
customer quanto pra cobrança em si.

## `provider_payment_id` -- nunca aceito do browser/ToursFlow

Persistido via `mark_marketplace_payment_provider_created` (nova,
`service_role`-only) assim que a cobrança é criada/reconciliada -- idempotente
(mesmo valor de novo é no-op; valor diferente do já persistido é rejeitado,
`PROVIDER_PAYMENT_ID_MISMATCH`, sinal de confusão/tampering). O unique
index `payments_provider_payment_id_unique` (já existia desde `0036`)
continua impedindo duplicidade a nível de banco.

## Resposta do checkout -- só o necessário

`POST .../payment` devolve `bookingId` (implícito na URL), `paymentId`,
`status`, `holdExpiresAt` (via o `GET` de status), `totalCents`, `pix`
(`payload`/`encodedImage`/`expirationDate`). **Nunca**: chave da API
Asaas, customer id do provider, CPF, payload bruto do provider, dado
interno da empresa, wallet, dado de `service_role`.

## Hold vs. QR Code -- hold continua sendo a autoridade de exibição

O QR Code pode, tecnicamente, continuar pagável no provider além dos 15
minutos do hold. `hold_expires_at` continua sendo a autoridade de "ainda
vale apresentar este Pix como válido" -- `GET .../bookings/[id]` só
reinclui o campo `pix` na resposta quando `payment.status = 'pending'`
**e** o hold ainda não venceu. Depois do hold vencer, o ToursFlow para de
receber o QR na resposta (mesmo que a cobrança em si ainda exista/seja
technically pagável) -- é assim que o ToursFlow "deixa de apresentar o Pix
como válido", sem precisar cancelar nada no provider agora.

**`cancelMarketplacePendingPayment()` (cancelamento da cobrança pendente
no provider) -- não implementado nesta fase.** Registrado como pendência:
quando existir, precisa consultar o status atual da cobrança antes de
decidir (`DELETE /v3/payments/{id}` só faz sentido pra uma cobrança ainda
não paga -- nunca usado como mecanismo de refund se ela já foi paga
nesse meio tempo).

## Pagamento tardio -- política do ADR `0001` finalmente implementada

Cenário central desta fase: hold vencido, mas o cliente paga a cobrança
antes de qualquer cancelamento acontecer -- `PAYMENT_RECEIVED` chega de
qualquer forma. `settle_marketplace_payment_received` **nunca confirma
cegamente**: revalida capacidade **atomicamente**, dentro da MESMA
transação, através do próprio `trg_reservation_capacity` (migration
`0000`, `BEFORE UPDATE OF status`) -- disparado pelo simples `UPDATE
reservations SET status = 'confirmada'` que a função já precisa fazer,
sem nenhuma checagem TypeScript separada (que teria uma janela de corrida
real). Se a vaga ainda existe: confirma normalmente, efeito financeiro
completo. Se a vaga já foi ocupada por outra reserva nesse meio tempo: o
`UPDATE` levanta `'Capacidade excedida: ...'`, capturado explicitamente --
o pagamento é marcado `paid` (dinheiro real, não inventa que não chegou),
a reserva **nunca** vira `confirmada`, o operador **nunca** recebe
`operator_blocked`, e um `marketplace_refunds` nasce direto em
`manual_review` (`reason_code = 'settlement_exception'`) -- nunca
overbooking, nunca o dinheiro do cliente é perdido ou ignorado. Testado
explicitamente com o cenário de 1 vaga disputada por 2 pagamentos.

## `PAYMENT_CONFIRMED` vs. `PAYMENT_RECEIVED` -- autoridades diferentes

`PAYMENT_CONFIRMED`: sinal operacional só -- persiste `provider_payment_id`
(idempotente), **nunca** cria `operator_blocked`, **nunca** é tratado como
liquidação definitiva. Nenhum estado novo foi inventado em `payments.
status` pra representar isso (continua `pending`) -- "sem inventar estado
desnecessário", pedido explícito desta etapa. `PAYMENT_RECEIVED`: único
gatilho financeiro real, delega inteiramente pra `settle_marketplace_
payment_received`.

## Liquidação atômica -- uma RPC, nunca dois passos separados

`settle_marketplace_payment_received(p_internal_payment_id,
p_provider_payment_id, p_confirmed_amount_cents)` garante, dentro da MESMA
transação: payment ainda elegível (`pending`, não já finalizado);
`provider_payment_id` bate com o que já era conhecido; `amount` recebido
bate com o esperado; reserva ainda confirmável (`pendente`); capacidade
real (via o trigger já existente); e só então delega o efeito financeiro
(`gross`/`fee`/`operator`/snapshot/ledger) pra `record_marketplace_
payment_confirmed` (`0053`/`0055`/`0057`) -- **nunca duplicado aqui**, uma
única fonte de verdade pra essa lógica. No caminho normal (reserva
confirmada), nunca existe um estado intermediário onde `payment = paid` mas
o ledger está faltando, ou onde o ledger foi criado mas a reserva não foi
confirmada -- tudo dentro da MESMA transação Postgres, tudo ou nada.

> **Qualificação (2026-10-20):** `paid` sem crédito ao operador existe por
> desenho nas exceções legadas da `0059`: reserva não confirmável e
> capacidade perdida marcam o payment `paid` (o dinheiro chegou), **não**
> chamam `record_marketplace_payment_confirmed` -- nenhum `operator_blocked`
> é lançado -- e abrem um `marketplace_refunds` em `manual_review`. Esse
> estado é durável e intencional (aguarda reconciliação humana), não um
> intermediário de transação. Quem ler `payments.status = 'paid'` não pode
> presumir ledger do operador sem checar esse `manual_review`.

## Verificação de amount -- diferença nunca confirma nem credita

Se `p_confirmed_amount_cents` (valor que o Asaas diz ter recebido)
diverge de `payments.amount_cents` (valor esperado, travado desde a
criação da tentativa): **nunca** confirma a reserva, **nunca** credita o
ledger. `payment.status` permanece `pending` (identidade do dinheiro
incerta até reconciliação humana) -- só o `provider_payment_id` é
persistido, e um `marketplace_refunds` em `manual_review` registra a
divergência (`reason_code = 'settlement_exception'`). Nenhum PII no
evento de segurança associado.

## Replay -- idempotente em todas as frentes

`settle_marketplace_payment_received` chamado duas vezes pro mesmo
pagamento: a segunda chamada encontra `payment.status = 'paid'` logo no
início e devolve o resultado já calculado, **sem** reconfirmar a reserva,
**sem** recriar `platform_fee`/`operator_blocked` -- testado explicitamente
(o contador de ocupação da saída não muda na segunda chamada).

## `PAYMENT_REFUND_IN_PROGRESS`/`PAYMENT_REFUNDED`/`PAYMENT_PARTIALLY_REFUNDED`

Integrados só até o contrato interno seguro nesta fase -- **nenhum
provider refund real está ativado** (`create_marketplace_refund_request`,
`0055`, só reserva o efeito internamente; nenhum caminho de produção chama
um estorno de verdade no Asaas ainda). O webhook **nunca ignora
silenciosamente** esses 3 eventos -- deduplicados (mesma idempotência por
evento) e logados (`marketplace_payment_refund_event_received`) pra
observabilidade. Correlacionar automaticamente com um `marketplace_
refunds` específico fica pra quando a integração de estorno real existir
-- decisão explícita de não inventar essa lógica sem um caminho real de
refund pra testar contra.

> **Atualização (migration `0060`)**: a correlação automática acima JÁ
> existe -- `reconcile_marketplace_refund_webhook_event` (0060) é o ponto
> único de entrada pros 4 eventos de refund. Ver seção "Fechamento" mais
> abaixo.
>
> **Atualização (migration `0061`)**: **o provider refund real agora está
> ativado.** `initiateMarketplacePaymentRefund()` (`src/lib/asaas.ts`)
> chama `POST /v3/payments/{id}/refund` de verdade, acionável só por
> `super_admin` via `initiateRealMarketplaceRefund()`
> (`src/app/(app)/reservas/[id]/refund-provider-actions.ts`). Sem campo de
> idempotência/externalReference no contrato oficial de refund (diferente
> de customer/payment) -- a estratégia de idempotência é checar `GET
> /payments/{id}` antes de criar: qualquer refund já existente ali recusa
> com `AMBIGUOUS_EXISTING_REFUND`, nunca cria um segundo às cegas.
> `mark_marketplace_refund_processing` (0061, `service_role`-only) persiste
> `provider_refund_id` assim que o POST responde com sucesso -- **nunca
> marca `completed`**, o webhook continua sendo a única autoridade. Migration
> `0061` local, não aplicada em produção ainda.

## Webhook -- três fluxos independentes, nenhum quebrado

`src/app/api/webhooks/asaas/route.ts` agora trata três famílias de evento:
assinatura SaaS (`payment` + `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`,
intocado), transferência/saque (`transfer`, ADR `0005`, intocado) e agora
cobrança do marketplace (`payment` + os mesmos + os 3 de refund). Os
nomes de evento de pagamento (`PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`) são
**idênticos** entre o fluxo SaaS e o marketplace -- Asaas não distingue
"tipo" de pagamento no nome do evento. A distinção nunca é pelo nome do
evento: é por `payment.externalReference` corresponder a uma linha REAL
em `public.payments` (marketplace) ou não (cai pro fluxo SaaS, que trata
`externalReference` como `company_id`) -- verificado com uma consulta
explícita antes de decidir qual caminho seguir, nunca assumido.

## Idempotência do webhook -- por EVENTO, mesmo achado da revisão do saque

Mesma lição já aplicada ao webhook de transferência (ADR `0005`): `event_
key` é `body.id` (o id do EVENTO em si) quando presente, com fallback pra
`${event}:${payment.id}` (`perEventKey` em `route.ts`) -- nunca `payment.id`
isolado. Deduplicar só por `(event_type, payment.id)` travaria
`PAYMENT_CONFIRMED` seguido de `PAYMENT_RECEIVED` -- dois eventos
legítimos e DIFERENTES da mesma cobrança -- um contra o outro. Testado:
`CONFIRMED` depois `RECEIVED` processa os dois normalmente; o mesmo
evento reenviado é deduplicado.

## `MARKETPLACE_PAYMENTS_MODE` -- mock/sandbox/production, fail closed

Ausente ou valor desconhecido = `null` = recusa (nunca assume um modo
default, muito menos `production`). `mock`: nenhuma chamada de rede,
dados determinísticos sintéticos -- usado pra testar o fluxo de ponta a
ponta sem depender de `ASAAS_API_KEY`. `sandbox`/`production`: chamada
real via `asaasFetch`, com uma cross-validação nova contra `ASAAS_API_URL`
-- `mode=production` com uma URL de sandbox (ou vice-versa) é uma
configuração inconsistente, **recusada**, nunca corrigida silenciosamente
escolhendo um dos dois. Não foi feito nenhum teste real (sandbox ou
produção) nesta sessão -- sem credencial disponível, sem pedir chave/token
ao usuário pelo chat (instrução explícita) -- só mock, testado.

## Segurança -- PII nunca em log

Nenhum log (`console.error`, `logSecurityEvent`) carrega CPF, e-mail,
telefone, payload Pix, `encodedImage`, payload bruto do customer/payment
do provider, `Authorization`, chave Asaas. `logSecurityEvent` nos novos
eventos (`marketplace_payment_settlement_error`, `marketplace_payment_
webhook_missing_value`, `marketplace_payment_refund_event_received`)
carrega só `paymentId` (id interno, não sensível) e, no caso de erro,
uma mensagem de erro truncada (64 chars) -- nunca o payload inteiro.

## Fechamento -- cancelamento de cobrança pending + correlação de refund (migration `0060`)

Rodada de fechamento posterior a esta ADR: as duas pendências centrais
("`cancelMarketplacePendingPayment()` não implementado" e "correlação
automática de refund não implementada") foram fechadas.

### `DELETE /v3/payments/{id}` -- nunca tratado como refund

`cancelMarketplacePendingPayment()` (`src/lib/asaas.ts`) segue o contrato
oficial: **consulta o status atual da cobrança ANTES de deletar**
(`GET /payments/{id}`) -- só um status `PENDING` confirmado é tratado como
removível nesta fase (qualquer outro valor, incluindo estados que talvez
fossem tecnicamente removíveis mas cujo nome exato não foi confirmado
contra a documentação ao vivo -- mesma categoria de pendência já registrada
pro payload de PHONE/eventos de transfer -- é tratado como NÃO removível,
fail safe). Se o `DELETE` em si falhar por qualquer motivo, **nunca assume
cancelado** -- devolve `cancelled: false`, nunca finge um resultado que não
aconteceu.

### Race com `PAYMENT_RECEIVED` -- resolvida em duas camadas

1. **TS**: `cancelMarketplacePendingPayment` consulta o status no provider
   antes de deletar -- se o provider já diz `RECEIVED`/qualquer coisa
   diferente de `PENDING`, a função recusa deletar.
2. **SQL** (a proteção REAL, que não depende de nenhuma condição de corrida
   de rede): `cancel_marketplace_pending_payment` (`0060`) só marca
   `payments.status = 'failed'` via `UPDATE ... WHERE status = 'pending'`
   -- atomicidade do Postgres garante que, se `settle_marketplace_payment_
   received` (`0059`) venceu a corrida e já mudou o status pra `'paid'`
   antes deste `UPDATE` executar, a linha simplesmente não casa (0 linhas
   afetadas) -- o status final devolvido reflete a REALIDADE (`paid`),
   **nunca** um cancelamento fantasma por cima de um pagamento recebido.
   Testado simulando a corrida nos dois sentidos de forma **sequencial**
   (uma chamada depois da outra, na mesma sessão) -- isso cobre a ordem dos
   efeitos, não a execução concorrente com sessões simultâneas, que não foi
   testada.

### Status interno de cobrança cancelada -- reusa `'failed'`, nenhum estado novo

Auditado antes de inventar: `payments.status` já tinha `failed` desde a
migration `0036` -- semanticamente já cobre "esta tentativa nunca virou
uma cobrança paga". Nenhuma coluna nova, nenhum valor de enum novo.

### Nova tentativa após hold expirado

Uma vez cancelada (`failed`), `payments_one_active_per_reservation`
(`0052`) libera o slot pra uma NOVA tentativa -- mas `create_marketplace_
payment_attempt` continua exigindo `hold_expires_at` futuro de verdade da
RESERVA (não muda por causa do cancelamento do payment antigo) -- **nunca
ressuscita o hold vencido**. `POST .../payment` foi estendido pra tentar
o cleanup automaticamente quando `PAYMENT_ALREADY_ACTIVE` é causado por
uma tentativa velha com hold vencido, e re-tentar a criação UMA vez (nunca
um loop) -- se a reserva ainda não tiver um hold novo, a nova tentativa
ainda falha corretamente com `HOLD_EXPIRED`, exigindo um booking/hold
genuinamente novo (nunca um "reaproveitamento automático").

### `PAYMENT_DELETED` -- reconciliação, nunca refund/ledger

Reconhecido no webhook, reconcilia via a **mesma** RPC do cleanup lazy
(`cancel_marketplace_pending_payment`) -- um único caminho de cancelamento
interno, nunca dois. Como uma cobrança que nunca foi paga não tem nada pra
estornar, nenhum `marketplace_refunds`/ledger é criado por este evento.

### Correlação de refund -- por identificador, nunca por texto/reason

`reconcile_marketplace_refund_webhook_event` (`0060`) é o ponto único de
entrada pros 4 eventos (`PAYMENT_REFUND_IN_PROGRESS`/`PAYMENT_REFUNDED`/
`PAYMENT_PARTIALLY_REFUNDED`/`PAYMENT_REFUND_DENIED`). Correlação em duas
camadas: (1) `provider_refund_id` já conhecido (evento posterior do MESMO
refund); (2) exatamente UM pedido nosso em aberto (`pending`/`processing`)
pra aquele `payment_id`, quando (1) não resolve. **Nunca decide por
texto/reason** vindo do payload.

- `PAYMENT_REFUND_IN_PROGRESS`: NÃO considera dinheiro devolvido -- o
  ledger que já reservou o refund (`create_marketplace_refund_request`,
  `0055`) continua intocado em `refund_pending`; só avança o status da
  ENTIDADE.
- `PAYMENT_REFUNDED`/`PAYMENT_PARTIALLY_REFUNDED`: **nunca confia
  cegamente no valor do webhook** -- valida contra `customer_refund_cents`
  já calculado na criação do pedido; diferença -> nunca finaliza, cai pra
  `manual_review`. Valor batendo -> `complete_marketplace_refund_request`
  (`0055`, reaproveitada via chamada interna, nunca duplicada).
- `PAYMENT_REFUND_DENIED`: `complete_marketplace_refund_request(...,
  succeeded=false, ...)` -- devolve o valor reservado pro bucket de
  origem, nunca deixa dinheiro preso em `refund_pending` indefinidamente.

### Refund desconhecido -- nunca inventa, sempre `manual_review`

Sem correlação confiável (0 candidatos, OU mais de um candidato ambíguo)
-- uma nova linha `marketplace_refunds` nasce direto em `manual_review`
(`reason_code = 'settlement_exception'`, mesmo valor já usado pras
exceções de settlement), **sem nenhum efeito de ledger**. Idempotente por
`(payment_id, provider_refund_id ou event_type)` -- reenvio do mesmo
evento não duplica a linha.

**Limitação conhecida e aceita**: dois pedidos de refund abertos
SIMULTANEAMENTE para o MESMO `payment_id`, sem `provider_refund_id` já
conhecido em nenhum dos dois, são genuinamente ambíguos pra correlacionar
-- a função nunca adivinha qual dos dois corresponde a qual evento, cai
pra `manual_review` (mesmo espírito de `AMBIGUOUS_CUSTOMER_MATCH`/
`AMBIGUOUS_PAYMENT_MATCH`, seção acima). Testado explicitamente. Não
corrigido com heurística (ex: correlacionar por valor) de propósito --
correlacionar por valor teria o mesmo problema se dois refunds tivessem o
mesmo valor, e o pedido original foi explícito: nunca correlacionar por
texto/reason nem por adivinhação.

### Refund × withdrawal -- reconfirmado, nenhuma trava nova necessária

`complete_marketplace_refund_request` só move dinheiro JÁ reservado em
`refund_pending` (pra "fora do sistema" no sucesso, ou de volta pro bucket
de origem na falha) -- **nunca** lê/decide com base no saldo `available`
AO VIVO da empresa (essa checagem já aconteceu, uma vez, na CRIAÇÃO do
pedido, `create_marketplace_refund_request`, sob a trava compartilhada com
saque já existente desde `0055`). Como não há uma leitura-e-decisão sobre
saldo compartilhado acontecendo na finalização, não existe uma nova janela
de corrida pra proteger -- reconfirmado com teste, nenhuma trava nova
adicionada.

### Segurança -- novos eventos, mesma disciplina

`payment_cleanup_failed`, `payment_cleanup_deferred`, `refund_
reconciliation_required` -- todos carregam só `paymentId`/`eventType`/
`providerStatus` (identificadores/enums de baixa cardinalidade), nunca
CPF, e-mail, telefone, payload Pix, payload bruto do provider, chave de
API. Testado estruturalmente.

## Pendências explícitas desta fase

- Teste real em sandbox -- não executado (sem credencial disponível nesta sessão).
- Resolução de pedidos em `manual_review` (herdado do ADR `0004`) -- ainda sem mecanismo (UI/RPC dedicada), agora com mais gatilhos possíveis (settlement exceptions, refunds desconhecidos ou ambíguos).
- Correlação de dois refunds simultaneamente abertos para o mesmo payment sem `provider_refund_id` prévio -- limitação conhecida e aceita, cai pra `manual_review` (ver seção acima), nenhuma heurística de desambiguação implementada de propósito.
- Cron real pra cleanup de cobranças pending -- não criado (infraestrutura de cron complexa fora de escopo); `attemptMarketplacePaymentCleanup` já está pronta pra ser o corpo de um cron futuro, chamada hoje só de forma lazy (status endpoint + retry do payment endpoint).
- Comissão global (10%) continua não configurada em produção -- nenhuma liquidação real é possível até `set_marketplace_global_fee_config` ser chamada de verdade (ADR `0006`).
- ToursFlow não foi alterado -- fora de escopo desta etapa, conforme instrução explícita.

## Atualização (migration `0061`) -- provider refund real ativado

Ver nota inline na seção `PAYMENT_REFUND_IN_PROGRESS`/`PAYMENT_REFUNDED`/`PAYMENT_PARTIALLY_REFUNDED` acima. Pendências que continuam de pé mesmo com o adapter pronto: migration `0061` não aplicada em produção; `MARKETPLACE_PAYMENTS_ENABLED` continua desligado, então nenhum reembolso real pode acontecer ainda (nada pra reembolsar); teste real contra o Asaas Produção (auth + refund controlado) segue pendente pelo mesmo motivo estrutural desta sessão (extração de segredo de produção bloqueada, ver `DOCUMENTACAO.md` seção 96) -- só testável quando um pagamento real existir.

## Atualização (migration `0062`) -- hotfix de rollback em mark_marketplace_refund_processing

Achado em revisão antes de `0061` ir pra produção: o ramo de `provider_refund_id` divergente fazia `UPDATE` seguido de `RAISE EXCEPTION` na mesma chamada -- a exception reverte o `UPDATE` junto (transação por request do PostgREST), então o `manual_review` nunca era persistido de verdade. Corrigido via `RETURN` normal em vez de exception (mesma transação de sucesso). Server action também endurecido -- passa a validar `data`/`error` da RPC de verdade (`interpretMarkProcessingResult()`, `src/lib/marketplace-refund-reconciliation.ts`), nunca reporta `processing` sem confirmação explícita. `0061` não foi alterada; `0062` é uma `create or replace function` nova. Ver `DOCUMENTACAO.md` seção 98 para os detalhes completos e os testes.

## Atualização (2026-09-08) -- 0061/0062 aplicadas em produção

Ambas aplicadas manualmente via Supabase Dashboard → SQL Editor (conectividade do CLI indisponível). RPCs, `SECURITY DEFINER` e ACL `service_role`-only confirmados ao vivo; versão final de `mark_marketplace_refund_processing` é a corrigida (0062), não a com o bug de rollback. Reembolso real controlado está pronto no banco -- falta só `MARKETPLACE_PAYMENTS_ENABLED` (ainda OFF) e um pagamento real existir. Detalhes completos em `DOCUMENTACAO.md` seção 99.

## Atualização (2026-10-19) -- PAYMENT_RECEIVED atômico com a marca do webhook (migration `0081`, local)

A rota `src/app/api/webhooks/asaas/route.ts` passa o evento marketplace `PAYMENT_RECEIVED` para `settle_marketplace_payment_received_once` (`0081`). Essa RPC registra/reaproveita a chave `(provider, event_key)` na tabela dedicada `marketplace_processed_webhook_events`, separada de `processed_webhook_events` compartilhada pelo SaaS, e chama `settle_marketplace_payment_received` (`0059`) na mesma transação. Se a liquidação falhar, a transação desfaz uma marca recém-inserida e a rota responde HTTP 500 para permitir retry; marcadores legados na tabela compartilhada não suprimem a reconciliação, que continua idempotente. A validação do status/valor no Asaas permanece antes da RPC; a lógica financeira continua na função existente `0059`. Nenhum outro evento, o fluxo SaaS (`0079`), transferência ou refund foi alterado. ACL da tabela nova: RLS ligado sem policies; tudo revogado de `PUBLIC`, `anon`, `authenticated` e `service_role`, depois só `INSERT (provider, event_type, event_key)` + `SELECT (provider, event_key)` para `service_role` -- o `SELECT` nas colunas do `conflict_target` é exigido pelo `INSERT ... ON CONFLICT (provider, event_key) DO NOTHING` da RPC `SECURITY INVOKER`. `EXECUTE` da RPC só para `service_role`. Como a RPC é `SECURITY INVOKER` e trava `payments` com `FOR UPDATE`, a `0081` também concede a `service_role` só `SELECT (id)` e `UPDATE (updated_at)` em `payments` -- `FOR UPDATE` exige `UPDATE` em uma coluna qualquer; `id` foi descartado por ser a identidade do pagamento (o ledger o referencia por `reference_id` sem FK), e escrever em `updated_at` não tem efeito próprio porque `trg_payments_updated_at` (`0036`) o sobrescreve com `now()`. `BYPASSRLS` não substitui grants: num banco limpo do Supabase local o `service_role` não tem SELECT/UPDATE em `payments` (`permission denied for table payments` sem estes grants, coberto por `supabase/tests/database/marketplace_payment_received_once.test.sql`). A `0051` registra que em produção, na época, o `service_role` mantinha todos os privilégios; a origem dessa diferença não foi esclarecida, o estado de produção não foi verificado, e `GRANT` é aditivo -- a `0081` não reduz privilégios preexistentes. Antes da marca, a RPC trava a linha de `payments` (`SELECT ... FOR UPDATE` pelo id interno) até o fim da transação: liquidações do mesmo pagamento com chaves de evento diferentes (ex.: `body.id` e o fallback `PAYMENT_RECEIVED:<payment.id>`) passam a ser serializadas, e a segunda vê `paid` e devolve replay em vez de abrir um `manual_review` falso (`settlement-reservation-not-confirmable`). O `cancel_marketplace_pending_payment` (`0060`) também passa a esperar essa trava. A `0059` não foi reescrita. **Corrida de cancelamento (estado na `0081`; tratada depois pela `0082`, ver a atualização seguinte):** se o cancelamento commitar primeiro (payment `failed`) e o Asaas depois confirmar `RECEIVED`, a `0059` levanta `PAYMENT_NOT_PENDING`, a marca é desfeita, a rota responde 500 e o reenvio não muda o estado -- nenhum `manual_review` é criado. A seção "Race com `PAYMENT_RECEIVED` -- resolvida em duas camadas" acima cobre só o sentido "liquidação vence"; a política para o sentido inverso aguarda decisão.

**Estado e limites (2026-10-19):** `0081` é somente local nesta branch; não foi aplicada em staging nem em produção. Num projeto Supabase local isolado, as migrations foram aplicadas do zero pelo CLI (incluindo a `0081`) e o pgTAP passou (`supabase/tests/database/*.test.sql`). *Qualificação (2026-10-20):* foi reportado que o CLI ignorou `0000b_bootstrap_existing_signup.sql` e `0000c_confirm_existing_email.sql` (nomes fora do padrão de versão); não há evidência de que esse banco seja equivalente a uma instalação completa nem ao histórico de produção. O pgTAP cobre ACL, `SECURITY INVOKER`/`search_path`, a autorização da trava e o rollback da marca no caso de pagamento inexistente; não cobre caminho feliz, replay, `marker_reused` nem falha depois de efeitos em reserva/ledger. Os testes Vitest da rota usam mocks: cobrem erro → 500 e a chamada da RPC, não a transação real. A serialização com sessões concorrentes e a ausência de deadlock **não foram validadas**; os privilégios efetivos de produção também não. Não implantar a rota sem aplicar e validar a migration na etapa autorizada; este trabalho não comprova produção nem prontidão para lançamento.

## Atualização (2026-10-20) -- PAYMENT_RECEIVED para payment local `failed`: fila de exceções de pagamento (migration `0082`, local)

> **Data corrigida:** esta decisão é de 20/10/2026. O comentário de cabeçalho da `0082` registra `2026-10-19`; a migration não foi reescrita (já aplicada em banco local preservado) -- a correção fica aqui e no cabeçalho da `0083`.

**Decisão (autorizada pelo dono do produto):** quando o Asaas já foi verificado como `RECEIVED` (`verifyAsaasPaymentSettled`, inalterado) e o payment local está `failed` (hold expirado cancelado pela `0060`), o webhook registra uma **exceção de pagamento** em `marketplace_payment_exceptions`, na mesma transação da marca do evento, e só então responde **HTTP 200** (`{ ok: true, paymentException: true }`, mais o evento de segurança `marketplace_payment_exception_recorded`). Isso fecha, para esse sentido, a corrida de cancelamento descrita acima: antes o caso era 500 em loop sem registro durável.

**Garantias (pgTAP `supabase/tests/database/marketplace_payment_exceptions.test.sql`, banco local recriado pelo CLI -- mesma ressalva acima sobre `0000b`/`0000c` ignoradas; as chamadas do teste são sequenciais, numa única sessão):**
- Nenhum efeito financeiro: `payments.status` continua `failed`; reserva intocada; nenhum `marketplace_ledger_entries`; nenhum `marketplace_refunds` (que é pedido de reembolso e, em `manual_review`, bloquearia todos os saques da empresa -- `0056`); nenhuma chamada ao provider. Uma segunda tentativa `pending` da mesma reserva fica intacta.
- Um caso por `(payment_id, reason_code)`, nunca por id do evento: chaves de evento diferentes e replays reutilizam o mesmo caso (`occurrences`, `last_seen_at`, trilha `replayed`); cada chave tem a sua marca.
- Só o erro exato `PAYMENT_NOT_PENDING` da `0059` é tratado, e a gravação revalida que o payment está `failed`. Outros status, `PROVIDER_PAYMENT_ID_MISMATCH` e dados divergentes de um caso já existente (`PAYMENT_EXCEPTION_CONFLICT`) continuam erro: a rota responde 500 e nenhuma marca nova ou ocorrência fica gravada.
- Caso encerrado nunca é reaberto nem tem o encerramento apagado (trigger, inclusive para o dono do banco); a trilha `marketplace_payment_exception_audit` é append-only.

**Fila administrativa:** `/admin/excecoes-pagamento`, só `super_admin` com aal2 (`requireSuperAdminPage`/`requireSuperAdminAction`, e de novo dentro das RPCs `list_marketplace_payment_exceptions`/`resolve_marketplace_payment_exception`, `SECURITY DEFINER`, `search_path` vazio). As tabelas têm RLS sem policies e nenhum privilégio direto para `anon`/`authenticated`/`service_role`. A gravação (`record_marketplace_payment_exception_after_failed`) é `service_role`-only. A trilha registra criação, reocorrências, cada consulta à fila (`queue_viewed`) e o encerramento; o encerramento também vai para `admin_audit_log`. Encerrar exige nota de reconciliação (10 a 2000 caracteres) e é **só operacional**: não altera payment, reserva, ledger, saldo nem refund, e não chama o Asaas. A tela diz isso explicitamente. Operador (`company_admin`/staff) não tem acesso.

**Migration:** `0082` nova, em vez de editar a `0081`. O wrapper `settle_marketplace_payment_received_once` é recriado (`drop` + `create`) porque o retorno ganha `payment_exception_id`; ACL reafirmada (`EXECUTE` só `service_role`, `SECURITY INVOKER`).

**Fora do escopo e limites:**
- Os `manual_review` que a `0059` já cria em `marketplace_refunds` (valor divergente, reserva não confirmável, capacidade perdida) **não** migram para esta fila e continuam sem tela de resolução; não foram tocados nem validados nesta etapa.
- Ordem de travas no caminho novo: `payments` (`FOR UPDATE`, wrapper) → marca → exceção (FK para `payments`/`companies`/`reservations`, `FOR KEY SHARE`). A `0060` só faz `UPDATE` em `payments`. Pela leitura, não há inversão, mas concorrência e ausência de deadlock **não foram validadas** com sessões simultâneas.
- A cobrança recebida no Asaas continua sem devolução automática: a reconciliação (devolver ao cliente, reemitir reserva etc.) é manual e fora do sistema.
- `0082` é só local: não aplicada em staging nem produção; Asaas real, produção e operação financeira não foram testados.

## Atualização (2026-10-20) -- fila paginada (`0083`) e validação do retorno da RPC na rota (local)

**Fila administrativa (`0083`, aditiva; `0082` não editada):** `list_marketplace_payment_exceptions_page(p_status, p_limit, p_after_status, p_after_created_at, p_after_id)` substitui a listagem da `0082`, que cortava em 500 casos sem paginação nem aviso e não definia ordem para `created_at` empatado. Paginação keyset sobre a ordem total `(status, created_at desc, id desc)`, com índice próprio; o cursor é a última linha da página (os três campos ou nenhum, senão `INVALID_CURSOR`); `p_limit` de 1 a 101 (`INVALID_LIMIT`). A tela `/admin/excecoes-pagamento` pede 50 + 1, mostra "Próxima página"/"Primeira página" e diz quantos casos exibe e se há mais. Autorização, RLS e trilha inalteradas: `SECURITY DEFINER`, `search_path` vazio, `is_super_admin()` + aal2 dentro da RPC, `EXECUTE` só `authenticated`, cada página grava `queue_viewed`. Continua só operacional. A função antiga perde o `EXECUTE` de `authenticated` (não é removida). pgTAP novo: `supabase/tests/database/marketplace_payment_exceptions_page.test.sql` (empate de `created_at` atravessando a fronteira de página, sem omissão nem repetição); o teste da `0082` passou a chamar a função paginada.

**Retorno da RPC em `PAYMENT_RECEIVED` (`route.ts`):** ausência de erro não basta para responder 200. `parseSettlementResult` só aceita exatamente uma linha do mesmo `payment_id`, com `is_replay`/`requires_manual_review`/`marker_reused` booleanos, e um destes estados: liquidação normal ou replay (`paid`, sem exceção); valor divergente da `0059` (`pending` + `requires_manual_review`, sem exceção); exceção durável da `0082` (`failed` + `requires_manual_review` + `payment_exception_id` uuid). Qualquer outra coisa (data nula, vazia, não-array, várias linhas, outro pagamento, status desconhecido, flags não booleanas, exceção incoerente com o status) responde **500** `settlement_unconfirmed` e loga `marketplace_payment_settlement_unconfirmed`, para o Asaas reenviar. A semântica financeira não mudou (nenhuma RPC, migration financeira ou estado foi alterado).

**Pendência P1 (não resolvida, bloqueia integração):** nos ramos de transferência, `PAYMENT_CONFIRMED`, `PAYMENT_DELETED` e refunds, a rota grava a marca em `processed_webhook_events` **antes** da RPC de efeito e ignora ou só loga o erro dela, respondendo 200. Se o efeito falhar, o evento fica marcado e o reenvio é descartado como duplicado. Trocar só para 500 não resolve: o retry bate na marca já gravada. Correção prevista em etapa separada: marca e efeito na mesma transação (uma RPC por ramo, como a `0081` fez para `PAYMENT_RECEIVED`), com testes de falha/rollback e retry.

**Limites desta etapa:** `0083` não foi aplicada em nenhum banco nesta sessão (Docker indisponível) -- o pgTAP novo e o ajuste do teste da `0082` **não foram executados**. Sem teste de concorrência real com sessões simultâneas, sem `npm run build`, sem validação da tela no navegador, sem staging/produção nem Asaas real.

## Atualização (2026-10-20, revisão Codex) -- cursor imutável da fila (`0084`) e UUID canônico na rota (local)

**Correção da `0083` (aditiva, `0083` não editada):** a ordem `(status, created_at desc, id desc)` da `0083` usava um campo mutável. No filtro "Todos", um caso visto como `open` e encerrado durante a navegação passava a satisfazer `status > cursor.status` e reaparecia na seção `resolved`. A garantia "sem omissão nem repetição" da atualização anterior **só valia com dados estáveis**. A `0084` remove a função da `0083` (a assinatura muda, sai `p_after_status`, e duas versões gerariam sobrecarga ambígua no PostgREST) e recria `list_marketplace_payment_exceptions_page(p_status, p_limit, p_after_created_at, p_after_id)` com ordem e cursor só em `(created_at desc, id desc)`. Os dois são imutáveis (`trg_marketplace_payment_exception_guard`, `0082`) e o par é único. Índice novo `(created_at desc, id desc)`; o da `0083` continua servindo os filtros por status. Por que não editar a `0083`: com Docker indisponível, não foi possível conferir se ela já tinha sido aplicada num banco local preservado.

**Comportamento com dados mudando durante a navegação (não é snapshot):** cada página mostra o estado atual. Um caso já alcançado pelo cursor nunca volta numa página seguinte. Em "Abertos", um caso encerrado antes de ser alcançado deixa de aparecer. Em "Encerrados", um caso encerrado mais adiante na ordem aparece quando a navegação chega nele; um caso encerrado antes do ponto do cursor só aparece recomeçando da primeira página. Casos novos só aparecem na primeira página. A tela informa isso. O cursor da URL foi para `src/lib/payment-exception-queue.ts`, com teste Vitest; um `after_status` antigo é ignorado.

**Regressão pgTAP** (`marketplace_payment_exceptions_page.test.sql`, reescrito): busca a página 1 de "Todos", encerra pela RPC real um caso já visto, continua e verifica que ele não reaparece e que nada é omitido; cobre também "Abertos" com encerramento de caso ainda não alcançado. O teste da `0082` foi ajustado para a nova assinatura. **Nenhum dos dois foi executado** (Docker indisponível).

**`parseSettlementResult`:** o `payment_id` devolvido pela RPC é comparado em forma canônica (minúsculas). Antes, um `externalReference` em maiúsculas, aceito por `UUID_RE`, fazia uma liquidação persistida responder 500 `settlement_unconfirmed`. Teste novo cobre esse caso e o resultado `paid` + `requires_manual_review` da `0059`.

**P1 continua aberto e bloqueia a integração.** Confirmado estaticamente também que o fechamento de refund por webhook falha: `reconcile_marketplace_refund_webhook_event` (`0060`) chama `complete_marketplace_refund_request` (`0055`), que exige perfil de `auth.uid()` e levanta `SESSION_INVALID` com `service_role` sem usuário. A rota só loga, e a marca gravada antes impede o reenvio. Não há pgTAP cobrindo esse caminho. Correção pendente de autorização em etapa separada.

## Atualização (2026-10-20) -- P1: marca + efeito atômicos nos demais ramos do webhook (`0085`, local)

**Achado prévio, verificado em execução:** no Supabase local isolado (`plpgsql.variable_conflict = error`, padrão do PostgreSQL), `mark_marketplace_payment_provider_created` (`0059`), `mark_marketplace_withdrawal_processing` e `finalize_marketplace_withdrawal` (`0056`), `cancel_marketplace_pending_payment` e `reconcile_marketplace_refund_webhook_event` (`0060`) e `complete_marketplace_refund_request` (`0055`) falhavam **sempre** com `column reference ... is ambiguous` (colunas OUT de `RETURNS TABLE` com o mesmo nome de colunas usadas sem qualificação). Cada uma tem uma única definição nas migrations. Com o erro ignorado pela rota, os eventos de transferência, `PAYMENT_CONFIRMED`, `PAYMENT_DELETED` e refunds respondiam 200 sem nenhum efeito; o mesmo vale para os outros chamadores (`withdrawal-actions.ts`, criação da cobrança Pix, cleanup lazy). Afirmações anteriores deste ADR de que esses caminhos foram "testados" não se sustentam para este ambiente. **O estado em staging/produção não foi verificado.** Decisão do dono do produto (2026-10-20): corrigir as funções junto com o P1, porque embrulhar só marca + efeito transformaria a falha silenciosa em 500 em loop.

**`0085`:**
- As 4 funções de efeito sem mudança de lógica foram recriadas com o corpo extraído do banco **idêntico**, mais `#variable_conflict use_column`. Dono, ACL e `search_path = public` foram mantidos.
- **Refund:** o núcleo de `complete_marketplace_refund_request` foi para `finalize_marketplace_refund_internal` (`SECURITY DEFINER`, `search_path` vazio, dono `postgres`, nenhum `EXECUTE` para `PUBLIC`/`anon`/`authenticated`/`service_role`). Ele lê `company_id` do próprio refund, trava a linha e copia sem mudança a lógica de status/ledger da `0055`. O wrapper humano mantém as verificações (perfil de `auth.uid()`, papel, mesma empresa) e a ACL (só `authenticated`). A `reconcile_…` (`0060`, corpo idêntico) chama o núcleo com ator `system`. Na trilha, `marketplace_refunds.finalized_by_type` (`user`/`system`) e `finalized_by` (usuário; nulo para `system`).
- **RPCs novas** `process_marketplace_transfer_webhook_event` e `process_marketplace_payment_webhook_event`: `SECURITY DEFINER`, `search_path` vazio, `EXECUTE` só para `service_role`. Cada uma trava a linha alvo, grava a marca em `processed_webhook_events` (`ON CONFLICT DO NOTHING`) e aplica o efeito na mesma transação. Qualquer erro desfaz tudo. Os códigos e mensagens de falha de saque que a rota passava foram mantidos, só que movidos para a RPC. `PAYMENT_RECEIVED` não passa por elas (`0081`/`0082` intocadas).
- **Marcas legadas:** mesma tabela e mesma chave (`body.id` ou `${event}:${id}`). *(Correção 0086: "sem colisão com a chave do SaaS" estava errado -- `body.id` cru disputava a unique `(provider, event_key)` com o `payment.id` do SaaS; ver a atualização da 0086.)* A marca não é prova de efeito: o efeito roda sempre e é idempotente pelo estado da linha e pela chave única do ledger. `marker_reused` informa que a marca já existia.
- **Resultados reconhecidos (200):** `withdrawal_not_found`, `already_final` (o primeiro desfecho vence, como na `0056`), `hold_still_valid` (só o erro exato `HOLD_STILL_VALID`), `not_pending` e as ações da `0060`. Taxa inválida, cobrança divergente, payment inexistente e falha de ledger desfazem tudo e viram 500.
- **Rota:** sem insert direto de marca. `parseTransferResult`/`parsePaymentEventResult` exigem uma linha do mesmo objeto (uuid canônico) e um resultado permitido para o tipo de evento; o resto dá 500 (`*_failed`/`*_unconfirmed`). `externalReference` de transferência que não é uuid é ignorado sem tocar o banco.

**Validado (Supabase local isolado, `project_id` `nauticflow-asaas-p1-isolated`, recriado do zero pelo CLI; `0000b`/`0000c` ignoradas pelo CLI como antes):** pgTAP 244/244 em 6 arquivos, incluindo `marketplace_webhook_events_atomic.test.sql` (75 asserções). Elas cobrem ACL/`search_path`; falha injetada no ledger desfazendo marca e efeito; retry; replay sem duplicar ledger; marcas legadas; chaves de fallback sem colisão; resultados reconhecidos; refund por `service_role` sem `auth.uid()`; `authenticated`/`service_role` sem acesso ao núcleo; e o wrapper humano. **Concorrência com duas sessões reais** (`scripts/db-concurrency/asaas-webhook-race.sh`):
- `finalize_marketplace_withdrawal` chamada direto, com desfechos conflitantes, aplica os **dois** efeitos (ledger `completed` + `failed`). É uma corrida da lógica da `0056`;
- via RPC da `0085`, a segunda sessão espera a trava e vê `already_final`; a mesma chave em duas sessões gera uma marca e um ledger;
- dois `PAYMENT_REFUNDED` concorrentes geram um `completed`, um `no_op` e um lançamento.

Vitest da rota: 47/47.

**Limites:** nada aplicado em staging/produção; Asaas real não testado; o campo do id do refund no payload do Asaas continua não confirmado. Estado real de produção dessas funções, registros presos e marcas sem efeito: desconhecidos (ver `TASKS.md`). `finalize_marketplace_withdrawal` direto continua sem trava interna.

## Atualização (2026-10-20) -- endurecimento após a revisão Codex da 0085 (`0086`/`0087`, local)

**Achados confirmados antes da correção (RED real, Supabase local isolado `nauticflow-asaas-p1-isolated`):**
- `PAYMENT_DELETED`/refunds não conferiam a cobrança: `PAYMENT_DELETED` com `pay_outra` cancelava o payment; `PAYMENT_REFUNDED` com `pay_outra` concluía o refund.
- A correlação de fallback da `0060` concluía um pedido que já tinha **outro** `provider_refund_id` e sobrescrevia o id; também concluía sem nenhum id do refund no evento.
- Revisão manual sem id do refund era chaveada por `(payment, event_type)`, e notificações distintas colapsavam numa linha.
- Marcas do marketplace na tabela compartilhada: um `body.id` igual a um `payment.id` do SaaS fazia `renew_subscription_from_asaas_payment` voltar `duplicate` sem renovar.
- Transferência com outro `transfer.id` para o mesmo `externalReference` finalizava o saque.
- Duas sessões reais: `finalize_marketplace_withdrawal` direto aplicava os dois ledgers; o fechamento humano de refund concorrente com `IN_PROGRESS` regredia o refund para `processing` (ledger de concluído já lançado); com `REFUNDED` de valor divergente, sobrescrevia `completed` com `manual_review`; o webhook devolvia desfechos desatualizados (`failed`/`completed` de um pedido já concluído).

**`0086`:**
- **Identidade da cobrança:** fora de `PAYMENT_CONFIRMED` (que vincula), o payment precisa ter `provider_payment_id` gravado e igual ao do evento (`PROVIDER_PAYMENT_ID_UNCONFIRMED`/`PROVIDER_PAYMENT_ID_MISMATCH`, 5xx, nada gravado). Transferência: `PROVIDER_TRANSFER_ID_MISMATCH` quando o saque já tem outro id.
- **Correlação do refund:** exige o id do refund do provedor. Primeiro o mesmo id; senão, exatamente um pedido em aberto **e sem id**. Qualquer outro caso vai para revisão manual (linha `manual_review`/`settlement_exception` da `0060`, sem ledger). A versão de 4 argumentos de `reconcile_marketplace_refund_webhook_event` foi removida; a nova (5 argumentos, com a chave do evento) não tem `EXECUTE` para nenhum papel da aplicação.
- **Concorrência:** o pedido é lido com `FOR UPDATE` (mesma trava do núcleo `finalize_marketplace_refund_internal`), o status é decidido depois da trava e todo UPDATE repete a condição de status. O resultado traz o status **real** (`no_op` com `completed`). `finalize_marketplace_withdrawal` também trava o saque e condiciona os UPDATEs.
- **Revisão manual sem id:** chave `(payment, chave do evento)`, de modo que o replay reaproveita a linha e notificações distintas geram linhas distintas. Sem `body.id` (fallback `${event}:${payment.id}`), notificações do mesmo tipo ainda colapsam: é limite do payload.
- **Marcas:** as RPCs da `0085` gravam em `marketplace_processed_webhook_events` (tabela da `0081`, com check de `event_type` ampliado). A chave e a tabela do SaaS não mudaram, então não há risco de renovação duplicada por troca de chave. Marcas antigas do marketplace na tabela compartilhada não são lidas nem apagadas.
- **Dono:** `ALTER FUNCTION ... OWNER TO postgres` explícito nas funções `SECURITY DEFINER` do webhook. Pré-requisito: quem aplica a migration precisa poder atribuir o dono a `postgres`.

**`0087`:** `SELECT (provider_payment_id)` em `payments` e `SELECT (id, provider_transfer_id)` em `marketplace_withdrawals` para `service_role` (só essas colunas), mais um índice parcial em `provider_transfer_id`. Elas atendem às consultas de referência da rota.

**Rota e chamadores:**
- Os parsers exigem status coerente com evento e desfecho: transferência `finalized` só com o status do evento; `already_final` só com status final; `in_progress` nunca `pending`. Refunds têm uma tabela por evento.
- Evento de objeto **local** sem os campos (ou com a cobrança/transferência de um objeto local, mas `externalReference` divergente) responde **422** e grava log `asaas_webhook_unprocessable_marketplace_event`. Evento de objeto desconhecido continua 200.
- Na criação da cobrança Pix, uma falha ao gravar o vínculo responde 500 sem QR; o retry reencontra a mesma cobrança pelo `externalReference`.
- No saque, uma falha ao marcar `processing` depois de transferência aceita é registrada em log, sem reenvio; o webhook leva o saque ao estado final.

**Validado (local isolado; 0086/0087 aplicadas incrementalmente sobre a 0085, sem reset):**
- pgTAP 287/287 em 7 arquivos, incluindo `marketplace_webhook_hardening.test.sql` (43 asserções). Antes da correção, 33 de 41 falhavam pelo comportamento.
- `scripts/db-concurrency/asaas-webhook-race.sh` com duas sessões reais:
  - antes da correção, 9 asserções falharam e o script saiu com `exit 1`;
  - depois, 48/48 e `exit 0`;
  - o script recusa (`exit 2`) projeto, contexto, labels ou volume diferentes do isolado;
  - fixtures por `RUN_ID`, limpeza com 0 linhas restantes.
- Vitest 153/153.

**Limites:**
- Nada aplicado em staging/produção; payload real do Asaas e campo do id do refund não confirmados.
- Marcas históricas sem efeito e marcas antigas que colidem com o SaaS dependem de reconciliação autorizada.
- Payments `pending` sem cobrança gravada recebem 5xx em loop em `PAYMENT_DELETED`/refund até alguém vincular.
- Revisões manuais de refund ainda sem fluxo de resolução.
- Grants e dono efetivos fora do local não verificados (ver `TASKS.md`).

## Atualização (2026-10-20) -- correções independentes da inbox (`0088`, local)

- **Replay de refund entre empresas:** `create_marketplace_refund_request` devolvia id, status e valores do pedido de OUTRA empresa quando a `idempotency_key` colidia (RED pgTAP). Agora o replay só vale para a mesma empresa e a mesma reserva; o resto levanta `IDEMPOTENCY_KEY_CONFLICT`, sem dados.
- **`mark_marketplace_refund_processing`:** toda chamada falhava com `column reference "id" is ambiguous` (RED pgTAP). Isso também atingia a ação de reembolso real (`refund-provider-actions.ts`): o provedor aceitava o refund, mas a marca local falhava. Colunas qualificadas. Um id divergente leva para `manual_review` só um pedido em aberto; pedido finalizado devolve o estado real. A regressão de pedido finalizado foi vista só na leitura do código, mascarada pelo erro de ambiguidade.
- **Despacho de saque:** a leitura do saque passa pela RPC `get_marketplace_withdrawal_dispatch_context` (só `service_role`), em vez de grants na tabela. RED: `permission denied for table marketplace_withdrawals` sob `service_role`. Toda saída sem envio e toda recusa do adapter ficam registradas; nada é reenviado nem marcado como falho.
- **Criação x correlação de refund:** sem mudança. Duas sessões reais mostraram que a FK `payment_id` já serializa a criação com o `FOR UPDATE` do webhook.
- **Harness:** a limpeza agora é verificada, com `exit` não zero; o núcleo privilegiado ficou separado do wrapper autenticado, e há um cenário de criação concorrente.

**Validado (local isolado, 0088 aplicada incrementalmente sobre a 0087):** pgTAP 311/311 em 8 arquivos; harness com 58 asserções ok, `exit 0`, limpeza com 0 linhas restantes; Vitest 160/160. Não validado: staging/produção, cadeia limpa do zero, payload real do Asaas, caminho de falha da limpeza do harness.
