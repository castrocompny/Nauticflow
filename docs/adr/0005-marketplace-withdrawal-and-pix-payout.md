# ADR 0005 — Saque do operador e payout Pix (adapter pronto, modo mock/sandbox)

- Status: aceita
- Data: 2026-08-31
- Contexto: próxima etapa financeira do marketplace ToursFlow, depois de cancelamento/no-show/refund (`docs/adr/0004-...md`)

## Objetivo desta etapa

Fechar o fluxo de SAQUE do operador usando a chave Pix cadastrada (`0054`),
com um adapter pronto pra Asaas mas operando em modo mock/sandbox
controlado -- **nenhuma transferência real, nenhum dinheiro real se move**.
Migration `0056` (não aplicada).

## Achado arquitetural -- `asaas_wallet_id` é do modelo rejeitado, não deste

`companies.asaas_wallet_id`/`asaas_receiver_status` (migration `0052`) foram
provisionadas pensando no modelo de **Split** do Asaas -- explicitamente
**rejeitado** no ADR `0002` em favor de retenção interna (ledger) + payout
em Pix direto. O destino de saque real desta arquitetura é
`marketplace_payout_accounts` (`0054`), não uma wallet Asaas.
`request_marketplace_withdrawal` **não checa `asaas_receiver_status`** --
checar isso seria validar um campo do modelo que não foi escolhido, e
mascararia a checagem que realmente importa (`marketplace_payout_accounts.
verification_status`). Nenhuma company tem `asaas_wallet_id` configurado
até hoje (confirmado em revisões anteriores) -- manter aquela checagem
deixaria todo saque falhando pra sempre, silenciosamente pelo motivo
errado.

## Titularidade -- dimensão separada de "chave corrente"

`marketplace_payout_accounts.status` (`0054`) já representa "é a chave
corrente ou foi substituída" (`unverified`/`superseded` -- nome infeliz em
retrospecto, já que `unverified` ali só significava "não substituída", não
"titularidade confirmada"). Esta migration corrige isso adicionando
`verification_status` (`unverified`/`verified`/`rejected`) como dimensão
**separada**: `status` continua respondendo "é esta a chave ativa?",
`verification_status` responde "o provider confirmou que ela pertence ao
operador?". As duas nunca deveriam ser lidas como a mesma coisa.

**Só service_role escreve `verification_status`**
(`mark_marketplace_payout_account_verified`) -- titularidade nunca é
autodeclarada, nem pelo `company_admin`, nem por engano. Nesta fase, sem
integração real, é o mecanismo de modo mock/sandbox que a aciona (uso
interno/teste, sem UI); numa fase futura, seria um webhook real de
confirmação do provider chamando a mesma RPC.

`request_marketplace_withdrawal` recusa (`PAYOUT_ACCOUNT_NOT_VERIFIED`) sem
os dois: conta corrente E `verification_status = 'verified'`. Produção,
sem integração real: toda chave permanece `unverified` pra sempre -- todo
saque real falha fechado, por construção, não por acidente.

## `create_marketplace_withdrawal`/`complete_marketplace_withdrawal` (`0053`) superadas

Mesmo padrão já usado em `record_marketplace_refund` → `create_marketplace_
refund_request` (`0055`): o modelo de confiança muda de `service_role` +
`company_id` como parâmetro (pensado pra um chamador de backend) pra
`authenticated` + `auth.uid()` (self-service real do operador, que é o que
esta etapa pede) -- uma mudança de ASSINATURA que `create or replace
function` não cobre sem trocar o nome. As funções de `0053` continuam
definidas, preservadas, **não removidas, não chamadas por nenhum código
novo**. `request_marketplace_withdrawal` e `finalize_marketplace_
withdrawal` são as usadas de fato -- a lógica de reclassificação de ledger
(`available → withdrawal_pending → transferred`, ou `→ available` de
volta na falha) é idêntica à de `0053`, só o modelo de autorização e os
campos adicionais (fee, motivo de falha, snapshot da conta) mudaram.

## Nunca aceita a chave Pix do request

`request_marketplace_withdrawal` recebe só `amountCents` +
`Idempotency-Key` -- a conta de destino é **sempre** resolvida
server-side (`marketplace_payout_accounts` corrente da empresa do
chamador). Nenhum código aceita uma chave Pix vinda do frontend em nenhum
momento do fluxo de saque.

