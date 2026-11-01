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

## Atualização (2026-10-26) -- webhook `TRANSFER_*` atômico (migration `0089`, validada só em banco local isolado)

**Problema (leitura do código).** As RPCs `mark_marketplace_withdrawal_processing`/`finalize_marketplace_withdrawal` (0056) usam `id`/`status` sem qualificar, em conflito com os parâmetros OUT; a rota gravava `processed_webhook_events` antes delas e ignorava o erro (200 sem efeito, reenvio virava `duplicate`); `finalize` lia sem lock e nenhuma das duas conferia a identidade do `provider_transfer_id`.

**Decisão (0089, local, não aplicada em nenhum ambiente remoto).**
- `process_marketplace_transfer_webhook_event`: o estado do saque sob `for update` decide o efeito; a marca é só registro e não prova processamento (marcas antigas foram gravadas antes do efeito). Chave já usada por outro `event_type` → `EVENT_KEY_CONFLICT`.
- `mark`/`finalize` redefinidas com colunas qualificadas, lock de linha e trava de identidade (advisory lock por transfer id + recusa de id ligado a outro saque → `PROVIDER_TRANSFER_ID_MISMATCH`). Ordem: linha do saque, depois advisory.
- Saque fora de `pending` sem `provider_transfer_id` → `TRANSFER_IDENTITY_UNPROVEN`; desfecho terminal diferente do gravado → `TERMINAL_OUTCOME_CONFLICT`. A rota responde 422 para esses erros, 500 para erro inesperado e 200 só com retorno coerente da RPC.
- `complete_marketplace_withdrawal` (0053, sem callers) tem EXECUTE revogado também de `service_role`.

**Validação local (2026-10-26).** Banco Postgres 17.6 isolado (`supabase db start --workdir` fora do repositório, `project_id` e portas próprios), chain 0001–0082 + 0089 aplicada sem erro (0083–0088 ausentes). `marketplace_withdrawal_webhook.test.sql`: 40/40. As funções foram chamadas no papel da sessão de teste, não sob `service_role`; a corrida em duas sessões e escrita direta na tabela por `service_role` não foram exercitadas. Vitest da rota: 46/46.

**Validação local offline (2026-10-28).** Laboratório `nf-bootstrap-offline-a01-db` (Postgres 17.6, `network=none`, sem portas; chain 0001–0082 + 0089 e bootstrap de grants aplicados antes, fora do harness). Corpo das quatro funções da 0089 conferido por catálogo contra o HEAD `235bd1e` (md5 de `prosrc`); o banco não tem `schema_migrations`, então a aplicação das demais migrations não é comprovada. Harness versionado em `supabase/tests/offline/` (ver `supabase/tests/README.md`), corrigido após revisão independente: PASS exige exit 0 do cliente **e** TAP estrito, rollback/commit confirmados e nenhuma sessão residual; testes do harness com cliente simulado. Resultado: pgTAP sequencial 18/18, 22/22, 40/40 e auxiliar sob `service_role` 17/17 (o chamador é `service_role`; o corpo roda como owner, `SECURITY DEFINER`); corridas em duas sessões READ COMMITTED com bloqueio observado antes do commit -- DONE×FAILED nos dois sentidos (perdedor `TERMINAL_OUTCOME_CONFLICT`, só o par de ledger do vencedor, nenhuma marca do perdedor) e mesmo transfer id em dois saques `pending` com vencedor X e Y (espera no advisory do transfer id, perdedor `PROVIDER_TRANSFER_ID_MISMATCH`, saque recusado inalterado) -- 30/30 verificações finais. Fixtures fictícias inseridas direto (sem saldo real). Fora da cobertura: mesma `event_key` concorrente, rollback do vencedor, chamadas diretas a mark/finalize, `TRANSFER_CANCELLED`, Vitest nesta rodada, grants remotos e Asaas real.

