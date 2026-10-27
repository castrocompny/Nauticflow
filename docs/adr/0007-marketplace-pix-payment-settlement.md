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

## POST para customer/cobrança -- idempotência não provada por busca vazia

Timeout após `POST /customers` ou `POST /payments` pode deixar o resultado
incerto. Consultar por `externalReference` pode localizar um recurso, mas
uma busca vazia **não prova** que o POST não foi aceito e não demonstra
unicidade/idempotência do provider. Para cobrança PIX, a migration `0082`
reserva duravelmente o pagamento antes do POST; enquanto não houver
`provider_payment_id`, retries ficam bloqueados para reconciliação humana e
não enviam outro POST. A criação de customer (`POST /customers`) ainda não
tem proteção equivalente e permanece uma pendência explícita. Se a busca
retornar mais de um resultado, o fluxo falha fechado; nunca escolhe um
recurso por heurística.

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

## Idempotência do provider -- resultados incertos

A consulta por `externalReference` ajuda a localizar recursos, mas não prova
que uma busca vazia significa ausência nem garante deduplicação. Para
`POST /payments`, o claim durável da migration `0082` impede novo POST até a
reconciliação manual quando não há id local persistido. Para
`POST /customers`, essa proteção ainda não existe; retries após resultado
incerto continuam pendentes de uma solução segura.

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
   Testado explicitamente simulando a corrida nos dois sentidos.

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

## Atualização (2026-10-23) -- `PAYMENT_RECEIVED` em payment `failed` (migration `0081`, reconstrução validada localmente)

**Origem e proveniência.** A 0081 original e as migrations originais 0082–0088 não foram recuperadas como arquivos. As migrations `0081` e `0082` atuais foram reconstruídas para este checkout, a partir do código existente, decisões registradas e do WIP parcial; não são cópias literais do trabalho perdido. As duas foram aplicadas somente no PostgreSQL efêmero criado para esta tarefa, com bootstrap/fixtures artificiais; não foram aplicadas no banco do projeto, Supabase remoto, staging ou produção. A validação SQL local atual está detalhada abaixo e não representa a chain Supabase completa.

**Problema (confirmado por leitura do código de `main`).** A rota gravava a marca de dedupe em `processed_webhook_events` *antes* do efeito e respondia 200 mesmo se `settle_marketplace_payment_received` falhasse. Um Pix recebido para payment `failed` (hold vencido/cobrança cancelada) levantava `PAYMENT_NOT_PENDING`, a marca ficava gravada e o Asaas nunca reenviava.

**Decisão.**
- `PAYMENT_RECEIVED` verificado no Asaas chama `process_marketplace_payment_received_event` e **não grava marca de dedupe**: o efeito já é idempotente (`paid` => replay), então não existe "marca sem efeito". Marcas legadas em `processed_webhook_events` deixam de ser consultadas para este evento.
- payment `failed`: grava uma linha por cobrança distinta em `marketplace_payment_exceptions` (chave `(payment_id, kind, provider_payment_id)`); replays idênticos são reconhecidos, dados conflitantes do mesmo provider ID falham com erro retryable, e nenhuma ocorrência altera payment, reserva, ledger, saldo ou refund.
- `refunded`/`partially_refunded` recebendo reentrega: replay sem efeito.
- A rota só responde 200 se o retorno da RPC for coerente (evento, `payment_id`, `outcome` e status); erro ou retorno incoerente => 500 (retryable).
- Fila `/admin/excecoes-pagamento`: **somente leitura**, super_admin + aal2 (página e RLS), sem ação de "resolver" (qualquer resolução teria de decidir o destino do dinheiro) e sem paginação por cursor (limite fixo de 100).
- `mark_marketplace_payment_provider_created` (0059) falhava sempre por coluna ambígua (OUT `id`/`provider_payment_id`); a 0081 só qualifica as colunas. O `POST .../payment` passou a **não devolver o QR** se o vínculo falhar (depende dessa correção; sem a 0081 aplicada o endpoint falharia com a flag ligada).