## Concorrência e idempotência -- mesmas travas de sempre

Mesma `pg_advisory_xact_lock(hashtext('marketplace_withdrawal'),
hashtext(company_id))` já usada desde `0053`/reaproveitada em `0055` --
nenhuma trava nova. Idempotência por `idempotency_key` própria (unique
index), checada antes de qualquer trava/cálculo -- replay com a mesma key
é seguro, mesma key com valor diferente é `WITHDRAWAL_IDEMPOTENCY_
CONFLICT`. Cenário do pedido (saldo 100000, duas requisições de 80000
simultâneas) testado explicitamente -- só uma passa.

## `blocked` nunca vira saque direto

Autoridade é sempre o ledger: `request_marketplace_withdrawal` só lê
`available_balance_cents` (via `get_marketplace_operator_balances`) --
`blocked` nunca é somado nem considerado. A única porta de `blocked` pra
`available` continua sendo `release_marketplace_reservation_balance`
(`0053`/`0055`). Reforçado também na UI: o botão de saque nunca expõe o
saldo bloqueado como sacável.

## Refund pendente / manual_review bloqueiam novos saques

`request_marketplace_withdrawal` recusa (`MANUAL_REVIEW_PENDING`) se
existir qualquer `marketplace_refunds` da empresa em `status =
'manual_review'` -- fail closed até resolução administrativa (nenhum
mecanismo de resolução implementado ainda, mesma pendência já registrada
no ADR `0004`). Reembolsos em `pending`/`processing` (ainda não chegaram a
manual_review) não bloqueiam saque -- já não entrariam no cálculo de
`available` de qualquer forma (o valor já está em `refund_pending`, um
bucket separado), então bloquear por eles seria redundante.

## Snapshot da conta -- troca de chave não afeta saque em andamento

`marketplace_withdrawals.payout_account_id` é capturado uma única vez, na
criação (`request_marketplace_withdrawal`) -- nunca reavaliado depois. Se
o operador trocar de chave Pix enquanto um saque está `processing`, a
transferência em andamento continua associada à conta ORIGINAL -- nunca
redirecionada pra chave nova. Testado explicitamente: um saque criado com
a chave A mantém `payout_account_id = A` mesmo depois de A virar
`superseded` e B se tornar a corrente; um saque NOVO, criado depois da
troca, já nasce associado a B.

## Adapter pronto, modo mock/sandbox controlado

`createMarketplacePixTransfer()` (`src/lib/asaas.ts`) -- guard duplo, mesmo
espírito de `createMarketplacePayment()`: `MARKETPLACE_WITHDRAWAL_PAYOUT_
ENABLED` (default `false`) precisa estar ligada pra qualquer chamada
prosseguir; `MARKETPLACE_WITHDRAWAL_MOCK_MODE` (quando `true`) faz a
função simular uma transferência bem-sucedida **sem nenhuma chamada de
rede**, sem depender de `ASAAS_API_KEY`, custo ou risco zero -- pensado só
pra testar o fluxo de ponta a ponta localmente. Revalida a chave (checksum
CPF/CNPJ) por conta própria antes de qualquer coisa, mesmo espírito de
toda função financeira deste projeto nunca confiar cegamente no que
chegou até ali.

## Revisão final contra o contrato oficial do Asaas (`POST /v3/transfers`)

Rodada de correção posterior, com o contrato confirmado explicitamente
(não mais "entendimento geral" -- fornecido como especificação para esta
revisão):

**Payload confirmado correto**: `value` (decimal em reais, nunca
centavos), `pixAddressKey`, `pixAddressKeyType`, `externalReference`,
`operationType: "PIX"` (adicionado nesta revisão -- não estava no payload
original). Tipos de chave (`CPF`/`CNPJ`/`EMAIL`/`PHONE`/`EVP`) já batiam
com o mapeamento existente (`pixKeyTypeToAsaasFormat`). `externalReference`
já era corretamente `marketplace_withdrawals.id`, nunca `company_id`/chave
Pix/CPF/CNPJ/e-mail/telefone -- confirmado, sem mudança necessária.