**Endurecimento do harness (2026-10-28, segunda rodada).** Após nova revisão independente (sem bloqueador concreto), o harness passou a reprovar falha de gravação de evidência (exit 3 se nem `RESULT` puder ser gravado), conferir `wait` e encerramento do cliente de cada sessão concorrente, observar de novo após encerrar backends, recusar lista de cenários com campo vazio e exigir assinatura exata e unicidade na comparação de catálogo. Testes do harness com cliente simulado: 162/162. Revalidação real no mesmo laboratório com essa versão (hashes iguais ao manifesto, evidências em `nf-bootstrap-offline-a01/realval-20261028`): pgTAP 18/18, 22/22, 40/40 e 17/17; DONE×FAILED nos dois sentidos e mesmo transfer id com vencedor X e Y aprovados, 30/30 verificações finais, oito clientes com `wait=0` e rc 0, nenhuma sessão residual; parada `pg_ctl stop -m fast` confirmada por log e container `exited` com saída 0 (o `docker exec` da parada devolveu 137, não 0). Depois disso, uma última correção fez o modo simulado reprovar falha ao gravar `provenance/lab.txt` (e ajustou um comentário), validada só com cliente simulado (166/166); o caminho do banco real não mudou, mas a revalidação real não foi repetida com esse `common.sh`. Simulados e banco são coberturas distintas.

**Privilégios do `service_role` (2026-10-26).** Nenhuma migration concede ao `service_role` privilégio em `payments`, `marketplace_withdrawals`, `processed_webhook_events` ou `subscriptions` (a 0053 concede só SELECT no ledger); nessas tabelas o app depende dos default privileges da plataforma. A imagem local recente concede, em tabelas criadas por `postgres`, só `Dxtm` (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN), então a chain aplicada do zero falha (`permission denied for table payments` na suíte da 0081). Capturas fornecidas pelo usuário, sem identificar o ambiente, mostram o `service_role` com todos os privilégios nessas tabelas. Decisão: corrigir o setup de teste, não criar migration de produto -- `supabase/tests/setup/service_role_platform_grants.sql` concede só o que o webhook usa (SELECT em `payments`/`marketplace_withdrawals`; SELECT/INSERT/DELETE em `processed_webhook_events`; SELECT/UPDATE em `subscriptions`) e `service_role_payments_privilege.test.sql` verifica ACL e execução real sob `service_role`. Com o bootstrap: pgTAP 6 arquivos/182 testes (contagem de 2026-10-26, antes desta revisão). Reprodução passo a passo do ensaio isolado: `supabase/tests/README.md`; o bootstrap não é migration de produto nem prova que um ambiente qualquer tenha esses privilégios. **Risco aberto:** um ambiente novo criado com os defaults atuais da plataforma ficaria sem esses privilégios; os outros acessos do cliente admin (fora do webhook) não foram inventariados.

**Pendente / bloqueado.** Fila durável para os 422 de conflito/identidade: primeira fatia local na 0090 (seção abaixo), ainda sem integração na rota; marcas antigas gravadas sem efeito só se recuperam se o Asaas reenviar; inventário de saques afetados exige dados reais; índice único em `provider_transfer_id` depende de inventário de duplicatas. Nada disto valida produção, staging ou o Asaas real.

## Atualização (2026-10-29) -- captura durável de conflitos `TRANSFER_*` (migration `0090`, primeira fatia LOCAL)

**Escopo.** Tabela `marketplace_transfer_conflicts`, RPC `record_marketplace_transfer_conflict` e leitura administrativa. A rota **não** chama a RPC; tela, alerta, resolução financeira, retenção e mudança de HTTP ficam fora (os 422 continuam como estão). Aplicada só no laboratório offline; nada remoto.

