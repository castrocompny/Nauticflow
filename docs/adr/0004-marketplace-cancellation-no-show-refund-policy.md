# ADR 0004 — Cancelamento, no-show, outcome da reserva e motor de reembolso em duas fases

- Status: aceita
- Data: 2026-08-31
- Contexto: próxima etapa financeira do marketplace ToursFlow, depois de payout accounts (`docs/adr/0003-...md`) e do ledger/D+1 (`docs/adr/0002-...md`)

## Objetivo desta etapa

Fechar a lógica de produto e de banco para cancelamento, no-show, outcome da
reserva, fonte real de política de cancelamento por passeio, e o motor de
reembolso -- **sem executar nenhum estorno real**. Migration `0055` (não
aplicada), estende (via `create or replace function`, nunca editando os
arquivos originais) `record_marketplace_payment_confirmed` e
`release_marketplace_reservation_balance` de `0053`.

## Outcome da reserva -- não duplica `reservations.status`

`reservations.status` já representa `confirmada`/`cancelada`/`pendente` --
cancelamento já tem uma fonte de verdade. O que faltava era o RESULTADO
operacional de uma reserva confirmada depois da saída acontecer.
`reservations.outcome` (nullable, `completed`/`no_show`) cobre só esse
espaço -- nunca usado para representar cancelamento. A derivação completa
(`derive_marketplace_reservation_outcome`) é: `status = 'cancelada'` →
`'cancelled'`; senão `outcome` se preenchido; senão `NULL`
(indeterminado -- nenhum refund pode ser calculado sem um dos dois).

## Quem define outcome, e quando

`company_admin`/`staff` podem registrar `completed`/`no_show` na própria
empresa (mesmo corte de autorização do check-in/embarque, que já é uma ação
operacional de baixo risco feita por qualquer um dos dois). Definir um
outcome **diferente** do que já estava definido exige `super_admin`
(proteção contra o operador "mudar de ideia" livremente, incluindo o vetor
descrito na seção seguinte). `company_id`/`role` sempre derivados de
`auth.uid()`, nunca aceitos como parâmetro -- mesmo modelo de IDOR-fechado-
por-construção de `0054`.

**Momento**: nunca antes do horário real da saída. Se existir um pagamento
`paid` pra essa reserva, o relógio é `payments.service_at_snapshot`
(imutável) -- nunca `departures.departs_at` ao vivo, mesmo motivo de
`release_marketplace_reservation_balance`. Sem pagamento (reserva fora do
marketplace), usa `departs_at` diretamente. `OUTCOME_TOO_EARLY` recusa
qualquer tentativa antes disso -- fecha o vetor "marcar no-show cedo pra
tentar acelerar a percepção de receita" (o outcome em si não acelera o
relógio financeiro D+1, que continua sendo só o pagamento+snapshot, mas
mentir sobre o passeio já ter acontecido não deveria ser possível de jeito
nenhum).

## Check-in é evidência, nunca autoridade

`passengers.status = 'embarcado'` continua existindo só como estava (não
alterado nesta migration). Nenhuma RPC desta migration lê, soma ou decide
com base nesse campo -- é dado puramente informativo, mostrado na UI ao
lado dos botões de outcome (contagem de embarcados/ausentes) como contexto
pra decisão HUMANA, nunca como automação. Decisão explícita: um passeio
pode ter passageiros embarcados e ainda assim precisar ser marcado
`no_show` (ex: o grupo todo desistiu na hora), e vice-versa -- não existe
correlação confiável o suficiente pra automatizar sem risco de erro
sistemático.

## Fonte real da política de cancelamento -- achado importante

`tours.cancellation_policy` **já existia** (migration `0039`) -- mas é texto
livre de MARKETING (mesma família de `included`/`not_included`, mostrado na
página pública do passeio), não a estrutura de faixas que o motor de
reembolso usa. Confundir os dois seria um erro real -- coluna nova e
deliberadamente batizada diferente: `tours.marketplace_refund_policy jsonb`
(formato `{tiers: [{hoursBeforeDeparture, customerRefundPercentBasisPoints}]}`,
idêntico ao `CancellationPolicy` de `src/lib/marketplace-ledger.ts`).
Validada por trigger (`is_valid_marketplace_refund_policy`, espelha
`isValidCancellationPolicy` da mesma forma que toda dupla implementação
deste projeto) -- percentual 0-10000, faixas estritamente decrescentes, sem
sobreposição. **Nenhum percentual oficial definido nesta migration** -- a
coluna nasce `NULL` em todo passeio existente.

## Snapshot -- congelado na confirmação, nunca depois