**Bloqueio adicional identificado na revisão e mitigação reconstruída.** `createOrReconcileMarketplacePixCharge` ainda consulta `/payments?externalReference=...` e pode enviar POST quando a busca retorna zero; a API e o suporte não garantem unicidade/idempotência por `externalReference`. Por isso a `0082` grava uma reserva local antes do primeiro POST e bloqueia todos os retries sem ID persistido, sem tratar busca vazia como prova de ausência. Essa mitigação foi validada em testes locais; a reconciliação manual ainda não existe, então resultados incertos permanecem bloqueados e exigem procedimento operacional fora do sistema. O risco equivalente de `POST /customers` não foi resolvido.

> **Atualizado na seção seguinte (2026-10-23, reserva durável antes do POST):** o bloqueio acima foi tratado no nível do **nosso** código (migration `0082`), sem depender de nenhuma garantia do Asaas. Leia aquela seção para o que está e o que não está coberto.

**Não coberto / bloqueado.** A chain completa de migrations Supabase e as permissões das novas leituras `service_role` não foram validadas contra uma instalação Supabase completa; os testes usaram um DB efêmero com bootstrap/auth compat e fixtures. `mark_marketplace_withdrawal_processing` (0056) ainda tem defeito de colunas ambíguas e `finalize_marketplace_withdrawal` segue sem auditoria; saques não recebem `cancel_unsent`, reenvio ou ajuste de ledger. Refunds continuam congelados. Nada desta validação autoriza Asaas, produção/staging, atividade financeira ou deploy.

## Atualização (2026-10-23, 2) -- reserva durável antes do `POST /payments` (migration `0082`, validada apenas em DB efêmero)

**Separação do que é o quê.**
- *Reconstruído* (seção anterior): `0081`, fila de exceções, `process_marketplace_payment_received_event`, correção de colunas ambíguas de `mark_marketplace_payment_provider_created`.
- *Implementado no worktree isolado*: a proteção abaixo (`0082`, rota, cleanup, testes). `0081` e `0082` foram aplicadas apenas no DB efêmero criado para esta tarefa; não foram integradas à branch `main` nem aplicadas ao banco do projeto ou a serviço remoto.

**O que NÃO se sabe.** Nenhuma garantia de unicidade ou idempotência de `POST /payments` por `externalReference` foi verificada aqui. O contato de suporte trazido pelo usuário tratou de `/transfers` e **não** é evidência sobre `/payments`. Por isso a proteção não depende do comportamento do Asaas.

**Decisão.**
- `payments.provider_charge_claimed_at` é gravado **antes** do POST pela RPC `claim_marketplace_pix_charge_creation` (decisão e gravação sob `FOR UPDATE`, mesma transação, `service_role`-only). Resultados: `claimed` (única permissão de POST, concedida a um só chamador), `linked` (já há `provider_payment_id`: reutiliza e busca o QR, **sem POST**), `blocked` (reservado e sem id).
- A rota chama o claim imediatamente antes de `createOrReconcileMarketplacePixCharge` (depois do customer, para que uma falha no customer, que ainda não envia cobrança, não bloqueie a tentativa). `blocked` responde `409 PAYMENT_ALREADY_ACTIVE` com mensagem de verificação manual e **nunca** faz POST. Código de erro existente reaproveitado de propósito: não há mudança no contrato consumido pelo ToursFlow.
- `cancel_marketplace_pending_payment` (0060) passou a **não cancelar** (`was_cancelled=false`, slot de `payments_one_active_per_reservation` mantido) um pagamento reservado sem `provider_payment_id`; o cleanup lazy devolve `deferred`. Sem isso a expiração do hold liberaria o slot e uma nova tentativa (novo payment id => novo `externalReference`) poderia coexistir com uma cobrança que talvez exista no Asaas.