**Decisões.**
- Transação própria, separada da financeira: a RPC não lê com lock nem altera saque, saldo, ledger ou `processed_webhook_events`. `SECURITY DEFINER`, `search_path` vazio, `EXECUTE` só para `service_role`.
- Registro com ID próprio; identificadores do provedor (chave recebida, notification id, transfer id) são opcionais e nunca inventados. Cada um vira uma classe (rodada 2): `absent`, `accepted` (formato `[A-Za-z0-9_.:-]`, 1 a 256, guardado exatamente, sem reparo), `excessive` (> 256) ou `invalid` (qualquer outro, inclusive vazio); para `excessive`/`invalid` só a classe é guardada e a captura **não** é recusada. Esse formato é política local de captura, não contrato confirmado do Asaas. Referência inválida e taxa inválida também guardam só a **classe**. Motivo/evento desconhecidos e contrato incoerente (classe x valor de referência/taxa) continuam recusados. Nenhum payload bruto, chave Pix ou dado bancário.
- Agrupamento por igualdade (`NULLS NOT DISTINCT`) dos campos normalizados preservados (motivo, evento, classe e valor de cada identificador, classe da referência, UUID citado, classe e valor da taxa) -- não por hash. Identificadores inválidos/excessivos diferentes caem no mesmo grupo. Diferenças descartadas pela normalização caem no mesmo grupo; não é identidade do evento no provedor.
- `occurrence_count` conta chamadas de registro confirmadas daquele grupo, não entregas do Asaas. Repetição atualiza só contador e última observação.
- Fotografia local da **primeira observação** (imutável): saques com id = UUID citado ou `provider_transfer_id` = transfer id recebido (mesmo inválido/excessivo; o valor é comparado, não gravado), empresa e status derivados do banco, lidos sem lock; nenhum, um ou vários vínculos, com a base de cada um (`reference`/`transfer`/`both`). Nenhum saque é escolhido; correspondência local não prova autoria nem unicidade no provedor.
- Capacidade GLOBAL em janela FIXA (`window_seconds`, alinhada à época) -- não equivale a janela móvel. Política singleton protegida (só owner; nenhum valor na migration): sem ela, `CONFLICT_CAPTURE_POLICY_MISSING`. Repetição não consome vaga. Capturas serializadas por advisory de duas chaves `(20038, 90)`, espaço distinto do lock por transfer id da 0089.
- Erros distinguíveis: `CONFLICT_CAPTURE_INVALID_INPUT`, `CONFLICT_CAPTURE_POLICY_MISSING`, `CONFLICT_CAPTURE_CAPACITY_EXCEEDED`. Para o futuro consumidor: commit confirmado = retorno recebido; rejeição comprovada = um desses erros vindo do banco; timeout/queda/erro genérico do cliente = **resultado desconhecido** (não prova rollback).
- Leitura: `SELECT` para `authenticated` com RLS `is_super_admin()` e `aal = aal2`; empresa dona não lê.

**Validação local offline (2026-10-29).** Laboratório `nf-bootstrap-offline-a01-db` (Postgres 17.6, `network=none`, sem portas), 0090 aplicada sozinha sobre o estado anterior. pgTAP `marketplace_transfer_conflict_capture.test.sql`: RED antes da migration (relação inexistente), depois 56/56 -- inclusive acesso efetivo por papel e claims (`anon` negado; `authenticated` não super_admin e super_admin `aal1` com zero linhas; super_admin `aal2` lê; `service_role` sem SELECT/INSERT direto, apesar de `bypassrls`), rollback do chamador desfazendo registro e vaga, capacidade, repetição sem vaga, fotografia imutável e impressão digital de saques/ledger/marcas. Três mutantes (repetição consumindo vaga, RLS sem `aal2`, escrita em `processed_webhook_events`) foram detectados, cada um em transação revertida. Regressão sequencial: 18/18, 22/22, 40/40, 17/17. Concorrência real (duas sessões READ COMMITTED, bloqueio observado no recurso esperado antes do commit): `c1` (perdedor `CONFLICT_CAPTURE_CAPACITY_EXCEEDED`), `c2` (perdedor `repeated|2`, 1 vaga usada) e regressão `a1`/`a2`/`b1`/`b2` aprovados; testes do harness com cliente simulado 180/180. Fixtures fictícias. Esses resultados são dos hashes da primeira rodada.

**Rodada 2 (2026-10-29).** O laboratório foi retomado depois de uma parada não limpa (SIGKILL após prazo do `docker stop`): recuperação automática pelo WAL, e o estado pós-recuperação (catálogo, objetos da 0090, contagens) conferiu com o do fim da rodada 1. Atualização local registrada nos objetos existentes (sem `CREATE TABLE` nem `IF NOT EXISTS`): três colunas `*_class` preenchidas a partir dos valores já preservados (todos `accepted`), novas checks, chave de agrupamento trocada e função substituída; nenhum registro, política, janela ou fotografia removido. RED: pgTAP sem as colunas novas e sonda mostrando `CONFLICT_CAPTURE_INVALID_INPUT` para `evt bad/1`; GREEN 60/60. Novo cenário `c3` (uma sessão): `TERMINAL_OUTCOME_CONFLICT` real da 0089 -> captura na mesma transação recusada com `25P02` -> rollback confirmado (saque, ledger e marcas inalterados, nada capturado) -> captura em transação nova com commit (fotografia `completed`, base `both`). Prova separação no banco, não integração HTTP/PostgREST nem reenvio do Asaas. Com os hashes finais: sequencial 18/18, 22/22, 40/40, 17/17, 60/60; concorrência `c1`, `c2`, `c3`, `a1`, `a2`, `b1`, `b2` aprovados; harness simulado 193/193. O arquivo completo da 0090 não foi reaplicado do zero nesta rodada (só a atualização local).

