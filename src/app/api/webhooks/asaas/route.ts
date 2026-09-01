import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logSecurityEvent } from "@/lib/security-log";

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
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
]);

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
  // id do EVENTO em si (envelope da notificação, distinto de transfer.id) --
  // usado como chave de idempotência do fluxo de transferência, ver
  // handleTransferEvent.
  const notificationId = body?.id as string | undefined;

  if (event && transfer && (IN_PROGRESS_TRANSFER_EVENTS.has(event) || event in TERMINAL_TRANSFER_EVENTS)) {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    return handleTransferEvent(supabase, event, transfer, notificationId);
  }

  if (event && payment && MARKETPLACE_PAYMENT_EVENTS.has(event)) {
    const internalPaymentId = payment.externalReference as string | undefined;
    if (internalPaymentId) {
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      // só entra no fluxo marketplace se externalReference corresponder a
      // uma linha REAL de payments -- nunca assume pelo nome do evento
      // sozinho (que é idêntico ao do fluxo SaaS).
      const { data: marketplacePayment } = await supabase.from("payments").select("id").eq("id", internalPaymentId).maybeSingle();
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

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // idempotência: registra a chave (provider, payment.id) ANTES de renovar. Se o
  // Asaas reenviar a mesma notificação, ou mandar PAYMENT_CONFIRMED e depois
  // PAYMENT_RECEIVED pro mesmo pagamento, o insert bate na unique constraint e a
  // gente nunca soma o prazo duas vezes pra mesma cobrança (migration 0037).
  const { error: dedupeError } = await supabase
    .from("processed_webhook_events")
    .insert({ provider: "asaas", event_type: event, event_key: paymentId });
  if (dedupeError) {
    if (dedupeError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    // erro inesperado ao gravar a marca de dedupe: não falha o webhook por isso
    // (o Asaas reenviaria em loop), só não renova por segurança nesta chamada
    return NextResponse.json({ ok: true });
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, paid_until, billing_cycle")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return NextResponse.json({ ok: true });

  // renova pelo tamanho do ciclo: 1 ano (anual) ou 30 dias (mensal)
  const days = sub.billing_cycle === "anual" ? 365 : 30;
  const base = sub.paid_until && new Date(sub.paid_until) > new Date() ? new Date(sub.paid_until) : new Date();
  base.setDate(base.getDate() + days);

  await supabase
    .from("subscriptions")
    .update({ paid_until: base.toISOString(), status: "ativa" })
    .eq("id", sub.id);

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
// `body.id` -- distinto de `transfer.id`) quando presente; cai pra
// transfer.id só se o provider genuinamente não mandar um id de evento
// (nesse caso o comportamento é o mesmo de antes: eventos com o mesmo
// event_type "colidem" entre si, o que é aceitável já que os eventos
// intermediários são todos idempotentes por natureza -- ver
// IN_PROGRESS_TRANSFER_EVENTS abaixo). Fluxo de pagamento SaaS (payment.id)
// NÃO foi alterado.
async function handleTransferEvent(
  supabase: SupabaseClient,
  event: string,
  transfer: Record<string, unknown>,
  notificationId: string | undefined
) {
  const providerTransferId = transfer.id as string | undefined;
  const withdrawalId = transfer.externalReference as string | undefined;
  if (!providerTransferId || !withdrawalId) return NextResponse.json({ ok: true });

  const eventKey = notificationId ?? providerTransferId;

  const { error: dedupeError } = await supabase
    .from("processed_webhook_events")
    .insert({ provider: "asaas", event_type: event, event_key: eventKey });
  if (dedupeError) {
    if (dedupeError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ ok: true });
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

  const eventKey = notificationId ?? providerPaymentId;

  const { error: dedupeError } = await supabase
    .from("processed_webhook_events")
    .insert({ provider: "asaas", event_type: event, event_key: eventKey });
  if (dedupeError) {
    if (dedupeError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ ok: true });
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

  if (event === "PAYMENT_RECEIVED") {
    // ÚNICO gatilho financeiro real -- delega pra settle_marketplace_
    // payment_received (migration 0059), que faz tudo atomicamente
    // (verifica amount, revalida capacidade, confirma reserva, congela
    // snapshot, credita ledger -- ou cai pra manual_review sem nunca
    // overbookar nem perder o dinheiro do cliente).
    const rawValue = payment.value;
    const amountCents = typeof rawValue === "number" ? Math.round(rawValue * 100) : null;
    if (amountCents === null) {
      // payload sem valor numérico -- nunca assume um valor, nunca liquida
      // sem saber quanto chegou de verdade.
      logSecurityEvent("marketplace_payment_webhook_missing_value", { paymentId: internalPaymentId });
      return NextResponse.json({ ok: true });
    }

    const { error: settleError } = await supabase.rpc("settle_marketplace_payment_received", {
      p_internal_payment_id: internalPaymentId,
      p_provider_payment_id: providerPaymentId,
      p_confirmed_amount_cents: amountCents,
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

  // PAYMENT_REFUND_IN_PROGRESS / PAYMENT_REFUNDED / PAYMENT_PARTIALLY_REFUNDED
  // -- integrados só até o contrato interno SEGURO nesta fase. Nenhum
  // provider refund real está ativado ainda (create_marketplace_refund_
  // request, 0055, só RESERVA o efeito internamente -- nenhum caminho de
  // produção chama um estorno real no Asaas). Webhook NUNCA ignora esses
  // eventos silenciosamente -- loga pra observabilidade (sem PII), decisão
  // de correlacionar com um marketplace_refunds específico fica pra quando
  // a integração de estorno real existir.
  logSecurityEvent("marketplace_payment_refund_event_received", { paymentId: internalPaymentId, eventType: event });
  return NextResponse.json({ ok: true });
}