**Comportamento manual quando o resultado é incerto.** Estado incerto = `provider_charge_claimed_at` preenchido e `provider_payment_id` nulo. Ocorre em: crash entre a reserva e o POST; POST aceito mas resposta perdida/timeout; erro do provider (inclusive 4xx definitivo, que não distinguimos); falha ao gravar o id. Em todos, retries ficam `blocked` e **nada** é liberado automaticamente. Um humano deve consultar o Asaas (por `externalReference` = id interno do payment) e: (a) se a cobrança existe, vincular o id; (b) se comprovadamente não existe, decidir fora do sistema como liberar. **Não existe ainda** ferramenta/RPC/UI para essa resolução; hoje exigiria SQL manual por quem tem acesso, e é uma pendência. O webhook `PAYMENT_RECEIVED` continua sendo a única autoridade de liquidação e, ao chegar para um pagamento reservado sem id, grava o id pela RPC existente. Nada aqui marca pagamento como recebido.

**Verificação realizada.** Vitest: 8 arquivos/109 testes passaram; lint: 0 erros e 4 avisos `<img>` existentes; `tsc --noEmit --incremental false`: passou. PgTAP/pg_prove no DB efêmero: 4 arquivos/126 testes passaram (inclui 22 casos de exceção e 21 de claim). Dois processos PostgreSQL concorrentes confirmaram a persistência de cobranças distintas e replay idempotente; teste concorrente separado confirmou que cleanup não cancela nem libera slot após claim concorrente. Um ensaio adicional em transação configurou uma fixture `pending` legada sem ID, executou o backfill da 0082 e observou `claimed_at` preenchido + claim `blocked`; a transação foi revertida. Esse ensaio de backfill não está como teste versionado. Os testes HTTP do claim usam fake em memória e não provam atomicidade SQL.

**Não verificado / pendente.** (1) A chain completa de migrations não foi executada numa stack Supabase oficial nem comparada a um schema real do projeto; este DB usou bootstrap e compatibilidade `auth.*` artificiais. (2) As permissões das novas consultas `service_role` não foram validadas contra uma instalação Supabase completa. (3) Ainda não existe ferramenta/RPC/UI de reconciliação manual para estado bloqueado. (4) O backfill de legado foi exercitado em transação local, mas não há teste versionado de migração pré-0082; antes de aplicar em banco com dados, revisar o inventário dos pagamentos `pending` sem `provider_payment_id`, pois serão bloqueados. (5) Se uma cobrança adicional do mesmo payment chegar após o payment local sair de `failed` e já possuir outro `provider_payment_id`, a RPC atual lança `PROVIDER_PAYMENT_ID_MISMATCH`; esse caso não cria exceção durável nesta migration e requer desenho/teste separado. (6) O risco de resultado incerto em `POST /customers` segue sem proteção equivalente. Nenhum resultado local prova prontidão para produção.


## Atualização (2026-10-23, 3) -- revisão do snapshot WIP `cde4f8d` (integrado apenas ao `main` local após verificação; sem push ou rollout)

**Classificação.** *Recuperado do Git (`cde4f8d`)*: apenas os trechos listados abaixo como portados. *Reconstruído a partir de evidência*: `0081`, `0082`, fila `/admin/excecoes-pagamento` e rota de `PAYMENT_RECEIVED` com `process_marketplace_payment_received_event` (seções anteriores). *Escrito agora*: testes novos em `route.test.ts` do webhook e em `withdrawal-actions.test.ts`.

