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
// CANCELLED) -- deduplicar só por transfer.id (como o fluxo de pagamento
// SaaS faz com payment.id, migration 0037) travaria eventos legítimos e
// diferentes da MESMA transferência uns contra os outros pela pouca sorte de
// compartilharem o event_type em replays intermediários. A chave de
// idempotência aqui é o id do EVENTO em si (o envelope da notificação,
// `body.id` -- distinto de `transfer.id`) quando presente; sem ele, cai pra
// `${event}:${transfer.id}` (ver perEventKey) -- só o reenvio do MESMO
// evento colide, nunca CREATED contra DONE da mesma transferência.
async function handleTransferEvent(
  supabase: SupabaseClient,
  event: string,
  transfer: Record<string, unknown>,
  notificationId: string | undefined
) {
  const providerTransferId = transfer.id as string | undefined;
  const withdrawalId = transfer.externalReference as string | undefined;
  if (!providerTransferId || !withdrawalId) return NextResponse.json({ ok: true });

  const eventKey = perEventKey(event, notificationId, providerTransferId);

  const { error: dedupeError } = await supabase
    .from("processed_webhook_events")
    .insert({ provider: "asaas", event_type: event, event_key: eventKey });
  if (dedupeError) {
    if (dedupeError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    // erro inesperado ao gravar a marca: nada foi processado -- responde 5xx
    // pro Asaas reenviar, em vez de 200 que descartaria o evento em silêncio.
    logSecurityEvent("asaas_webhook_dedupe_failed", { flow: "transfer", event, errorCode: dedupeError.message.slice(0, 64) });
    return NextResponse.json({ error: "dedupe_failed" }, { status: 500 });
  }

  // Eventos intermediários (incluindo BLOCKED) -- garante que o saque saia de
  // 'pending' pra 'processing' o quanto antes soubermos que o provider já
  // está com a transferência, mas NUNCA toca o ledger nem muda o status pra
  // um desfecho definitivo. Idempotente por natureza (mark_marketplace_
  // withdrawal_processing só age se ainda estiver 'pending').
  if (IN_PROGRESS_TRANSFER_EVENTS.has(event)) {
    await supabase.rpc("mark_marketplace_withdrawal_processing", {
      p_withdrawal_id: withdrawalId,
      p_provider_transfer_id: providerTransferId,
    });
    return NextResponse.json({ ok: true });
  }

  const outcome = TERMINAL_TRANSFER_EVENTS[event];
  const providerFeeCents = typeof transfer.fee === "number" ? Math.round((transfer.fee as number) * 100) : null;

  await supabase.rpc("finalize_marketplace_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_outcome: outcome,
    p_provider_transfer_id: providerTransferId,
    p_provider_fee_cents: outcome === "completed" ? providerFeeCents : null,
    p_failure_code: outcome === "completed" ? null : `PROVIDER_TRANSFER_${outcome.toUpperCase()}`,
    // nunca o payload bruto do provider na mensagem -- só um texto curto e
    // seguro pro operador ver (ver failure_reason_safe, migration 0056).
    p_failure_reason_safe:
      outcome === "completed"
        ? null
        : outcome === "cancelled"
          ? "A transferência foi cancelada."
          : "A transferência não pôde ser concluída pelo provedor de pagamento.",
  });

  revalidatePath("/financeiro");

  return NextResponse.json({ ok: true });
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
  const providerPaymentId = payment.id as string | undefined;
  const internalPaymentId = payment.externalReference as string | undefined;
  if (!providerPaymentId || !internalPaymentId) return NextResponse.json({ ok: true });

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
  }

  const { error: dedupeError } = await supabase
    .from("processed_webhook_events")
    .insert({ provider: "asaas", event_type: event, event_key: eventKey });
  if (dedupeError) {
    if (dedupeError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    // erro inesperado ao gravar a marca: nada foi processado -- responde 5xx
    // pro Asaas reenviar, em vez de 200 que descartaria o evento em silêncio.
    logSecurityEvent("asaas_webhook_dedupe_failed", { flow: "marketplace", event, errorCode: dedupeError.message.slice(0, 64) });
    return NextResponse.json({ error: "dedupe_failed" }, { status: 500 });
  }

  if (event === "PAYMENT_CONFIRMED") {
    // sinal OPERACIONAL só -- NUNCA settlement definitivo, NUNCA cria
    // operator_blocked, NUNCA considerado liquidação final. Só garante que
    // provider_payment_id está persistido (idempotente -- mark_marketplace_
    // payment_provider_created aceita o mesmo valor de novo sem erro).
    await supabase.rpc("mark_marketplace_payment_provider_created", {
      p_payment_id: internalPaymentId,
      p_provider_payment_id: providerPaymentId,
    });
    return NextResponse.json({ ok: true });
  }

  if (event === "PAYMENT_RECEIVED" && verifiedAmountCents !== null) {
    // ÚNICO gatilho financeiro real -- delega pra settle_marketplace_
    // payment_received (migration 0059), que faz tudo atomicamente
    // (verifica amount, revalida capacidade, confirma reserva, congela
    // snapshot, credita ledger -- ou cai pra manual_review sem nunca
    // overbookar nem perder o dinheiro do cliente). O amount aqui é o
    // valor confirmado pela API do Asaas (verifyAsaasPaymentSettled acima).
    const { error: settleError } = await supabase.rpc("settle_marketplace_payment_received", {
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
    }

    revalidatePath("/financeiro");
    revalidatePath("/reservas");
    return NextResponse.json({ ok: true });
  }

  if (event === "PAYMENT_DELETED") {
    // cobrança removida no provider -- via o nosso próprio DELETE
    // (cancelMarketplacePendingPayment, cleanup de hold expirado) ou por
    // qualquer outro meio (ex: painel do Asaas). Reconcilia o estado
    // interno com a MESMA RPC do cleanup lazy -- race-safe por construção
    // (nunca sobrescreve um 'paid' se PAYMENT_RECEIVED chegou primeiro).
    // NUNCA cria refund/ledger -- uma cobrança que nunca foi paga não tem
    // nada pra estornar.
    const { error } = await supabase.rpc("cancel_marketplace_pending_payment", { p_payment_id: internalPaymentId });
    if (error && !error.message.includes("HOLD_STILL_VALID")) {
      logSecurityEvent("payment_cleanup_failed", { paymentId: internalPaymentId });
    }
    revalidatePath("/reservas");
    return NextResponse.json({ ok: true });
  }

  if (REFUND_EVENTS.has(event)) {
    // PAYMENT_REFUND_IN_PROGRESS / PAYMENT_REFUNDED / PAYMENT_PARTIALLY_
    // REFUNDED / PAYMENT_REFUND_DENIED -- correlação segura via
    // reconcile_marketplace_refund_webhook_event (migration 0060): nunca
    // por texto/reason, sempre payment_id + provider_refund_id (quando
    // disponível). Sem correlação confiável -- cai pra manual_review,
    // nunca inventa lançamento, nunca mexe em saldo.
    //
    // PENDÊNCIA: o campo exato onde o Asaas reporta o id do refund em si
    // (distinto de payment.id) e o valor estornado nestes eventos
    // específicos não foram confirmados contra a documentação oficial ao
    // vivo nesta sessão -- mesma categoria de pendência já registrada pro
    // payload de transfer/PHONE. `payment.refunds` (array, item mais
    // recente) e `payment.value` são o melhor palpite informado disponível
    // agora; precisam de validação real antes de qualquer uso em produção.
    const refunds = Array.isArray((payment as Record<string, unknown>).refunds)
      ? ((payment as Record<string, unknown>).refunds as Record<string, unknown>[])
      : [];
    const lastRefund = refunds.length > 0 ? refunds[refunds.length - 1] : undefined;
    const providerRefundId = typeof lastRefund?.id === "string" ? lastRefund.id : null;
    const reportedValue = typeof lastRefund?.value === "number" ? lastRefund.value : (typeof payment.value === "number" ? payment.value : null);
    const reportedAmountCents = reportedValue !== null ? Math.round(reportedValue * 100) : null;

    const { data, error } = await supabase
      .rpc("reconcile_marketplace_refund_webhook_event", {
        p_payment_id: internalPaymentId,
        p_provider_refund_id: providerRefundId,
        p_event_type: event,
        p_reported_amount_cents: reportedAmountCents,
      })
      .maybeSingle();

    if (error) {
      logSecurityEvent("refund_reconciliation_required", { paymentId: internalPaymentId, eventType: event, errorCode: error.message.slice(0, 64) });
    } else {
      const row = data as { action: string } | null;
      if (row?.action === "manual_review_created" || row?.action === "manual_review_existing") {
        // não é uma falha do webhook em si -- é um estado real que precisa
        // de atenção humana (refund sem correlação confiável, ou valor
        // divergente do esperado). Logado como sinalização administrativa,
        // não como erro.
        logSecurityEvent("refund_reconciliation_required", { paymentId: internalPaymentId, eventType: event });
      }
    }

    revalidatePath("/financeiro");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