**Limites declarados.** Janela entre detecção e captura sem registro; a fila não resolve o conflito, não garante alerta nem atendimento. Sem retenção/limpeza, responsável, prazo ou canal definidos. N e janela de produção não definidos. Nada disto valida produção, grants remotos ou o Asaas.

**Laboratório novo (2026-10-29, concluído).** Banco novo `nf-0090-fresh-20261029-a01` (sem rede, sem portas) com a chain do checkout aplicada do zero e a 0090 **inteira** (rc 0). Primeira rodada: 59/60, falso positivo do teste (UUID aleatório casando `%bad%`); corrigido só no teste (plano 63, três controles). Rodada oficial: 63/63, 18/18, 22/22, 40/40, 17/17; corpo da RPC inalterado (md5 `aae74be0daa44c7d31c03241e1c47fd6`). Commits locais `b91d1a8` e `833e53f`; detalhes e caminho das evidências em `supabase/tests/README.md`. Aquele laboratório não tinha PostgREST (a prova com PostgREST real é de 2026-10-30, na seção da integração abaixo).

## Integração da 0090 na rota (2026-10-29) -- implementada e testada só LOCALMENTE, não publicada

Contrato aprovado após a proposta de mesma data (antes "Proposta — não implementada"). Implementado em `src/app/api/webhooks/asaas/route.ts` com testes em `route.test.ts`; commit LOCAL `184f453` (sem push nem publicação). Prova local real handler→SDK→PostgREST→PostgreSQL em 2026-10-30 (ver "Prova local real" abaixo); continua sem prova de HTTP de entrada, roteamento, deploy do Next.js e Kong (o build local passou depois, em 2026-11-01; ver "Build local" abaixo). A 0089 e a 0090 não mudaram. As seções anteriores ("a rota não chama a RPC") descrevem o estado da época e ficam como histórico.

**Fatos do cliente e da rota (confirmados por leitura).**
- `postgrest-js` 2.110.3: erro HTTP com corpo JSON vira o objeto do PostgREST (com `code`); corpo não-JSON vira `{ message: body }`, sem `code`; falha de rede/timeout/abort vira `error` com `code: ""` e `status: 0` na **resposta** (não no `error`); `.rpc()` é POST e não tem retry automático; `.abortSignal()` repassa o sinal ao `fetch`.
- No fluxo de transferência nada é confirmado na API do Asaas: os argumentos da captura vêm do corpo do webhook; o único dado verificado é local (pré-checagem ou código da 0089).

**A. Resposta HTTP (inalterada).** Pré-checagem recusada → 422. Erro da 0089 cuja `message` contém um dos 5 códigos (mesma ordem de antes), com qualquer `code` → 422. Outro erro da 0089 → 500. Retorno coerente → 200; incoerente → 500. A RPC financeira e seus argumentos não mudaram e não recebem timeout novo.

**B. Elegibilidade para captura.** Só (i) as 3 pré-checagens que recusam sem chamar a 0089 (`p_event_key = null`), ou (ii) erro da 0089 com `code === "P0001"` e `message` exatamente igual a um dos 5 códigos (`p_event_key` = a chave efetivamente enviada à 0089). Indica que a 0089 levantou a exceção; o rollback é o esperado pela semântica do PostgREST -- observado na prova local real só para `TERMINAL_OUTCOME_CONFLICT` (ver abaixo), não para os demais códigos. Um 422 obtido só por `includes` não é capturado (log `transfer_conflict_unverified`).

**C. Captura.** Segunda chamada `.rpc("record_marketplace_transfer_conflict")` (transação própria), aguardada antes da resposta, **nunca repetida**, com `abortSignal` de **3 s** (`CAPTURE_TIMEOUT_MS`; só nela). Recusa, erro, timeout, rejeição inesperada, retorno inválido ou desconhecido **não alteram o 422** e podem deixar o conflito **sem registro durável**; o Sentry (best-effort) não substitui esse registro. Abort/timeout não prova cancelamento da transação no banco: é classificado como desconhecido. Nenhuma linha promete reenvio pelo Asaas após 422 ou 5xx.

