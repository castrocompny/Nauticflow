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
única fonte de verdade pra essa lógica. Nunca existe um estado
intermediário onde `payment = paid` mas o ledger está faltando, ou onde o
ledger foi criado mas a reserva não foi confirmada -- tudo dentro da MESMA
transação Postgres, tudo ou nada.

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
`payment.id`. Deduplicar só por `(event_type, payment.id)` travaria
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

## Pendências explícitas desta fase

- `cancelMarketplacePendingPayment()` -- não implementado, registrado como próximo passo natural.
- Teste real em sandbox -- não executado (sem credencial disponível nesta sessão).
- Correlação automática de eventos de refund do provider com `marketplace_refunds` -- não implementada, só logado.
- Resolução de pedidos em `manual_review` (herdado do ADR `0004`) -- ainda sem mecanismo, agora com mais um gatilho possível (settlement exceptions).
- Limpeza de cobranças `pending` cujo hold expirou (seção 26 do pedido) -- não implementada nesta etapa; comportamento atual (parar de mostrar o QR quando o hold vence) já cobre o caso do turista, mas nenhuma limpeza/cancelamento no provider acontece ainda.
- Comissão global (10%) continua não configurada em produção -- nenhuma liquidação real é possível até `set_marketplace_global_fee_config` ser chamada de verdade (ADR `0006`).
- ToursFlow não foi alterado -- fora de escopo desta etapa, conforme instrução explícita.
