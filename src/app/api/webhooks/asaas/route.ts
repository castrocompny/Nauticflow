import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logSecurityEvent } from "@/lib/security-log";
import { verifyAsaasPaymentSettled } from "@/lib/asaas";

// Recebe as notificacoes de pagamento do Asaas (evento PAYMENT_CONFIRMED/PAYMENT_RECEIVED)
// e renova a assinatura da empresa correspondente automaticamente. TAMBÉM recebe (a
// partir da etapa de saque do marketplace, ver docs/adr/0005-marketplace-withdrawal-and-
// pix-payout.md) as notificacoes de TRANSFERÊNCIA (saque Pix do operador) -- os dois
// fluxos são INDEPENDENTES, distinguidos pelo corpo trazer `payment` ou `transfer`.
//
// Usa a service_role key (bypassa RLS) porque quem chama aqui e o Asaas, nao um usuario
// logado com sessao — nao ha como usar o client normal (baseado em cookies) nesse caso.
// A autenticidade da chamada e verificada pelo header asaas-access-token, configurado
// igual nos dois lados (aqui e no painel de Webhooks do Asaas) -- MESMA verificação pros
// dois fluxos, nunca duplicada.
//
// Eventos de TRANSFERÊNCIA (revisão desta etapa contra o contrato oficial do
// Asaas, POST /v3/transfers) -- os 7 eventos documentados, nenhum nome
// inventado: TRANSFER_CREATED, TRANSFER_PENDING, TRANSFER_IN_BANK_PROCESSING,
// TRANSFER_BLOCKED, TRANSFER_DONE, TRANSFER_FAILED, TRANSFER_CANCELLED. Nunca
// assume uma sequência obrigatória entre eles -- cada evento é tratado pelo
// que ELE diz, não pelo que "deveria" ter vindo antes.

const RELEVANT_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);

// Status do Asaas (consultados na API, nunca lidos do corpo do webhook) que
// contam como cobrança paga. Assinatura SaaS: CONFIRMED (cartão aprovado, ainda
// não caiu na conta) renova, igual já acontecia com o evento PAYMENT_CONFIRMED.
// Marketplace: só RECEIVED -- dinheiro efetivamente na conta, nunca
// RECEIVED_IN_CASH (baixa manual no painel, sem dinheiro passando pelo Asaas).
const SAAS_SETTLED_STATUSES = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"] as const;
const MARKETPLACE_SETTLED_STATUSES = ["RECEIVED"] as const;

// PIX DO CLIENTE (marketplace) -- MESMOS nomes de evento PAYMENT_CONFIRMED/
// PAYMENT_RECEIVED do fluxo SaaS acima (Asaas não distingue "tipo" de
// pagamento no nome do evento) + os 3 eventos de estorno. Distinguir os dois
// fluxos NUNCA é pelo nome do evento -- é por payment.externalReference
// corresponder a uma linha real em public.payments (marketplace) ou não
// (nesse caso cai pro fluxo SaaS, que trata externalReference como
// company_id). Ver handleMarketplacePaymentEvent.
const MARKETPLACE_PAYMENT_EVENTS = new Set([
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_DELETED",
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_DENIED",
]);

