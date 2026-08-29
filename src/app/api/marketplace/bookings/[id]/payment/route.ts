import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "crypto";
import {
  isAuthorizedToursFlowRequest,
  isValidIdempotencyKey,
  isSupportedPaymentMethod,
  isMarketplacePaymentsEnabled,
  normalizeClientKey,
  buildClientRateLimitConsumerKey,
  TOURSFLOW_RATE_LIMIT_MAX_REQUESTS,
  TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS,
  TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS,
  TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS,
  MARKETPLACE_PAYMENT_ERROR_STATUS,
  type MarketplacePaymentErrorCode,
  type MarketplacePaymentAttemptDTO,
  type SupportedPaymentMethod,
} from "@/lib/marketplace-api";

export const dynamic = "force-dynamic";

// FASE 4A -- registra uma TENTATIVA de pagamento pra uma reserva já criada
// via POST /api/marketplace/bookings, de forma idempotente e com o valor
// SEMPRE recalculado a partir da reserva no banco (nunca de um `amount`
// enviado pelo ToursFlow -- amount tampering não é possível, o campo nem é
// lido do corpo da requisição). Rota servidor-servidor, mesmo padrão de
// autenticação (Bearer + X-ToursFlow-Client-Key) de POST /bookings.
//
// NUNCA chama o Asaas nesta fase -- ver isMarketplacePaymentsEnabled() em
// src/lib/marketplace-api.ts. Termina sempre em PAYMENT_PROVIDER_NOT_ENABLED
// depois de validar e persistir a tentativa (idempotente de verdade, testável
// de verdade -- só a chamada real ao provider está desligada).

function fail(code: MarketplacePaymentErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: MARKETPLACE_PAYMENT_ERROR_STATUS[code] });
}