| Situação | HTTP | Captura | Log |
|---|---|---|---|
| Pré-checagem recusada (3 ramos) | 422 | sim | conforme o resultado |
| Erro estruturado da 0089 (`P0001` + mensagem exata) | 422 | sim | conforme o resultado |
| Texto contém código, sem `P0001`/mensagem exata | 422 | não | `transfer_conflict_unverified` |
| Erro de transporte ou genérico da 0089 | 500 | não | o de antes |
| Sucesso coerente / incoerente | 200 / 500 | não | o de antes |
| Identificador de tipo incorreto | 422 | não | `transfer_conflict_identifier_type` |
| Captura confirmada (`recorded`⇔1, `repeated`⇔≥2, id UUID) | 422 | -- | `transfer_conflict_captured` |
| Captura recusada (`P0001` + `CONFLICT_CAPTURE_*` exato) | 422 | -- | `transfer_conflict_capture_rejected` |
| Sem resposta HTTP (transporte, timeout, rejeição) | 422 | -- | `transfer_conflict_capture_unknown` |
| Erro com resposta HTTP fora do contrato | 422 | -- | `transfer_conflict_capture_failed` |
| Sem erro, mas retorno ausente/incoerente | 422 | -- | `transfer_conflict_capture_invalid_result` |

Campos dos logs: `event`, `reason` (motivo da 0090) e, conforme o caso, `outcome`, `conflictId`, `occurrenceCount`, `errorCode` (SQLSTATE/PGRST validado, senão `NONE`/`UNRECOGNIZED`; nas recusas, o próprio `CONFLICT_CAPTURE_*` conferido), `status`, `cause` (`transport`/`timeout`/`exception`), `field`/`type`. Nunca payload, identificadores brutos do provedor, mensagem crua, `details`/`hint` ou dados bancários. O log HTTP existente (`asaas_webhook_unprocessable_marketplace_event`) continua igual.

**Argumentos.** `p_reason`: decisão da rota (`provider_transfer_id_mismatch` para o erro da 0089 de mesmo nome, logado no HTTP como `reference_mismatch`). `p_event_type` = `body.event`. `p_notification_id`/`p_provider_transfer_id`: string recebida exatamente (inclusive `""`, com espaços ou > 256 -- a 0090 classifica), `null` só se ausente/null. Referência: ausente/null → `absent`; string UUID → `uuid` com o valor; qualquer outra (inclusive `""`, número, objeto) → `invalid`, sem conteúdo. Taxa: ausente/null → `absent`; `valid` só se número finito **e não negativo antes do arredondamento**, cuja conversão existente `Math.round(fee*100)` dê inteiro ≤ 2147483647; demais → `invalid`, sem valor. Saques, empresa e status ficam com a RPC.

**Identificador de tipo incorreto (decisão aprovada).** A 0090 só recebe `text`/`null`. `body.id` ou `transfer.id` como número, objeto, array ou booleano **não é capturado** (nem convertido, nem mapeado para `null`): o 422 se mantém e o log registra só campo e tipo. Esse conflito fica sem registro durável.

**Validação local (2026-10-29).** TDD com RPCs simuladas -- prova a lógica da rota, não persistência nem PostgREST. RED observado antes de cada mudança de produto: elegibilidade (13 falhas), argumentos (13), resultado da captura (25); depois GREEN. Final: arquivo da rota 135/135 (62 antes), suíte Vitest 211/211 (138 antes), `tsc --noEmit --incremental false` sem erros, lint 0 erros (4 avisos `<img>` preexistentes). Execução offline: config temporária fora do repo com `envDir: false`, variáveis fictícias, `fetch` bloqueado (sonda confirmou). Build não executado nesta rodada (executado depois, em 2026-11-01; ver "Build local" abaixo). Evidências: `D:/Projetos/_recovery/nf-0090-route-20261029T204751Z-2fd64d3c/`. Esses números são da rodada histórica (rota `41ebef80…`, teste `80f120f9…`).

**Controles complementares (2026-10-29, só no teste; rota inalterada, sha256 `41ebef80…`).** (1) Espera efetiva: com a captura simulada mantida pendente, o POST continua pendente depois de um checkpoint do event loop (`setImmediate`) e só responde o mesmo 422/corpo depois que a captura é resolvida (a promessa é resolvida mesmo se uma asserção falhar); o teste de timeout agora também afirma POST pendente antes de 3 s, 422 após o abort, log `transfer_conflict_capture_unknown` e nenhuma chamada repetida. (2) Taxa não finita: `Request` com JSON literal `fee: 1e400` / `-1e400` (o parse dá ±`Infinity`, não `null`) → `p_fee_class = invalid`, `p_fee_cents = null`, 422 preservado, nenhum valor não finito ou texto bruto nos logs. Os novos testes passaram de primeira: validação adicional de comportamento já presente, não correção de produto. RPCs simuladas; sem prova de persistência nem PostgREST. Resultado com o teste `2dde10d1…`: rota 138/138, suíte 211→214/214, `tsc` sem erros, lint 0 erros (4 avisos `<img>` preexistentes). Evidências: `D:/Projetos/_recovery/nf-0090-route-controls-20261029T211840Z-05736293/`.