const REFUND_EVENTS = new Set(["PAYMENT_REFUND_IN_PROGRESS", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_REFUND_DENIED"]);

// Eventos intermediários -- nunca definitivos, sempre mantêm o saque em
// 'processing' sem tocar o ledger (o valor continua reservado em
// withdrawal_pending). TRANSFER_BLOCKED está aqui de propósito -- não é uma
// falha, é uma checagem/retenção do banco que ainda pode resolver pros dois
// lados, então NUNCA devolve o saldo enquanto só isso chegou.
const IN_PROGRESS_TRANSFER_EVENTS = new Set(["TRANSFER_CREATED", "TRANSFER_PENDING", "TRANSFER_IN_BANK_PROCESSING", "TRANSFER_BLOCKED"]);
// Desfechos definitivos -- únicos que chamam finalize_marketplace_withdrawal.
const TERMINAL_TRANSFER_EVENTS: Record<string, "completed" | "failed" | "cancelled"> = {
  TRANSFER_DONE: "completed",
  TRANSFER_FAILED: "failed",
  TRANSFER_CANCELLED: "cancelled",
};

// comparacao em tempo constante -- "!==" normal vaza, por timing, quantos caracteres
// iniciais bateram, o que teoricamente ajuda um atacante a adivinhar o token aos poucos
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Chave de idempotência POR EVENTO (fluxos de marketplace e transferência):
// o id da notificação (`body.id`) quando o Asaas manda -- reenvio do mesmo
// evento traz o mesmo id. Sem ele, `${event}:${id do objeto}` -- nunca o id do
// objeto cru, que faria eventos DIFERENTES do mesmo pagamento/transferência
// colidirem (ex: PAYMENT_CONFIRMED gravando payment.id e o PAYMENT_RECEIVED
// seguinte, o que liquida, sendo descartado como "duplicado"). O prefixo com o
// nome do evento também nunca colide com a chave do fluxo SaaS (payment.id
// cru, migration 0079) nem com um id de notificação.
function perEventKey(event: string, notificationId: string | undefined, providerObjectId: string): string {
  return notificationId ? notificationId : `${event}:${providerObjectId}`;
}

// Evento que pertence a um objeto LOCAL (saque/payment do marketplace) mas
// chega sem os campos necessários para processá-lo, ou com referência que não
// confere (migration 0086, item H). Nunca 200 silencioso: 422 (não-2xx, o
// Asaas registra a falha e reenvia) + log. Não grava marca nem efeito -- não
// há como aplicá-lo com segurança; precisa de análise humana.
function unprocessableMarketplaceEvent(event: string, kind: "transfer" | "payment", reason: string) {
  logSecurityEvent("asaas_webhook_unprocessable_marketplace_event", { event, kind, reason });
  return NextResponse.json({ error: "unprocessable_marketplace_event" }, { status: 422 });
}

export async function POST(request: Request) {
  const token = request.headers.get("asaas-access-token");
  const secret = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!secret || !token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const event = body?.event as string | undefined;
  const payment = body?.payment;
  const transfer = body?.transfer;
  // id do EVENTO em si (envelope da notificação, distinto de transfer.id/
  // payment.id) -- chave de idempotência dos fluxos de transferência e de
  // marketplace, ver perEventKey.
  const notificationId = typeof body?.id === "string" && body.id.length > 0 ? (body.id as string) : undefined;

  if (event && transfer && (IN_PROGRESS_TRANSFER_EVENTS.has(event) || event in TERMINAL_TRANSFER_EVENTS)) {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    return handleTransferEvent(supabase, event, transfer, notificationId);
  }

  if (event && payment && MARKETPLACE_PAYMENT_EVENTS.has(event)) {
    const internalPaymentId = payment.externalReference as string | undefined;
    // payments.id é uuid -- externalReference fora desse formato nunca é uma
    // linha de payments (e consultar geraria erro de cast, 5xx em loop).
    if (internalPaymentId && UUID_RE.test(internalPaymentId)) {
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      // só entra no fluxo marketplace se externalReference corresponder a
      // uma linha REAL de payments -- nunca assume pelo nome do evento
      // sozinho (que é idêntico ao do fluxo SaaS).
      const { data: marketplacePayment, error: lookupError } = await supabase
        .from("payments")
        .select("id")
        .eq("id", internalPaymentId)
        .maybeSingle();
      if (lookupError) {
        // sem saber se é marketplace, não pode cair no fluxo SaaS (o pagamento
        // seria tratado como company_id errado e descartado com 200) -- 5xx
        // pro Asaas reenviar; nada foi gravado ainda.
        logSecurityEvent("asaas_webhook_payment_lookup_failed", { event, paymentId: payment.id, errorCode: lookupError.message.slice(0, 64) });
        return NextResponse.json({ error: "payment_lookup_failed" }, { status: 500 });
      }
      if (marketplacePayment) {
        return handleMarketplacePaymentEvent(supabase, event, payment, notificationId);
      }
    }

    // externalReference não aponta para um payment nosso -- mas a COBRANÇA
    // pode ser de um payment local (externalReference ausente/divergente).
    // Nesse caso o evento afeta um payment nosso e nunca é descartado com 200
    // nem cai no fluxo SaaS (migration 0086, item H). Cobrança desconhecida
    // segue o caminho de antes (SaaS ou evento irrelevante).
    const providerPaymentId = typeof payment.id === "string" && payment.id.length > 0 ? payment.id : undefined;
    if (providerPaymentId) {
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: byCharge, error: chargeLookupError } = await supabase
        .from("payments")
        .select("id")
        .eq("provider_payment_id", providerPaymentId)
        .limit(1);
      if (chargeLookupError) {
        logSecurityEvent("asaas_webhook_payment_lookup_failed", { event, paymentId: providerPaymentId, errorCode: chargeLookupError.message.slice(0, 64) });
        return NextResponse.json({ error: "payment_lookup_failed" }, { status: 500 });
      }
      if (Array.isArray(byCharge) && byCharge.length > 0) {
        return unprocessableMarketplaceEvent(event, "payment", "reference_mismatch");
      }
    }
  }

  if (!event || !payment || !RELEVANT_EVENTS.has(event)) {
    return NextResponse.json({ ok: true });
  }

  const companyId = payment.externalReference as string | undefined;
  if (!companyId) return NextResponse.json({ ok: true });

  const paymentId = payment.id as string | undefined;
  if (!paymentId) return NextResponse.json({ ok: true });

  // confirma no próprio Asaas ANTES da marca de dedupe -- se a consulta falhar
  // por instabilidade, o evento não fica marcado como processado e o reenvio
  // do Asaas ainda consegue renovar (ver verifyAsaasPaymentSettled).
  const verification = await verifyAsaasPaymentSettled({
    providerPaymentId: paymentId,
    expectedExternalReference: companyId,
    acceptedStatuses: SAAS_SETTLED_STATUSES,
  });
  if (!verification.ok) {
    logSecurityEvent("asaas_webhook_payment_not_verified", { flow: "saas", event, paymentId, reason: verification.reason });
    if (verification.retryable) return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
    return NextResponse.json({ ok: true });
  }

  // externalReference do SaaS é sempre o company_id (uuid) gravado por
  // createSubscription -- qualquer outra coisa nunca vai casar com uma empresa,
  // então é ignorada (e logada) em vez de virar erro de cast no banco e 5xx em loop.
  if (!UUID_RE.test(companyId)) {
    logSecurityEvent("asaas_webhook_invalid_company_reference", { flow: "saas", event, paymentId });
    return NextResponse.json({ ok: true });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // idempotência + renovação numa única transação (migration 0079): a marca
  // (provider, payment.id) da 0037 só fica gravada se a renovação também
  // ficar. Reenvio da mesma notificação, ou PAYMENT_CONFIRMED seguido de
  // PAYMENT_RECEIVED do mesmo pagamento, volta 'duplicate' e nunca soma o prazo
  // duas vezes. Qualquer erro desfaz tudo e responde 5xx -- o Asaas reenvia e
  // o evento é processado de novo, nunca fica "marcado mas não renovado".
  const { data: renewal, error: renewalError } = await supabase.rpc("renew_subscription_from_asaas_payment", {
    p_company_id: companyId,
    p_provider_payment_id: paymentId,
    p_event_type: event,
  });
  if (renewalError) {
    logSecurityEvent("asaas_webhook_renewal_failed", { flow: "saas", event, paymentId, errorCode: renewalError.message.slice(0, 64) });
    return NextResponse.json({ error: "renewal_failed" }, { status: 500 });
  }
  if (renewal === "duplicate") return NextResponse.json({ ok: true, duplicate: true });
  if (renewal === "no_subscription") {
    // pagamento confirmado no Asaas pra uma empresa sem assinatura -- nada foi
    // gravado (nem a marca de dedupe), então um reenvio depois de corrigir o
    // cadastro ainda renova. Não pede reenvio automático (não se resolve
    // sozinho e pausaria a fila de webhooks do Asaas); fica pro log/revisão.
    logSecurityEvent("asaas_webhook_subscription_not_found", { flow: "saas", event, paymentId, companyId });
    return NextResponse.json({ ok: true, ignored: "no_subscription" });
  }
  if (renewal !== "renewed") {
    logSecurityEvent("asaas_webhook_renewal_failed", { flow: "saas", event, paymentId, errorCode: "UNEXPECTED_RESULT" });
    return NextResponse.json({ error: "renewal_failed" }, { status: 500 });
  }

  // sem o "force-dynamic" global no layout, precisa disso pra sidebar/topbar da empresa
  // mostrarem o plano/vencimento renovados na próxima navegação, e não o dado antigo em cache
  revalidatePath("/dashboard", "layout");

  return NextResponse.json({ ok: true });
}

// Saque do operador (marketplace) -- AUTORIDADE FINAL do status de uma
// transferência é este webhook, nunca a resposta síncrona do POST que a
// criou (que só marca 'processing', ver mark_marketplace_withdrawal_
// processing). withdrawal_id vem de transfer.externalReference -- é o id
// INTERNO do saque (marketplace_withdrawals.id), nunca a chave Pix.
//
// IDEMPOTÊNCIA POR EVENTO, NÃO POR TRANSFERÊNCIA: uma transferência real
// dispara VÁRIOS eventos distintos ao longo do ciclo de vida (CREATED,
// PENDING, IN_BANK_PROCESSING, possivelmente BLOCKED, e por fim DONE/FAILED/
// CANCELLED). A chave é o id do EVENTO (`body.id`) quando presente; sem ele,
// `${event}:${transfer.id}` (ver perEventKey) -- só o reenvio do MESMO evento
// colide, nunca CREATED contra DONE da mesma transferência.
//
// ATOMICIDADE (migration 0085): marca de dedupe + efeito numa única RPC
// transacional, process_marketplace_transfer_webhook_event. Qualquer erro
// desfaz os dois e a rota responde 5xx -- o retry do Asaas reaplica. A marca
// nunca é gravada aqui, e o efeito roda sempre (idempotente pelo estado do
// saque), então uma marca legada sem efeito não bloqueia a recuperação.
async function handleTransferEvent(
  supabase: SupabaseClient,
  event: string,
  transfer: Record<string, unknown>,
  notificationId: string | undefined
) {
  const providerTransferId = typeof transfer.id === "string" && transfer.id.length > 0 ? transfer.id : undefined;
  const rawReference = typeof transfer.externalReference === "string" && transfer.externalReference.length > 0
    ? transfer.externalReference
    : undefined;
  // marketplace_withdrawals.id é uuid -- qualquer outra coisa nunca é um saque
  // nosso (e viraria erro de cast no banco, 5xx em loop).
  const withdrawalId = rawReference && UUID_RE.test(rawReference) ? rawReference : undefined;

  if (!providerTransferId || !withdrawalId) {
    // Sem os dois campos não há como aplicar o evento. Só é descartável com
    // 200 se NÃO for de um saque nosso -- pelo externalReference (uuid) ou
    // pelo id da transferência já gravado num saque (migration 0086, item H).
    const { data: local, error: lookupError } = withdrawalId
      ? await supabase.from("marketplace_withdrawals").select("id").eq("id", withdrawalId).limit(1)
      : providerTransferId
        ? await supabase.from("marketplace_withdrawals").select("id").eq("provider_transfer_id", providerTransferId).limit(1)
        : { data: [], error: null };
    if (lookupError) {
      logSecurityEvent("asaas_webhook_transfer_lookup_failed", { event, errorCode: lookupError.message.slice(0, 64) });
      return NextResponse.json({ error: "reference_lookup_failed" }, { status: 500 });
    }
    if (Array.isArray(local) && local.length > 0) {
      return unprocessableMarketplaceEvent(event, "transfer", withdrawalId ? "missing_transfer_id" : "reference_mismatch");
    }
    if (rawReference && !withdrawalId) logSecurityEvent("asaas_webhook_invalid_withdrawal_reference", { event });
    return NextResponse.json({ ok: true });
  }

  const eventKey = perEventKey(event, notificationId, providerTransferId);
  const isTerminal = event in TERMINAL_TRANSFER_EVENTS;
  const providerFeeCents =
    TERMINAL_TRANSFER_EVENTS[event] === "completed" && typeof transfer.fee === "number"
      ? Math.round((transfer.fee as number) * 100)
      : null;

  // Eventos intermediários (BLOCKED inclusive) só levam pending -> processing,
  // nunca tocam o ledger; terminais chamam finalize_marketplace_withdrawal --
  // códigos/mensagens de falha seguros agora ficam na RPC (mesmos textos).
  const { data, error } = await supabase.rpc("process_marketplace_transfer_webhook_event", {
    p_event_key: eventKey,
    p_event_type: event,
    p_withdrawal_id: withdrawalId,
    p_provider_transfer_id: providerTransferId,
    p_provider_fee_cents: providerFeeCents,
  });
  if (error) {
    logSecurityEvent("asaas_webhook_transfer_failed", { event, errorCode: error.message.slice(0, 64) });
    return NextResponse.json({ error: "transfer_processing_failed" }, { status: 500 });
  }

  const result = parseTransferResult(data, withdrawalId, event);
  if (!result) {
    logSecurityEvent("asaas_webhook_transfer_unconfirmed", { event });
    return NextResponse.json({ error: "transfer_processing_unconfirmed" }, { status: 500 });
  }
  if (result.outcome === "withdrawal_not_found") {
    logSecurityEvent("asaas_webhook_withdrawal_not_found", { event });
  }

  if (isTerminal) revalidatePath("/financeiro");
  return NextResponse.json({ ok: true });
}

const FINAL_WITHDRAWAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

// Resultados permitidos de process_marketplace_transfer_webhook_event
// (0085/0086): exatamente uma linha do mesmo saque, marker_reused booleano e
// status coerente com evento + desfecho (0086, item E):
//   - qualquer evento: withdrawal_not_found com status nulo;
//   - intermediário: in_progress com o saque já fora de pending (processing,
//     ou final quando o evento chega tarde);
//   - terminal: finalized com EXATAMENTE o status do evento (DONE ->
//     completed, FAILED -> failed, CANCELLED -> cancelled), ou already_final
//     com qualquer status final (o primeiro desfecho vence).
function parseTransferResult(data: unknown, withdrawalId: string, event: string): { outcome: string } | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;
  if (typeof row.withdrawal_id !== "string" || row.withdrawal_id.toLowerCase() !== withdrawalId.toLowerCase()) return null;
  if (typeof row.marker_reused !== "boolean") return null;

  const { outcome, withdrawal_status: status } = row;
  if (outcome === "withdrawal_not_found") return status === null ? { outcome } : null;
  if (typeof status !== "string") return null;

  const target = TERMINAL_TRANSFER_EVENTS[event];
  if (!target) {
    return outcome === "in_progress" && (status === "processing" || FINAL_WITHDRAWAL_STATUSES.has(status)) ? { outcome } : null;
  }
  if (outcome === "finalized") return status === target ? { outcome } : null;
  if (outcome === "already_final") return FINAL_WITHDRAWAL_STATUSES.has(status) ? { outcome } : null;
  return null;
}

type SettlementResult = {
  payment_id: string;
  status: "paid" | "pending" | "failed";
  is_replay: boolean;
  requires_manual_review: boolean;
  marker_reused: boolean;
  payment_exception_id: string | null;
};

// Resultados de sucesso PERMITIDOS de settle_marketplace_payment_received_once
// (0081/0082) -- exatamente uma linha, do mesmo pagamento, flags booleanas:
//   - liquidação normal ou replay (0059): status 'paid', sem exceção;
//   - valor divergente (0059): status 'pending' + requires_manual_review
//     (manual_review já gravado em marketplace_refunds), sem exceção;
//   - exceção durável (0082): status 'failed' + requires_manual_review +
//     payment_exception_id uuid.
// Qualquer outro formato devolve null -- a rota trata como não confirmado.
// payment_exception_id ausente equivale a null (retorno da 0081 sem a 0082).
function parseSettlementResult(data: unknown, internalPaymentId: string): SettlementResult | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;
  // uuid comparado na forma canônica: externalReference aceito em maiúsculas
  // (UUID_RE é case-insensitive) volta do PostgreSQL em minúsculas.
  if (typeof row.payment_id !== "string" || row.payment_id.toLowerCase() !== internalPaymentId.toLowerCase()) return null;
  if (typeof row.is_replay !== "boolean" || typeof row.requires_manual_review !== "boolean" || typeof row.marker_reused !== "boolean") {
    return null;
  }
  const exceptionId = row.payment_exception_id ?? null;
  if (exceptionId !== null && (typeof exceptionId !== "string" || !UUID_RE.test(exceptionId))) return null;

  const status = row.status;
  const valid =
    exceptionId === null
      ? status === "paid" || (status === "pending" && row.requires_manual_review)
      : status === "failed" && row.requires_manual_review;
  if (!valid) return null;

  return {
    payment_id: row.payment_id,
    status: status as SettlementResult["status"],
    is_replay: row.is_replay,
    requires_manual_review: row.requires_manual_review,
    marker_reused: row.marker_reused,
    payment_exception_id: exceptionId,
  };
}