**Conversão cents→reais corrigida**: `params.amountCents / 100` direto
tinha risco latente de imprecisão de ponto flutuante (o clássico
`0.1 + 0.2 !== 0.3` do JavaScript) para certos valores de centavos.
`centsToReaisForProvider()` (`src/lib/asaas.ts`) isola essa conversão numa
função só, com `.toFixed(2)` explícito, testada contra os 4 valores
pedidos (1, 100, 1050, 85000 centavos) mais um valor classicamente
propenso a erro (20957 → 209.57 exato). A conversão acontece **só na
borda** da chamada ao provider -- `amountCents` continua inteiro em todo
cálculo interno, nunca float.

**Telefone (PHONE) -- pendência que permanece em aberto**: o formato exato
esperado pelo Asaas (com/sem `+55`, com/sem DDI) não foi confirmado nem
nesta revisão. Por ora, os dígitos normalizados (DDD+número, sem nenhuma
transformação) são enviados como estão -- precisa de validação real antes
de qualquer saque de telefone de verdade. EVP nunca é alterado
silenciosamente (confirmado, nenhuma transformação acontece pra esse
tipo).

**Eventos oficiais -- todos os 7, nenhum inventado**: `TRANSFER_CREATED`,
`TRANSFER_PENDING`, `TRANSFER_IN_BANK_PROCESSING`, `TRANSFER_BLOCKED`,
`TRANSFER_DONE`, `TRANSFER_FAILED`, `TRANSFER_CANCELLED` -- a primeira
versão desta migration só reconhecia 2 (`DONE`/`FAILED`), ignorando os
outros 5 silenciosamente (o webhook simplesmente não processava esses
eventos, mas também não quebrava nada -- um saque ficaria preso em
`pending` até um evento reconhecido chegar). Corrigido: os 4 eventos
intermediários (`CREATED`/`PENDING`/`IN_BANK_PROCESSING`/`BLOCKED`) agora
avançam o saque pra `processing` (idempotente); os 3 desfechos definitivos
(`DONE`/`FAILED`/`CANCELLED`) chamam `finalize_marketplace_withdrawal`.
Nenhuma sequência entre eles é assumida como obrigatória -- um `DONE` que
chega sem nenhum evento intermediário antes ainda completa corretamente
(testado).

**`TRANSFER_BLOCKED` não é falha definitiva**: tratamento próprio,
deliberadamente diferente de `FAILED` -- o saldo continua reservado em
`withdrawal_pending`, o saque continua `processing`, nada no ledger muda.
Uma checagem/retenção do banco pode resolver pros dois lados depois; tratar
como falha devolveria o saldo prematuramente, podendo permitir um segundo
saque enquanto o primeiro ainda pode se resolver com sucesso.

**`TRANSFER_CANCELLED` ganhou status e `entry_type` próprios**:
`finalize_marketplace_withdrawal` trocou `p_succeeded boolean` por
`p_outcome text` (`'completed'|'failed'|'cancelled'`) -- `cancelled` tem o
MESMO efeito de bucket que `failed` (devolve pra `available`) mas é
registrado com `entry_type = 'withdrawal_cancelled'`, distinto de
`withdrawal_failed` -- auditoria nunca deveria ler "o operador cancelou"
como se fosse "o banco recusou". `marketplace_withdrawals.status =
'cancelled'` já existia no enum desde `0053`, mas nunca era produzido até
esta correção.

**Idempotência do webhook corrigida -- por EVENTO, não por transferência**:
achado real desta revisão. A primeira versão deduplicava por
`(event_type, transfer.id)`, reaproveitando ingenuamente o mesmo padrão do
fluxo de pagamento SaaS (que deduplica por `payment.id`, migration
`0037`). Isso funciona pra pagamento porque `PAYMENT_CONFIRMED`/
`PAYMENT_RECEIVED` são, na prática, eventos que só fazem sentido uma vez
por cobrança. Uma transferência é diferente: o MESMO `event_type`
(especialmente os intermediários, como `TRANSFER_IN_BANK_PROCESSING`) pode
legitimamente ser reenviado mais de uma vez como atualização de progresso
-- deduplicar só por `(event_type, transfer.id)` correria o risco (mesmo
que sem consequência financeira real, já que os eventos intermediários são
idempotentes por natureza) de descartar silenciosamente uma atualização
legítima. Corrigido: a chave de idempotência agora é `body.id` (o id do
EVENTO em si, o envelope da notificação -- distinto de `transfer.id`)
quando presente no payload, com fallback pra `transfer.id` se o provider
genuinamente não enviar um id de evento. Testado explicitamente: dois
eventos DIFERENTES da mesma transferência (`PENDING` seguido de `DONE`)
são processados normalmente; o MESMO evento reenviado (mesmo id) é
deduplicado e produz um único efeito. O fluxo de pagamento SaaS
(`payment.id`) **não foi alterado**.