`record_marketplace_payment_confirmed` (estendida) passa a ler
`tours.marketplace_refund_policy` (via `departure -> tour`) e gravar em
`payments.cancellation_policy_snapshot` no MESMO instante em que já congela
`service_at_snapshot` -- ambos protegidos pelo MESMO trigger de
imutabilidade (`trg_payments_financial_snapshot_immutable`, `0053`,
hardening). Uma mudança futura na política do passeio nunca afeta uma
venda já confirmada. Se o passeio não tiver política configurada no
momento da confirmação, o snapshot fica `NULL` -- o pagamento é confirmado
normalmente (pagar não depende de ter política de cancelamento), só um
reembolso que dependa de cálculo por faixa falhará fechado depois
(`INVALID_POLICY_SNAPSHOT`).

## Legal override -- só admin, sempre com motivo registrado

Mecanismo já desenhado no ADR `0002` (`legalOverride` sempre vence a
política comercial) -- esta revisão fecha QUEM pode acioná-lo:
exclusivamente `super_admin` (nunca o operador da própria empresa,
`FORBIDDEN_LEGAL_OVERRIDE` caso tente), sempre com `legal_override_reason`
não-vazio (`LEGAL_OVERRIDE_REASON_REQUIRED`), `legal_override_authorized_by
= auth.uid()` e `created_at` da própria linha -- reason/quem
autorizou/quando ficam registrados em `marketplace_refunds`, sem nenhum
dado pessoal do cliente além do que já existe na reserva.

## Motor de reembolso -- consolidado, sem mudança na fórmula

`calculateRefund()` (`src/lib/marketplace-ledger.ts`) não mudou --
`calculate_marketplace_refund_amounts` (SQL, `0055`) é o único lugar que
espelha a fórmula, chamado tanto pelo preview quanto pela criação do
pedido, nunca duplicado uma terceira vez. Entradas/saídas em centavos
inteiros, nunca float -- mesmo princípio de todo o projeto.

## Ciclo de vida do reembolso -- duas fases, mesmo padrão do saque

**Por que duas fases**: uma integração real com o provider é
necessariamente assíncrona (o Asaas confirma um estorno depois, não na hora
da chamada) -- modelar o reembolso como uma ação síncrona e final (como a
primeira versão em `0053`, `record_marketplace_refund`) não sobrevive a
essa realidade. `create_marketplace_refund_request` **reserva** o impacto
financeiro imediatamente (move o valor do bucket de origem pra
`refund_pending`, novo bucket que espelha `withdrawal_pending`) e cria uma
linha em `marketplace_refunds` (`pending`). `complete_marketplace_refund_
request` fecha o ciclo, só quando chamado (Fase futura, quando existir uma
confirmação real do provider): `succeeded=true` remove de `refund_pending`
sem destino (dinheiro saiu do sistema pra valer); `succeeded=false` devolve
pro bucket de origem -- o reembolso simplesmente não aconteceu.

`record_marketplace_refund` (`0053`, síncrona) fica **preservada como
está, mas não é mais chamada por nenhum código novo** -- não editada (não
podia ser), não removida (romperia o princípio de nunca editar migration
aplicada), documentada aqui como superada pela versão em duas fases.

## Nunca saldo negativo -- `manual_review` em vez de criar dívida

Mesma decisão do ADR `0002` (sem modelo de dívida ainda): se o valor a
deduzir não cabe no bucket calculado (`blocked` remanescente da reserva, ou
`available` da empresa inteira) -- incluindo o caso extremo de o saldo já
ter sido inteiramente sacado (`transferred`) --, o pedido nasce direto em
`status = 'manual_review'`, **sem tocar o ledger**. Não é um erro que
bloqueia a operação -- é um estado explícito, pra alguém resolver
manualmente numa rodada futura (sem mecanismo de resolução implementado
ainda, documentado como pendência).

## Concorrência -- mesmas duas travas de `0053`

`create_marketplace_refund_request` adquire, na mesma ordem fixa de
`record_marketplace_refund` (`0053`): trava por COMPANY
(`marketplace_withdrawal`, mesma chave de `create_marketplace_withdrawal`)
sempre, e trava por RESERVA (`marketplace_reservation_balance`, mesma
chave de `release_marketplace_reservation_balance`) sempre. Nenhuma trava
nova foi inventada -- reaproveita as duas já existentes, garantindo que
saque, release e refund nunca consomem o mesmo centavo duas vezes,
independente da combinação de operações concorrentes.

## `release_marketplace_reservation_balance` -- recusa com refund em aberto

Extensão desta revisão: **nunca libera enquanto existir um
`marketplace_refunds` com `status in ('pending', 'processing',
'manual_review')`** pra mesma reserva (`REFUND_PENDING`). "Completed" segue
pro release normalmente SE não houver nenhum reembolso em aberto -- a
condição verifica isso explicitamente, não assume nada por omissão.