// PIX do cliente (marketplace) -- ver docs/adr/0007-marketplace-pix-payment-
// settlement.md. Idempotência POR EVENTO (mesmo motivo/mesmo padrão de
// handleTransferEvent acima) -- uma cobrança real passa por CONFIRMED e
// depois por RECEIVED, cada evento processável uma vez; nunca deduplicado
// só por payment.id (que travaria os dois eventos legítimos um contra o
// outro).
async function handleMarketplacePaymentEvent(
  supabase: SupabaseClient,
  event: string,
  payment: Record<string, unknown>,
  notificationId: string | undefined
) {
  // externalReference já confirmado como payment local pelo chamador.
  const internalPaymentId = payment.externalReference as string;
  const providerPaymentId = typeof payment.id === "string" && payment.id.length > 0 ? payment.id : undefined;
  // sem a cobrança não há como conferir a identidade (0086, item A) nem
  // aplicar o evento -- nunca 200 silencioso para um payment nosso.
  if (!providerPaymentId) return unprocessableMarketplaceEvent(event, "payment", "missing_payment_id");

  const eventKey = perEventKey(event, notificationId, providerPaymentId);

  // PAYMENT_RECEIVED é o único evento que move dinheiro (liquida e credita o
  // ledger) -- confirmado no Asaas ANTES da marca de dedupe, mesmo motivo do
  // fluxo SaaS. O valor liquidado passa a ser o que a API do Asaas devolve,
  // nunca o `payment.value` do corpo do webhook.
  let verifiedAmountCents: number | null = null;
  if (event === "PAYMENT_RECEIVED") {
    const verification = await verifyAsaasPaymentSettled({
      providerPaymentId,
      expectedExternalReference: internalPaymentId,
      acceptedStatuses: MARKETPLACE_SETTLED_STATUSES,
    });
    if (!verification.ok) {
      logSecurityEvent("asaas_webhook_payment_not_verified", {
        flow: "marketplace",
        event,
        paymentId: internalPaymentId,
        reason: verification.reason,
      });
      if (verification.retryable) return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
      return NextResponse.json({ ok: true });
    }
    verifiedAmountCents = verification.valueCents;

    // ÚNICO gatilho financeiro real -- marca de dedupe + settle_marketplace_
    // payment_received (migration 0059) numa ÚNICA transação (migration 0081).
    // A marca NUNCA é gravada fora dela: se a liquidação falhar, tudo é
    // desfeito e a rota responde 5xx pro Asaas reenviar. Uma marca já
    // existente (inclusive gravada pelo código antigo antes do efeito) NÃO
    // pula a liquidação -- ela é idempotente e roda sempre. O amount é o valor
    // confirmado pela API do Asaas, nunca o `payment.value` do corpo.
    const { data: settleData, error: settleError } = await supabase.rpc("settle_marketplace_payment_received_once", {
      p_event_key: eventKey,
      p_event_type: event,
      p_internal_payment_id: internalPaymentId,
      p_provider_payment_id: providerPaymentId,
      p_confirmed_amount_cents: verifiedAmountCents,
    });
    if (settleError) {
      // nunca falha silenciosamente -- loga sem PII/payload bruto (só o
      // código de erro, truncado por segurança).
      logSecurityEvent("marketplace_payment_settlement_error", {
        paymentId: internalPaymentId,
        errorCode: settleError.message.slice(0, 64),
      });
      return NextResponse.json({ error: "settlement_failed" }, { status: 500 });
    }

    // sem erro não basta: só responde 200 com uma confirmação válida de que a
    // transação persistiu (ver parseSettlementResult). Qualquer outra coisa
    // (data vazia/nula, outro pagamento, estado desconhecido) é 5xx retryable.
    const settled = parseSettlementResult(settleData, internalPaymentId);
    if (!settled) {
      logSecurityEvent("marketplace_payment_settlement_unconfirmed", { paymentId: internalPaymentId });
      return NextResponse.json({ error: "settlement_unconfirmed" }, { status: 500 });
    }

    // payment local já 'failed' (hold expirado cancelado) e o Asaas confirmou
    // RECEIVED: a RPC (migration 0082) registrou uma exceção de pagamento na
    // fila administrativa, na mesma transação da marca -- nenhum efeito
    // financeiro.
    if (settled.payment_exception_id) {
      logSecurityEvent("marketplace_payment_exception_recorded", {
        paymentId: internalPaymentId,
        exceptionId: settled.payment_exception_id,
        isReplay: settled.is_replay === true,
      });
      return NextResponse.json({ ok: true, paymentException: true });
    }

    revalidatePath("/financeiro");
    revalidatePath("/reservas");
    return NextResponse.json({ ok: true });
  }

  // PAYMENT_CONFIRMED / PAYMENT_DELETED / refunds -- marca de dedupe + efeito
  // numa única RPC transacional (migration 0085, process_marketplace_payment_
  // webhook_event). Qualquer erro desfaz os dois e a rota responde 5xx; a
  // marca nunca é gravada aqui, e o efeito roda sempre (idempotente), então
  // uma marca legada sem efeito não bloqueia.
  //   - PAYMENT_CONFIRMED: sinal OPERACIONAL só -- persiste provider_payment_
  //     id, NUNCA liquida, NUNCA cria operator_blocked.
  //   - PAYMENT_DELETED: reconcilia com cancel_marketplace_pending_payment
  //     (race-safe, nunca sobrescreve 'paid'); hold ainda válido é resultado
  //     reconhecido (o cleanup lazy cancela depois). NUNCA cria refund/ledger.
  //   - refunds: reconcile_marketplace_refund_webhook_event (0060) -- nunca
  //     por texto/reason, sempre payment_id + provider_refund_id (quando
  //     disponível); sem correlação confiável cai pra manual_review. O
  //     fechamento roda com ator de sistema, sem auth.uid() (0085).
  let providerRefundId: string | null = null;
  let reportedAmountCents: number | null = null;
  if (REFUND_EVENTS.has(event)) {
    // PENDÊNCIA: o campo exato onde o Asaas reporta o id do refund em si
    // (distinto de payment.id) e o valor estornado nestes eventos
    // específicos não foram confirmados contra a documentação oficial ao
    // vivo. `payment.refunds` (array, item mais recente) e `payment.value`
    // são o melhor palpite informado disponível; precisam de validação real
    // antes de qualquer uso em produção.
    const refunds = Array.isArray((payment as Record<string, unknown>).refunds)
      ? ((payment as Record<string, unknown>).refunds as Record<string, unknown>[])
      : [];
    const lastRefund = refunds.length > 0 ? refunds[refunds.length - 1] : undefined;
    providerRefundId = typeof lastRefund?.id === "string" ? lastRefund.id : null;
    const reportedValue = typeof lastRefund?.value === "number" ? lastRefund.value : (typeof payment.value === "number" ? payment.value : null);
    reportedAmountCents = reportedValue !== null ? Math.round(reportedValue * 100) : null;
  }

  const { data, error } = await supabase.rpc("process_marketplace_payment_webhook_event", {
    p_event_key: eventKey,
    p_event_type: event,
    p_payment_id: internalPaymentId,
    p_provider_payment_id: providerPaymentId,
    p_provider_refund_id: providerRefundId,
    p_reported_amount_cents: reportedAmountCents,
  });
  if (error) {
    logSecurityEvent("asaas_webhook_payment_event_failed", { event, paymentId: internalPaymentId, errorCode: error.message.slice(0, 64) });
    return NextResponse.json({ error: "payment_event_failed" }, { status: 500 });
  }

  const result = parsePaymentEventResult(data, internalPaymentId, event);
  if (!result) {
    logSecurityEvent("asaas_webhook_payment_event_unconfirmed", { event, paymentId: internalPaymentId });
    return NextResponse.json({ error: "payment_event_unconfirmed" }, { status: 500 });
  }

  if (event === "PAYMENT_DELETED") revalidatePath("/reservas");
  if (REFUND_EVENTS.has(event)) {
    if (result.outcome === "manual_review_created" || result.outcome === "manual_review_existing") {
      // não é falha do webhook -- é um estado real que precisa de atenção
      // humana (refund sem correlação confiável, ou valor divergente).
      logSecurityEvent("refund_reconciliation_required", { paymentId: internalPaymentId, eventType: event });
    }
    revalidatePath("/financeiro");
  }
  return NextResponse.json({ ok: true });
}

