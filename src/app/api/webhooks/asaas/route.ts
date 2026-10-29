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

// Contrato do retorno de process_marketplace_payment_received_event (0081):
// evento, pagamento, desfecho e status precisam ser coerentes entre si -- um
// `error === null` sozinho não prova que o efeito (ou a exceção) foi gravado.
const RECEIVED_OUTCOME_STATUSES = new Map<string, readonly string[]>([
  ["settled", ["paid"]],
  ["settled_replay", ["paid", "refunded", "partially_refunded"]],
  ["manual_review", ["paid", "pending"]],
  ["exception_recorded", ["failed"]],
  ["exception_existing", ["failed"]],
]);

function parseReceivedOutcome(data: unknown, internalPaymentId: string): string | null {
  const row = data as { event_type?: unknown; payment_id?: unknown; outcome?: unknown; payment_status?: unknown } | null;
  if (!row || row.event_type !== "PAYMENT_RECEIVED" || row.payment_id !== internalPaymentId) return null;
  if (typeof row.outcome !== "string" || typeof row.payment_status !== "string") return null;
  return RECEIVED_OUTCOME_STATUSES.get(row.outcome)?.includes(row.payment_status) ? row.outcome : null;
}

// Evento que pertence a um objeto LOCAL (saque/payment do marketplace) mas
// chega sem campos necessários ou com referência divergente. Nunca responde
// 200 silencioso: retorna 422 e emite log best-effort. Não há quarentena durável
// aqui e não se presume que o provedor repita um 4xx; operação remota requer
// desenho/validação próprios antes de qualquer rollout.
function unprocessableMarketplaceEvent(event: string, kind: "transfer" | "payment", reason: string) {
  logSecurityEvent("asaas_webhook_unprocessable_marketplace_event", { event, kind, reason });
  return NextResponse.json({ error: "unprocessable_marketplace_event" }, { status: 422 });
}

// ---------------------------------------------------------------------------
// Captura durável de conflitos TRANSFER_* (migration 0090, LOCAL, não publicada).
// Camada ADICIONAL aos 422 de transferência: nunca muda o HTTP, a classificação
// (inclusive o `includes` abaixo) nem o processamento financeiro. Só captura com
// evidência estruturada: pré-checagem que recusou sem chamar a 0089, ou erro da
// 0089 com code P0001 e mensagem EXATA. É uma segunda RPC (transação própria),
// aguardada antes da resposta e nunca repetida. Recusa, erro, timeout, retorno
// inválido ou resultado desconhecido mantêm o 422 e podem deixar o conflito SEM
// registro durável -- o log (Sentry, best-effort) não substitui esse registro.
//
// Logs (`reason` = motivo da 0090; nunca payload, ids do provedor, mensagem
// crua, details/hint):
//   transfer_conflict_captured            {event, reason, outcome, conflictId, occurrenceCount}
//   transfer_conflict_capture_rejected    {event, reason, errorCode: CONFLICT_CAPTURE_*}
//   transfer_conflict_capture_unknown     {event, reason, cause: transport|timeout|exception}
//   transfer_conflict_capture_failed      {event, reason, errorCode, status} -- erro fora do contrato
//   transfer_conflict_capture_invalid_result {event, reason}
//   transfer_conflict_unverified          {event, reason, errorCode} -- 422 só por `includes`
//   transfer_conflict_identifier_type     {event, reason, field, type} -- sem captura
// ---------------------------------------------------------------------------

type TransferConflictReason =
  | "terminal_outcome_conflict" | "event_key_conflict" | "transfer_identity_unproven" | "provider_transfer_id_mismatch"
  | "missing_transfer_id" | "reference_mismatch" | "withdrawal_not_found";