## Idempotência

`create_marketplace_refund_request`: `idempotency_key` própria + unique
index, checado ANTES de qualquer trava/cálculo (mesmo padrão de saque).
`complete_marketplace_refund_request`: idempotente por `status` (só age em
`pending`/`processing`, replay em qualquer outro estado é no-op). Ambas
testadas explicitamente -- replay não duplica débito nem crédito em
nenhum dos dois casos.

## Origem do cancelamento -- vocabulário fechado, nunca string livre

`cancelled_by_type` (`customer`/`operator`/`system`/`admin`) é **derivado**
da role de quem chama a RPC (`super_admin` → `admin`; `company_admin`/
`staff` → `operator`) -- nunca aceito como parâmetro. `customer`/`system`
existem no vocabulário pra quando houver origem real (ToursFlow, ou um
gatilho automático futuro) -- nenhuma RPC desta migration ainda produz
esses dois valores. `reason_code` é aceito como parâmetro, mas restrito a
um vocabulário fechado de 6 valores (nunca texto livre) -- é só uma
etiqueta de classificação/auditoria, não influencia o cálculo financeiro,
então aceitar a escolha de quem chama (dentro do vocabulário) não é um
risco de segurança.

## Saída cancelada -- razão distinta, sem gatilho automático ainda

`reason_code = 'departure_cancelled'` existe no vocabulário especificamente
pra esse caso (distinto de `customer_cancellation`/`operator_cancellation`,
que são cancelamentos individuais de UMA reserva). **Nenhum gatilho
automático existe ainda** que dispare reembolsos em massa quando uma saída
inteira é marcada `cancelada` -- fica como contrato/vocabulário pronto,
não implementado. Nenhum percentual oficial diferenciado foi definido pra
este caso.

## Cancelamento pelo cliente -- sem UI ToursFlow nesta fase

Não implementado. `cancelled_by_type = 'customer'` existe no vocabulário,
mas nenhuma rota/RPC server-to-server foi criada pra isso -- o ToursFlow
não foi alterado, conforme instrução explícita desta etapa.

## UI NauticFlow -- mínima, sem botão de reembolso real

`/reservas/[id]`: botões "Marcar concluído"/"Marcar no-show" (chamam
`set_marketplace_reservation_outcome`), com contagem de embarcados/ausentes
mostrada como contexto informativo, badge do outcome atual, mensagens de
erro claras (`OUTCOME_TOO_EARLY`, override negado). Nenhum botão de
cancelamento/reembolso foi adicionado -- decisão explícita desta etapa
(`create_marketplace_refund_request`/`complete_marketplace_refund_request`
existem e são testadas, mas não têm nenhuma superfície de UI que as
invoque ainda). Exibição legível da política de cancelamento aplicável
(mencionada como "avaliar inclusão mínima") foi **deliberadamente
adiada** pra manter o escopo desta etapa gerenciável -- registrada como
pendência de UI, não uma omissão silenciosa.

## Segurança

Todas as RPCs novas são `SECURITY DEFINER`, com `company_id`/`role`
sempre derivados de `auth.uid()` (nunca parâmetro) -- IDOR estruturalmente
fechado, mesmo modelo de `0054`. Mutações financeiras
(`create_marketplace_refund_request`/`complete_marketplace_refund_request`)
restritas a `company_admin`/`super_admin` (staff não mexe em dinheiro,
mesmo corte do painel financeiro). `set_marketplace_reservation_outcome`
(operacional, não financeira) permite `staff` também, conforme pedido
explícito desta etapa.

## Pendências explícitas desta fase

- Resolução de pedidos em `manual_review` -- nenhum mecanismo implementado ainda (nem UI, nem RPC).
- `record_marketplace_refund` (`0053`, síncrona) permanece no banco, superada mas não removida -- nenhum código novo a chama.
- Gatilho automático de reembolso quando uma saída inteira é cancelada -- vocabulário pronto (`reason_code='departure_cancelled'`), sem implementação.
- Cancelamento originado pelo cliente via ToursFlow -- sem contrato de API ainda, ToursFlow não alterado.
- Exibição da política de cancelamento aplicável na UI do NauticFlow -- adiada.
- Percentuais reais de política de cancelamento -- ainda nenhum tour tem `marketplace_refund_policy` configurada; nenhum valor oficial definido.
- Taxas do provider Asaas em reembolso -- pendência já registrada no ADR `0002`, ainda não endereçada.
- Ativação real de qualquer coisa desta fase depende da Fase de integração real com o Asaas (webhook de confirmação de estorno assíncrono).