// Status possíveis de payments (0036) e de marketplace_refunds (0055).
const PAYMENT_STATUSES = new Set(["pending", "paid", "failed", "refunded", "partially_refunded"]);
// Refund já fora de aberto (no_op nunca é de um pedido ainda pending/processing).
const SETTLED_REFUND_STATUSES = new Set(["completed", "failed", "manual_review"]);
const MANUAL_REVIEW = new Set(["manual_review"]);

// payment_status permitido por (evento, desfecho) -- PAYMENT_CONFIRMED/DELETED.
const PAYMENT_EVENT_RESULTS: Record<string, Record<string, (status: string) => boolean>> = {
  PAYMENT_CONFIRMED: { provider_marked: (s) => PAYMENT_STATUSES.has(s) },
  PAYMENT_DELETED: {
    cancelled: (s) => s === "failed",
    not_pending: (s) => s !== "pending" && PAYMENT_STATUSES.has(s),
    hold_still_valid: (s) => s === "pending",
  },
};

// refund_status permitido por (evento, desfecho) -- 0086: o resultado traz o
// status REAL do pedido, e cada desfecho só existe com o status coerente.
const REVIEW_OUTCOMES = { manual_review_created: MANUAL_REVIEW, manual_review_existing: MANUAL_REVIEW, no_op: SETTLED_REFUND_STATUSES };
const REFUND_EVENT_RESULTS: Record<string, Record<string, Set<string>>> = {
  PAYMENT_REFUND_IN_PROGRESS: { processing: new Set(["processing"]), ...REVIEW_OUTCOMES },
  PAYMENT_REFUND_DENIED: { failed: new Set(["failed"]), ...REVIEW_OUTCOMES },
  PAYMENT_REFUNDED: { completed: new Set(["completed"]), ...REVIEW_OUTCOMES },
  PAYMENT_PARTIALLY_REFUNDED: { completed: new Set(["completed"]), ...REVIEW_OUTCOMES },
};