// Erros da 0089 que hoje dão 422, na MESMA ordem dos `includes` de antes:
// [código, motivo do log HTTP atual, motivo da 0090].
const TRANSFER_CONFLICT_CODES: readonly (readonly [string, string, TransferConflictReason])[] = [
  ["PROVIDER_TRANSFER_ID_MISMATCH", "reference_mismatch", "provider_transfer_id_mismatch"],
  ["TERMINAL_OUTCOME_CONFLICT", "terminal_outcome_conflict", "terminal_outcome_conflict"],
  ["EVENT_KEY_CONFLICT", "event_key_conflict", "event_key_conflict"],
  ["TRANSFER_IDENTITY_UNPROVEN", "transfer_identity_unproven", "transfer_identity_unproven"],
  ["WITHDRAWAL_NOT_FOUND", "withdrawal_not_found", "withdrawal_not_found"],
];

// Código externo vira constante segura: SQLSTATE ou PGRST conhecido, senão marcador.
function safeErrorCode(code: unknown): string {
  if (code === undefined || code === null || code === "") return "NONE";
  return typeof code === "string" && /^([0-9A-Z]{5}|PGRST\d{3})$/.test(code) ? code : "UNRECOGNIZED";
}

const INT_MAX = 2147483647;

const CAPTURE_REJECTIONS = new Set([
  "CONFLICT_CAPTURE_INVALID_INPUT", "CONFLICT_CAPTURE_POLICY_MISSING", "CONFLICT_CAPTURE_CAPACITY_EXCEEDED",
]);

// Espera máxima só da captura (nunca da RPC financeira): 3 s. A 0090 faz uma
// leitura e um insert/update curtos; o limite impede que a captura segure a
// resposta do webhook. Abort não prova que a transação foi desfeita no banco.
const CAPTURE_TIMEOUT_MS = 3000;

// Tipo de um identificador que a 0090 não representa (só text/null); null = representável.
function wrongIdentifierType(value: unknown): string | null {
  if (value === undefined || value === null || typeof value === "string") return null;
  return Array.isArray(value) ? "array" : typeof value;
}

function referenceArgs(value: unknown): { p_reference_class: string; p_referenced_withdrawal_id: string | null } {
  if (value === undefined || value === null) return { p_reference_class: "absent", p_referenced_withdrawal_id: null };
  if (typeof value === "string" && UUID_RE.test(value)) return { p_reference_class: "uuid", p_referenced_withdrawal_id: value };
  return { p_reference_class: "invalid", p_referenced_withdrawal_id: null };
}

// Mesma conversão usada para a 0089 (Math.round(fee*100)), mas negativo é
// recusado ANTES do arredondamento (-0.001 nunca vira 0 válido).
function feeArgs(value: unknown): { p_fee_class: string; p_fee_cents: number | null } {
  if (value === undefined || value === null) return { p_fee_class: "absent", p_fee_cents: null };
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const cents = Math.round(value * 100);
    if (Number.isInteger(cents) && cents <= INT_MAX) return { p_fee_class: "valid", p_fee_cents: cents };
  }
  return { p_fee_class: "invalid", p_fee_cents: null };
}

type CaptureContext = {
  supabase: SupabaseClient;
  event: string;
  transfer: Record<string, unknown>;
  rawNotificationId: unknown;
};