**Observação (fora do escopo, não corrigida).** Na RPC financeira, a conversão existente `Math.round(fee*100)` transforma `fee` não finito em ±`Infinity`, que o cliente serializa (`JSON.stringify`) como `null` em `p_provider_fee_cents` -- para a 0089 isso equivale a taxa ausente (em `TRANSFER_DONE`, `coalesce(..., 0)`). Comportamento anterior à 0090: conclusão estática, não reproduzida (nem na prova local real), sem ocorrência real confirmada e não corrigida; requer decisão antes de qualquer mudança na lógica financeira.

**Prova local real (2026-10-30 UTC) -- PASS.** `POST()` da rota em `184f453` chamado diretamente, com SDK Supabase, HTTP, PostgREST 16.1 e PostgreSQL 17.6 reais num laboratório novo e isolado, dados e credenciais fictícios. Três entregas, uma chamada cada: (A) sem política, a 0089 respondeu HTTP 400 `P0001`/`TERMINAL_OUTCOME_CONFLICT` e a captura `CONFLICT_CAPTURE_POLICY_MISSING`, com 422/corpo preservados e nada capturado; (B) com política de laboratório, `recorded`, contagem 1, fotografia `single`/`both`/`completed`, visível em sessão independente; (C) mesmo corpo, `repeated`, mesmo UUID, contagem 2, uma vaga. Saque, ledger e marcas iguais ao baseline nas três; marca do FAILED ausente. Exercitou só `TERMINAL_OUTCOME_CONFLICT` e a recusa por política ausente. Não prova HTTP de entrada/roteamento/build/deploy do Next.js nem Kong (um adaptador de `fetch` remove `/rest/v1`); grants de plataforma vieram do setup de teste; política e credenciais do laboratório não são configuração de produção. Detalhes e evidências: `supabase/tests/README.md`.

**Build local (2026-11-01 UTC) -- PASS.** `npm run build` (Next 16.3.6/Turbopack) do commit `0426a46` rc 0, sem OOM, em laboratório Linux novo, com dependências do mesmo lockfile (`npm ci --ignore-scripts`) e saída de rede controlada por fase (instalação só `registry.npmjs.org`, build só as fontes Google); valores Supabase fictícios, sem credenciais. A rota `/api/webhooks/asaas` consta nos manifestos gerados. É validação de build separada: não prova HTTP de entrada, roteamento em execução, Kong nem deploy, e não muda as provas anteriores, que não executaram o build. Detalhes e evidências: `supabase/tests/README.md`.

**Pendências.**
- *Antes de publicar:* valores de `capacity`/`window_seconds` e quem grava a política (sem ela toda captura vira `CONFLICT_CAPTURE_POLICY_MISSING`, 422 sem registro); ordem de deploy (migration e política antes da rota); prova de HTTP de entrada/roteamento do Next.js e do Kong; comportamento de reenvio do Asaas; revisão de segurança. `build`: PASS local de `0426a46` (acima); a regra do AGENTS.md de rodar o build antes de deploy continua valendo para o commit publicado.
- *Cobertura adicional não executada -- exigência a definir pela avaliação de risco/revisão de segurança:* timeout e queda reais, pré-checagem real, capacidade esgotada e demais códigos da 0089 não foram exercitados nesta prova. A necessidade de novas validações antes da publicação deverá ser definida e registrada nessa avaliação. Esta classificação não dispensa testes exigidos por ela nem autoriza publicar.
- *Acompanhamento operacional (não dispensável para ativar em produção):* responsável, canal de atendimento, prazo, alerta sobre os logs de falha/desconhecido, tela e resolução dos conflitos; retenção/limpeza.
- *Futuro:* contrato que represente identificador de tipo incorreto; trocar o `includes` da 0089 por checagem estruturada (mudança de HTTP); o 500 recorrente de `INVALID_EVENT_KEY` quando `body.id` passa de 256 caracteres (anterior à 0090).