// Idempotency-Key própria da tentativa de pagamento -- nunca reaproveita a
// da reserva (são operações lógicas diferentes: "criar a reserva" vs
// "tentar pagar" -- uma reserva pode, em tese, ter mais de uma tentativa).
type PaymentRpcRow = {
  payment_id: string;
  status: string;
  payment_method: string;
  amount_cents: number;
  is_replay: boolean;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedToursFlowRequest(request)) return fail("UNAUTHORIZED", "Não autorizado.");

  const { id: bookingId } = await params;
  if (!bookingId) return fail("BOOKING_NOT_FOUND", "Reserva não encontrada.");

  const admin = createAdminClient();

  const clientKey = normalizeClientKey(request.headers.get("x-toursflow-client-key"));
  if (!clientKey) return fail("INVALID_CLIENT_KEY", "Cabeçalho X-ToursFlow-Client-Key ausente ou inválido.");

  // rate limit próprio desta rota (consumer_key distinto de POST /bookings --
  // isolado de propósito, iniciar pagamento é uma ação diferente de criar
  // reserva, não deveriam compartilhar o mesmo contador).
  const globalRateLimit = await admin.rpc("check_rate_limit", {
    p_consumer_key: "toursflow:payment",
    p_max_requests: TOURSFLOW_RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (globalRateLimit.error) return fail("INTERNAL_ERROR", "Erro interno.");
  if (globalRateLimit.data !== true) return fail("RATE_LIMITED", "Muitas requisições. Tente novamente em instantes.");

  const clientRateLimit = await admin.rpc("check_rate_limit", {
    p_consumer_key: buildClientRateLimitConsumerKey(`payment:${clientKey}`),
    p_max_requests: TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (clientRateLimit.error) return fail("INTERNAL_ERROR", "Erro interno.");
  if (clientRateLimit.data !== true) return fail("RATE_LIMITED", "Muitas requisições. Tente novamente em instantes.");

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return fail("INVALID_IDEMPOTENCY_KEY", "Cabeçalho Idempotency-Key ausente ou inválido.");
  }

  const body = await request.json().catch(() => null);
  const paymentMethod = (body as Record<string, unknown> | null)?.paymentMethod;
  if (!isSupportedPaymentMethod(paymentMethod)) {
    return fail("PAYMENT_METHOD_NOT_SUPPORTED", "Método de pagamento não suportado.");
  }

  // ACHADO DA REVISÃO: a checagem da flag precisa vir ANTES de qualquer
  // escrita em `payments` -- não só antes de chamar o Asaas. Com o provider
  // desligado, nenhuma tentativa "fantasma" (que nunca vai virar cobrança
  // real) deve ser persistida -- ela ocuparia o único slot pending/paid
  // permitido por reserva (payments_one_active_per_reservation, migration
  // 0049) e bloquearia pra sempre a tentativa de verdade quando a Fase 4B
  // ligar o provider. Único efeito colateral aceito: com o provider
  // desligado, o chamador recebe sempre 501 aqui, mesmo que a reserva
  // também tivesse outro problema (ex: hold vencido) -- opção mais simples
  // e consistente, given que 501 já é inequívoco ("não tente de novo agora,
  // não é sobre a sua reserva").
  if (!isMarketplacePaymentsEnabled()) {
    return fail("PAYMENT_PROVIDER_NOT_ENABLED", "Pagamento de marketplace ainda não está habilitado nesta instância.");
  }

  // Fingerprint da tentativa: bookingId + método -- os dois únicos campos que
  // o chamador realmente escolhe aqui (valor nunca é um deles, é sempre
  // recalculado dentro da RPC a partir da reserva).
  const requestFingerprint = createHash("sha256").update(`${bookingId}|${paymentMethod}`).digest("hex");

  const { data: rows, error: rpcError } = await admin.rpc("create_marketplace_payment_attempt", {
    p_booking_id: bookingId,
    p_payment_method: paymentMethod,
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: requestFingerprint,
  });

  if (rpcError) {
    if (rpcError.message.includes("PAYMENT_IDEMPOTENCY_CONFLICT")) {
      return fail("PAYMENT_IDEMPOTENCY_CONFLICT", "Esta Idempotency-Key já foi usada para uma tentativa de pagamento diferente.");
    }
    // checar ANTES de "PAYMENT_IDEMPOTENCY_CONFLICT" seria um erro (esta
    // string não contém a outra), mas a ordem entre as duas não importa --
    // são mensagens de erro distintas, nunca uma substring da outra.
    if (rpcError.message.includes("PAYMENT_ALREADY_ACTIVE")) {
      return fail("PAYMENT_ALREADY_ACTIVE", "Já existe uma tentativa de pagamento em andamento para esta reserva.");
    }
    if (rpcError.message.includes("BOOKING_NOT_FOUND")) return fail("BOOKING_NOT_FOUND", "Reserva não encontrada.");
    if (rpcError.message.includes("BOOKING_NOT_PENDING")) return fail("BOOKING_NOT_PENDING", "Esta reserva não está mais pendente.");
    if (rpcError.message.includes("HOLD_EXPIRED")) return fail("HOLD_EXPIRED", "O prazo desta reserva expirou.");
    if (rpcError.message.includes("DEPARTURE_NOT_FOUND")) return fail("DEPARTURE_NOT_FOUND", "Saída não encontrada.");
    if (rpcError.message.includes("COMPANY_NOT_AVAILABLE")) return fail("COMPANY_NOT_AVAILABLE", "Este passeio não está disponível.");
    return fail("INTERNAL_ERROR", "Erro ao registrar a tentativa de pagamento.");
  }

  const result = (Array.isArray(rows) ? rows[0] : rows) as PaymentRpcRow | undefined;
  if (!result) return fail("INTERNAL_ERROR", "Erro ao registrar a tentativa de pagamento.");

  // Inalcançável nesta fase (a flag já foi checada acima e retornou cedo se
  // desligada) -- aqui é onde a Fase 4B vai chamar createMarketplacePayment()
  // de verdade.
  const dto: MarketplacePaymentAttemptDTO = {
    paymentId: result.payment_id,
    status: "pending",
    paymentMethod: result.payment_method as SupportedPaymentMethod,
    amountCents: result.amount_cents,
    currency: "BRL",
  };
  return NextResponse.json({ data: dto }, { status: result.is_replay ? 200 : 201 });
}