async function captureTransferConflict(ctx: CaptureContext, reason: TransferConflictReason, eventKey: string | null) {
  const { supabase, event, transfer } = ctx;
  // Número/objeto não vira null nem String(): seria perder ou reparar o dado.
  for (const [field, value] of [["notification_id", ctx.rawNotificationId], ["transfer_id", transfer.id]] as const) {
    const type = wrongIdentifierType(value);
    if (type) {
      logSecurityEvent("transfer_conflict_identifier_type", { event, reason, field, type });
      return;
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
  try {
    // `status` é da resposta (0 = sem resposta HTTP), não do `error`.
    const { data, error, status } = await supabase
      .rpc("record_marketplace_transfer_conflict", {
        p_reason: reason,
        p_event_type: event,
        p_event_key: eventKey,
        p_notification_id: (ctx.rawNotificationId as string | undefined) ?? null,
        p_provider_transfer_id: (transfer.id as string | undefined) ?? null,
        ...referenceArgs(transfer.externalReference),
        ...feeArgs(transfer.fee),
      })
      .abortSignal(controller.signal)
      .maybeSingle();
    if (error) {
      if (error.code === "P0001" && CAPTURE_REJECTIONS.has(error.message)) {
        logSecurityEvent("transfer_conflict_capture_rejected", { event, reason, errorCode: error.message });
      } else if (!status) {
        logSecurityEvent("transfer_conflict_capture_unknown", { event, reason, cause: controller.signal.aborted ? "timeout" : "transport" });
      } else {
        logSecurityEvent("transfer_conflict_capture_failed", { event, reason, errorCode: safeErrorCode(error.code), status });
      }
      return;
    }
    const row = data as { outcome?: unknown; conflict_id?: unknown; occurrence_count?: unknown } | null;
    const count = row?.occurrence_count;
    const confirmed = !!row && typeof row === "object" && !Array.isArray(row)
      && typeof row.conflict_id === "string" && UUID_RE.test(row.conflict_id)
      && typeof count === "number" && Number.isInteger(count)
      && ((row.outcome === "recorded" && count === 1) || (row.outcome === "repeated" && count >= 2 && count <= INT_MAX));
    if (!confirmed) {
      logSecurityEvent("transfer_conflict_capture_invalid_result", { event, reason });
      return;
    }
    logSecurityEvent("transfer_conflict_captured", {
      event, reason, outcome: row.outcome as string, conflictId: row.conflict_id as string, occurrenceCount: count,
    });
  } catch {
    // rejeição inesperada só da captura: resultado desconhecido, HTTP inalterado.
    logSecurityEvent("transfer_conflict_capture_unknown", { event, reason, cause: controller.signal.aborted ? "timeout" : "exception" });
  } finally {
    clearTimeout(timer);
  }
}

// 422 de transferência com evidência estruturada: captura (best-effort) e
// devolve exatamente a resposta de antes.
async function respondTransferConflict(
  ctx: CaptureContext, httpReason: string, reason: TransferConflictReason, eventKey: string | null
) {
  await captureTransferConflict(ctx, reason, eventKey);
  return unprocessableMarketplaceEvent(ctx.event, "transfer", httpReason);
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
    return handleTransferEvent(supabase, event, transfer, notificationId, body?.id);
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
        // Se a referência e o ID do provider apontarem para pagamentos locais
        // diferentes, não liquidar nenhum deles. Isso também detecta vínculo
        // duplicado/corrompido sem depender do status atual do payment.
        const providerPaymentId = typeof payment.id === "string" && payment.id.length > 0 ? payment.id : undefined;
        if (providerPaymentId) {
          const { data: byCharge, error: chargeLookupError } = await supabase
            .from("payments")
            .select("id")
            .eq("provider_payment_id", providerPaymentId)
            .limit(2);
          if (chargeLookupError) {
            logSecurityEvent("asaas_webhook_payment_lookup_failed", {
              event, paymentId: providerPaymentId, errorCode: chargeLookupError.message.slice(0, 64),
            });
            return NextResponse.json({ error: "payment_lookup_failed" }, { status: 500 });
          }
          if (Array.isArray(byCharge) && byCharge.some((row) => row.id !== internalPaymentId)) {
            return unprocessableMarketplaceEvent(event, "payment", "reference_mismatch");
          }
        }
        return handleMarketplacePaymentEvent(supabase, event, payment, notificationId);
      }
    }

    // externalReference não aponta para um payment nosso -- mas a COBRANÇA
    // pode ser de um payment local (externalReference ausente/divergente).
    // Nesse caso o evento afeta um payment nosso e nunca é descartado com 200
    // nem cai no fluxo SaaS. Cobrança desconhecida segue o caminho de antes.
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
// CANCELLED) -- deduplicar só por transfer.id (como o fluxo de pagamento
// SaaS faz com payment.id, migration 0037) travaria eventos legítimos e
// diferentes da MESMA transferência uns contra os outros pela pouca sorte de
// compartilharem o event_type em replays intermediários. A chave de
// idempotência aqui é o id do EVENTO em si (o envelope da notificação,
// `body.id` -- distinto de `transfer.id`) quando presente; sem ele, cai pra
// `${event}:${transfer.id}` (ver perEventKey) -- só o reenvio do MESMO
// evento colide, nunca CREATED contra DONE da mesma transferência.
// Com a 0089 (local, ainda não publicada) essa chave é só registro: quem decide
// se o efeito já foi aplicado é o estado travado do saque.
async function handleTransferEvent(
  supabase: SupabaseClient,
  event: string,
  transfer: Record<string, unknown>,
  notificationId: string | undefined,
  // body.id exatamente como chegou -- só para a captura da 0090.
  rawNotificationId: unknown
) {
  const capture: CaptureContext = { supabase, event, transfer, rawNotificationId };
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
    // pelo id da transferência já gravado num saque.
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
      const reason = withdrawalId ? "missing_transfer_id" : "reference_mismatch";
      return respondTransferConflict(capture, reason, reason, null);
    }
    if (rawReference && !withdrawalId) logSecurityEvent("asaas_webhook_invalid_withdrawal_reference", { event });
    return NextResponse.json({ ok: true });
  }

  // Pré-checagem de correlação cruzada (transfer id já ligado a outro saque).
  // Antes da 0089 era a única defesa e não fechava a corrida entre requisições;
  // com a 0089 (local, ainda não publicada) a RPC repete a checagem sob lock de
  // linha + advisory lock por transfer id. Esta leitura só antecipa o 422.
  const { data: byTransferId, error: transferLookupError } = await supabase
    .from("marketplace_withdrawals")
    .select("id")
    .eq("provider_transfer_id", providerTransferId)
    .limit(2);
  if (transferLookupError) {
    logSecurityEvent("asaas_webhook_transfer_lookup_failed", { event, errorCode: transferLookupError.message.slice(0, 64) });
    return NextResponse.json({ error: "reference_lookup_failed" }, { status: 500 });
  }
  if (Array.isArray(byTransferId) && byTransferId.some((row) => row.id !== withdrawalId)) {
    return respondTransferConflict(capture, "reference_mismatch", "reference_mismatch", null);
  }

  const eventKey = perEventKey(event, notificationId, providerTransferId);
  const providerFeeCents = typeof transfer.fee === "number" ? Math.round((transfer.fee as number) * 100) : null;

  // Migration 0089: o estado travado do saque decide se o efeito já foi aplicado;
  // a marca em processed_webhook_events é só registro (marcas antigas eram
  // gravadas aqui ANTES do efeito e não provam nada). Erro em qualquer etapa
  // desfaz tudo, a rota responde 5xx/422 e o reenvio processa de novo.
  const { data, error } = await supabase
    .rpc("process_marketplace_transfer_webhook_event", {
      p_event_key: eventKey,
      p_event_type: event,
      p_withdrawal_id: withdrawalId,
      p_provider_transfer_id: providerTransferId,
      p_provider_fee_cents: providerFeeCents,
    })
    .maybeSingle();
  if (error) {
    // Classificação HTTP inalterada (por `includes`, na ordem de antes):
    // PROVIDER_TRANSFER_ID_MISMATCH, desfecho terminal diferente do gravado,
    // event_key de outro tipo/fluxo, saque terminal sem transfer id gravado e
    // uuid sem saque local -- todos 422, nunca 200. A captura da 0090 só roda
    // quando o erro é estruturado (P0001 + mensagem exata).
    const conflict = TRANSFER_CONFLICT_CODES.find(([code]) => error.message.includes(code));
    if (conflict) {
      const [code, httpReason, reason] = conflict;
      if (error.code === "P0001" && error.message === code) {
        return respondTransferConflict(capture, httpReason, reason, eventKey);
      }
      logSecurityEvent("transfer_conflict_unverified", { event, reason, errorCode: safeErrorCode(error.code) });
      return unprocessableMarketplaceEvent(event, "transfer", httpReason);
    }
    logSecurityEvent("marketplace_withdrawal_webhook_error", { event, withdrawalId, errorCode: error.message.slice(0, 64) });
    return NextResponse.json({ error: "transfer_processing_failed" }, { status: 500 });
  }
  const row = data as { outcome?: unknown; withdrawal_status?: unknown } | null;
  if (!row || !isCoherentTransferResult(event, row.outcome, row.withdrawal_status)) {
    logSecurityEvent("marketplace_withdrawal_webhook_error", { event, withdrawalId, errorCode: "UNEXPECTED_RESULT" });
    return NextResponse.json({ error: "transfer_processing_failed" }, { status: 500 });
  }

  if (row.outcome === "applied" && TERMINAL_TRANSFER_EVENTS[event]) revalidatePath("/financeiro");
  return NextResponse.json({ ok: true, ...(row.outcome === "already_applied" ? { duplicate: true } : {}) });
}

