# ADR 0001 — Política para hold expirado vs. pagamento confirmado

- Status: aceita
- Data: 2026-08-28
- Contexto: Fase 4A (fundação de pagamento do marketplace ToursFlow), antes de qualquer integração real com o Asaas

## Contexto

`create_marketplace_booking` (migration 0042) cria uma reserva `pendente` com
`hold_expires_at = now() + 15min`. Enquanto o hold é válido, a vaga conta
contra a capacidade da saída (`check_departure_capacity`) — depois de vencer,
a reserva continua existindo no banco como `pendente` (não há status
`expired`), só deixa de "segurar" a vaga.

Isso cria duas situações distintas que precisam de políticas diferentes, e
que não devem ser confundidas:

1. **Iniciar um pagamento novo** para uma reserva cujo hold já venceu.
2. **Uma confirmação de pagamento chega** (via webhook do Asaas) depois que
   o hold já tinha vencido — por exemplo, o cliente iniciou o PIX a tempo,
   mas levou alguns minutos além dos 15 pra efetivamente pagar.

## Decisão

### 1. Iniciar pagamento com hold vencido → **recusar**

`create_marketplace_payment_attempt` (migration 0052) recusa criar uma nova
tentativa de pagamento (`HOLD_EXPIRED`) se `hold_expires_at` já passou. Não
faz sentido começar a cobrar por uma vaga que já não está mais
garantida — o ToursFlow deve, nesse caso, orientar o cliente a refazer a
reserva (`POST /bookings` de novo) antes de tentar pagar de novo.

Esta é a única parte implementada nesta fase (Fase 4A) — a rota
`POST /api/marketplace/bookings/[id]/payment` já aplica esta regra de
verdade, mesmo sem chamar o Asaas ainda.

### 2. Confirmação de pagamento chega com hold já vencido → **revalidar capacidade atomicamente antes de confirmar**

Decisão para a Fase 4C (webhook reagindo a pagamento de marketplace — ainda
**não implementada**, registrada aqui só como política, para não ser
inventada silenciosamente depois):

Quando o webhook do Asaas confirmar um pagamento, **independente de
`hold_expires_at` já ter vencido ou não**, o handler deve:

1. Revalidar a capacidade da saída atomicamente (reaproveitando a mesma
   trava/lógica de `check_departure_capacity`, dentro de uma transação com
   lock) — nunca assumir que a vaga continua livre só porque estava livre
   quando a reserva foi criada.
2. **Se a capacidade ainda permitir**: confirma a reserva (`status =
   'confirmada'`) normalmente. O hold vencido deixa de ter qualquer efeito —
   um pagamento confirmado sempre "vence" o relógio do hold.
3. **Se a capacidade não permitir mais** (alguém ocupou a vaga nesse meio
   tempo — por exemplo, outra pessoa concluiu uma reserva+pagamento antes):
   **nunca confirmar automaticamente** (overbooking é o pior cenário possível
   para um negócio cuja capacidade é física — um barco real). O pagamento
   fica marcado para tratamento (revisão manual/estorno) — o mecanismo exato
   de sinalização e o fluxo de estorno automático ficam para quando a Fase 4C
   for desenhada; **nenhum refund automático real deve existir antes disso
   ser decidido explicitamente**.

### Alternativas consideradas e rejeitadas

- **Rejeitar sempre uma confirmação atrasada** (nunca honrar um pagamento se
  o hold já venceu, incondicionalmente): rejeitada por ser excessivamente
  restritiva — penalizaria clientes que pagaram de boa fé só porque o
  provedor de pagamento demorou alguns minutos a mais que os 15 do hold,
  prejudicando conversão sem necessidade real (a vaga pode muito bem ainda
  estar livre).
- **Confirmar sempre, ignorando capacidade**: rejeitada por risco de
  overbooking real — inaceitável para um produto onde a capacidade é física.

## Consequências

- A rota de iniciar pagamento (`POST .../payment`) e o futuro handler de
  confirmação (`POST /api/webhooks/asaas`, estendido na Fase 4C) têm
  políticas **deliberadamente diferentes** para "hold vencido" — isso é
  intencional, não inconsistência.
- A Fase 4C precisa reaproveitar a mesma lógica de checagem de capacidade já
  usada em `check_departure_capacity`/`create_marketplace_booking`, não
  reinventar uma segunda forma de contar vagas.
- O estado "pagamento confirmado, mas capacidade não permite" precisa de um
  desenho explícito (sinalização + eventual estorno) antes de a Fase 4C ser
  implementada — não existe ainda, e não deve ser inventado ad-hoc dentro do
  handler do webhook sem essa decisão prévia.

## Adendo (revisão da Fase 4A) — uma reserva não pode ter duas cobranças ativas

Decisão relacionada, adicionada durante a revisão final da Fase 4A: uma
`idempotency_key` sozinha só protege contra reenvio da MESMA tentativa —
sem mais nada, duas tentativas com `idempotency_key`s diferentes para a
MESMA reserva poderiam gerar duas cobranças `pending`/`paid` simultâneas.

**Regra**: no máximo uma tentativa de pagamento **ativa** (`pending` ou
`paid`) por `reservation_id`, ao mesmo tempo — imposta por um `unique index`
parcial (`payments_one_active_per_reservation`, migration `0052`), nunca só
em TypeScript.

**Quando uma nova tentativa (nova `idempotency_key`) é permitida para a
mesma reserva**:
- **`failed`** → permitida (cobrança recusada/expirada no provider é motivo
  legítimo de retry).
- **`refunded`/`partially_refunded`** → permitida (esta constraint não
  julga se uma nova cobrança faz sentido de negócio depois de um estorno,
  só garante que não existam DUAS simultaneamente).
- **`pending`** → bloqueada (já existe uma tentativa em andamento).
- **`paid`** → bloqueada (a reserva já foi paga; nunca duas cobranças pagas
  para a mesma reserva).

Nesta fase (4A), nada transiciona um `payment` para fora de `pending` ainda
(sem webhook de marketplace) — na prática, hoje a constraint bloqueia
qualquer segunda tentativa enquanto a primeira existir, o que é o
comportamento correto até a Fase 4C existir.

**Provider desabilitado não persiste tentativa fantasma**: a checagem de
`MARKETPLACE_PAYMENTS_ENABLED` acontece **antes** de qualquer chamada à RPC
que grava em `payments` — não só antes de chamar o Asaas. Sem isso, uma
tentativa que nunca vai virar cobrança de verdade ocuparia o único slot
`pending`/`paid` permitido por reserva (regra acima) e bloquearia
permanentemente a tentativa real quando o provider for ligado.