// Resultados permitidos de process_marketplace_payment_webhook_event
// (0085/0086): exatamente uma linha do mesmo payment, marker_reused booleano,
// payment_status conhecido e coerente com (evento, desfecho); refunds sempre
// com refund_id uuid e refund_status coerente com (evento, desfecho); os
// demais eventos sem refund. Qualquer outra combinação -> null (5xx).
function parsePaymentEventResult(data: unknown, internalPaymentId: string, event: string): { outcome: string } | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;
  if (typeof row.payment_id !== "string" || row.payment_id.toLowerCase() !== internalPaymentId.toLowerCase()) return null;
  if (typeof row.marker_reused !== "boolean") return null;
  const { outcome, payment_status: paymentStatus, refund_id: refundId, refund_status: refundStatus } = row;
  if (typeof outcome !== "string" || typeof paymentStatus !== "string" || !PAYMENT_STATUSES.has(paymentStatus)) return null;

  const refundRules = REFUND_EVENT_RESULTS[event];
  if (refundRules) {
    const allowed = Object.hasOwn(refundRules, outcome) ? refundRules[outcome] : undefined;
    if (!allowed || typeof refundStatus !== "string" || !allowed.has(refundStatus)) return null;
    if (typeof refundId !== "string" || !UUID_RE.test(refundId)) return null;
    return { outcome };
  }

  const paymentRules = PAYMENT_EVENT_RESULTS[event];
  const check = paymentRules && Object.hasOwn(paymentRules, outcome) ? paymentRules[outcome] : undefined;
  if (!check || !check(paymentStatus)) return null;
  if (refundId !== null || refundStatus !== null) return null;
  return { outcome };
}