// Contrato do retorno de process_marketplace_transfer_webhook_event (0089):
// desfecho definitivo só devolve o próprio status; intermediário devolve
// `applied`+processing (saiu de pending) ou `already_applied` com qualquer
// estado além de pending -- inclusive terminal (evento atrasado).
function isCoherentTransferResult(event: string, outcome: unknown, status: unknown): boolean {
  const terminal = TERMINAL_TRANSFER_EVENTS[event];
  if (terminal) return (outcome === "applied" || outcome === "already_applied") && status === terminal;
  if (outcome === "applied") return status === "processing";
  return outcome === "already_applied" && ["processing", "completed", "failed", "cancelled"].includes(status as string);
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
  // sem a cobrança não há como conferir a identidade nem aplicar o evento --
  // nunca 200 silencioso para um payment nosso.
  if (!providerPaymentId) return unprocessableMarketplaceEvent(event, "payment", "missing_payment_id");

  const eventKey = perEventKey(event, notificationId, providerPaymentId);

  // PAYMENT_RECEIVED é o único evento que move dinheiro (liquida e credita o
  // ledger) -- confirmado no Asaas ANTES de qualquer efeito, mesmo motivo do
  // fluxo SaaS. O valor liquidado passa a ser o que a API do Asaas devolve,
  // nunca o `payment.value` do corpo do webhook.
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

    // Sem marca de dedupe na rota (a marca antiga era gravada ANTES do efeito e
    // um erro do settle respondia 200 -- Pix pago e nunca liquidado, sem retry).
    // A RPC aplica o efeito ou grava a exceção durável de payment 'failed' e é
    // idempotente por construção; só responde 200 se o retorno for coerente.
    const { data, error } = await supabase
      .rpc("process_marketplace_payment_received_event", {
        p_internal_payment_id: internalPaymentId,
        p_provider_payment_id: providerPaymentId,
        p_confirmed_amount_cents: verification.valueCents,
      })
      .maybeSingle();
    const outcome = error ? null : parseReceivedOutcome(data, internalPaymentId);
    if (!outcome) {
      logSecurityEvent("marketplace_payment_settlement_error", {
        paymentId: internalPaymentId,
        errorCode: error ? error.message.slice(0, 64) : "UNEXPECTED_RESULT",
      });
      return NextResponse.json({ error: "settlement_failed" }, { status: 500 });
    }
    if (outcome.startsWith("exception_")) {
      logSecurityEvent("marketplace_payment_received_on_failed_payment", { paymentId: internalPaymentId, outcome });
    }

    revalidatePath("/financeiro");
    revalidatePath("/reservas");
    return NextResponse.json({ ok: true, outcome });
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