## Leitura crua da chave Pix -- exceção deliberada e estreita

`0054` decidiu "nenhuma leitura crua existe, nem pro backend" porque não
havia necessidade legítima ainda. Esta migration é essa necessidade:
repassar a chave ao provider real exige o valor cru em algum ponto.
`get_marketplace_payout_account_raw_for_transfer` -- `service_role`-only,
devolve só tipo+valor, pensada exclusivamente pro dispatch de saque
(`src/app/(app)/financeiro/withdrawal-actions.ts`). Nenhuma outra rota
deveria chamá-la.

## Taxas do provider -- separadas, nunca assumidas

`marketplace_withdrawals.provider_fee_cents`/`net_transfer_cents` --
`NULL` até o provider confirmar (não se assume Pix grátis nem se inventa
um valor). `finalize_marketplace_withdrawal` recusa
(`INVALID_PROVIDER_FEE`) se a taxa informada excedesse o valor do saque.
Nenhum comportamento contábil de taxa foi inventado além de registrar o
valor quando existir.

## Webhook -- autoridade final, nunca a resposta síncrona

`src/app/api/webhooks/asaas/route.ts` estendida (não reescrita) --
distingue `payment` (fluxo SaaS existente, intocado) de `transfer` (saque
do marketplace, novo) pelo corpo do evento. Mesma verificação de
`asaas-access-token`/`timingSafeEqual`, mesma tabela `processed_webhook_
events` (migration `0037`) pra idempotência -- `event_key` é o id do
EVENTO (`body.id`, com fallback pra `transfer.id`, ver seção de revisão do
contrato acima -- corrigido nesta revisão, não mais `transfer.id` sozinho).
`externalReference` da transferência é sempre o id INTERNO do saque
(`marketplace_withdrawals.id`) -- nunca a chave Pix, nunca o `company_id`
direto. A resposta síncrona do `POST /transfers` só marca `processing`
(`mark_marketplace_withdrawal_processing`) -- `completed`/`failed`/
`cancelled` só acontecem quando o webhook confirma um dos 3 eventos
terminais, nunca antes.

## Segurança da chave -- nunca completa em resposta/histórico/log

`list_marketplace_withdrawals` devolve só `mask_pix_key(...)`, nunca
`pix_key_normalized`. `logSecurityEvent("marketplace_withdrawal_
requested", ...)` carrega só `companyId`/`withdrawalId`/`amountCents` --
testado explicitamente que nenhuma chave aparece ali.

## UI -- mínima, estados claros

`/financeiro`: botão "Sacar" (desabilitado/oculto quando não há chave
verificada, com mensagem explicando por quê), painel inline com saldo
disponível + valor + destino mascarado + confirmação (mesmo padrão de
seção expansível já usado em `PayoutAccountForm`/`AddPassengerForm` --
sem componente de modal verdadeiro neste projeto). Histórico de saques
(`list_marketplace_withdrawals`) com estados traduzidos (Saque
solicitado/Processando/Concluído/Falhou) e motivo de falha seguro quando
existir.

## Pendências explícitas desta fase

- Formato exato do campo PHONE (telefone) esperado pelo Asaas (com/sem `+55`) -- não confirmado nem nesta revisão, dígitos normalizados enviados como estão.
- Confirmação real de titularidade da chave Pix -- não implementada, só o mecanismo mock/sandbox existe.
- Resolução de pedidos em `manual_review` (herdado do ADR `0004`) -- ainda sem mecanismo.
- Limite de saque diário/mínimo -- deliberadamente não inventado, `amount > 0` e `amount <= available` são as únicas regras desta fase.
- Cancelamento de um saque `pending` pelo próprio operador -- `status='cancelled'` existe no enum (herdado de `0053`), mas nenhuma RPC desta migration o produz.
- Comissão real (`marketplace_fee_config`) -- continua vazia, nenhuma ativação de pagamento real depende desta etapa.