**Portado do WIP e correção local após revisão.** `dispatchNotSent` e tratamento de erro das leituras do saque e da chave Pix crua (`marketplace_withdrawal_dispatch_not_sent`, sem reenvio); `externalReference` de transferência só vale se for UUID; evento local de saque/payment sem os campos necessários ou com referência divergente não recebe 200 silencioso. Para payment local, a rota agora também compara o `provider_payment_id` com o payment encontrado pela referência e recusa conflito entre dois payments locais antes de verificar/liquidar; teste RED→GREEN cobre esse caso e o erro da consulta. `unprocessableMarketplaceEvent` retorna 422 + log best-effort, mas não há quarentena durável e não se presume retry do provedor para 4xx; isso segue bloqueio de rollout. `PAYMENT_RECEIVED` cuja consulta ao Asaas falha definitivamente também é apenas logada e recebe 200, sem registro durável; validar esse descarte e a política de retries antes de habilitar. Evento desconhecido permanece no caminho anterior. O cleanup de pagamento pendente só é reportado como `cancelled` quando a RPC local confirma `was_cancelled=true`; após remoção no provider com estado local falso/ausente, retorna `deferred` e não afirma mudança de status.

**Não aplicado, por dependência ausente.** Transferência, `PAYMENT_CONFIRMED`, `PAYMENT_DELETED` e refunds atômicos (`process_marketplace_transfer_webhook_event`, `process_marketplace_payment_webhook_event`, 0085/0086); leitura estreita do saque (`get_marketplace_withdrawal_dispatch_context`, 0088) e a guarda de status `pending` que dependia dela; `resolvePaymentException` (`resolve_marketplace_payment_exception`, sem migration aqui; a fila segue somente leitura); `settle_marketplace_payment_received_once` (substituída pela RPC da `0081` reconstruída). O trecho do WIP em `payment/route.ts` já está representado, mas o comentário "o retry reconcilia pelo `externalReference`" **não** vale mais: a `0082` bloqueia o retry sem id e nenhuma busca por `externalReference` é considerada prova de ausência de cobrança. Transferências continuam bloqueadas: o handler existente ainda chama `mark_marketplace_withdrawal_processing`/`finalize_marketplace_withdrawal` (0056), cujas funções não fazem correlação atômica do `provider_transfer_id` com o saque; a nova consulta HTTP recusa conflito já conhecido, mas não fecha a corrida entre entregas. Não habilitar nem aplicar esse fluxo sem constraint/RPC atômica e teste concorrente. Migrations 0083–0088 e seus testes não foram recuperados nem recriados.

> **Nota histórica (2026-10-26).** O parágrafo acima descreve a base `187e8f8`. A correção local `0089` (não commitada, não publicada) cria uma `process_marketplace_transfer_webhook_event` nova -- não é a função perdida da 0085/0086 -- e a rota passa a chamá-la, com lock de linha e advisory lock por transfer id. Ela passou no ensaio pgTAP isolado; a corrida entre sessões continua sem teste e nada foi validado em ambiente remoto. Ver ADR 0005, atualização de 2026-10-26.

**Verificado nesta worktree.** `npm test -- --reporter=dot`: 8 arquivos/109 testes passaram; `npm run lint`: 0 erros e 4 avisos `<img>`; `tsc --noEmit --incremental false`: passou. `pg_prove -v /tmp/database/*.test.sql`: 4 arquivos/126 testes passaram no DB efêmero com bootstrap/fixtures. Testes concorrentes em duas sessões passaram para exceções `PAYMENT_RECEIVED` e para claim versus cleanup. **Ainda não verificado:** chain Supabase completa, permissões no schema real e ambiente remoto; migrations 0083–0088 perdidas não foram reconstruídas, e as funções de webhook delas continuam ausentes. Nenhuma prontidão para produção/staging é afirmada.

> **Nota (2026-10-26).** Os "126 testes" acima foram contados num DB efêmero com bootstrap artificial. Na chain completa aplicada do zero num banco local isolado, `marketplace_payment_received_exceptions.test.sql` falha (`permission denied for table payments`, 13/22) porque a imagem local não concede SELECT ao `service_role`; passa 22/22 com o bootstrap de teste `supabase/tests/setup/service_role_platform_grants.sql`. Ver ADR 0005, "Privilégios do `service_role`".
