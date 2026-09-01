import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "crypto";
import { logSecurityEvent } from "@/lib/security-log";
import { findOrCreateMarketplaceAsaasCustomer, createOrReconcileMarketplacePixCharge, getMarketplacePixQrCode } from "@/lib/asaas";
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

// Registra uma TENTATIVA de pagamento pra uma reserva já criada via POST
// /api/marketplace/bookings, de forma idempotente e com o valor SEMPRE
// recalculado a partir da reserva no banco (nunca de um `amount` enviado
// pelo ToursFlow). Rota servidor-servidor, mesmo padrão de autenticação
// (Bearer + X-ToursFlow-Client-Key) de POST /bookings.
//
// PIX DO CLIENTE (docs/adr/0007-marketplace-pix-payment-settlement.md): com
// isMarketplacePaymentsEnabled() ligada, cria/reconcilia o customer e a
// cobrança no Asaas de verdade (mock/sandbox controlado por
// MARKETPLACE_PAYMENTS_MODE, ver src/lib/asaas.ts) e devolve o QR Code. A
// LIQUIDAÇÃO em si (confirmar a reserva, creditar o ledger) NUNCA acontece
// aqui -- só o webhook (PAYMENT_RECEIVED) tem essa autoridade.

function fail(code: MarketplacePaymentErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: MARKETPLACE_PAYMENT_ERROR_STATUS[code] });
}

type PaymentRpcRow = {
  payment_id: string;
  status: string;
  payment_method: string;
  amount_cents: number;
  is_replay: boolean;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedToursFlowRequest(request)) {
    logSecurityEvent("marketplace_unauthorized");
    return fail("UNAUTHORIZED", "Não autorizado.");
  }

  const { id: bookingId } = await params;
  if (!bookingId) return fail("BOOKING_NOT_FOUND", "Reserva não encontrada.");

  const admin = createAdminClient();

  const clientKey = normalizeClientKey(request.headers.get("x-toursflow-client-key"));
  if (!clientKey) return fail("INVALID_CLIENT_KEY", "Cabeçalho X-ToursFlow-Client-Key ausente ou inválido.");

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

  // ACHADO DA REVISÃO DA FASE 4A: a checagem da flag precisa vir ANTES de
  // qualquer escrita em `payments` -- com o provider desligado, nenhuma
  // tentativa "fantasma" deve ser persistida (ocuparia o único slot
  // pending/paid permitido por reserva, payments_one_active_per_reservation,
  // e bloquearia a tentativa real quando o provider for ligado).
  if (!isMarketplacePaymentsEnabled()) {
    return fail("PAYMENT_PROVIDER_NOT_ENABLED", "Pagamento de marketplace ainda não está habilitado nesta instância.");
  }

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
    if (rpcError.message.includes("PAYMENT_ALREADY_ACTIVE")) {
      return fail("PAYMENT_ALREADY_ACTIVE", "Já existe uma tentativa de pagamento em andamento para esta reserva.");
    }
    // Asaas exige CPF/CNPJ pra criar o customer -- checado dentro da RPC
    // (migration 0059) ANTES de persistir a tentativa, nunca depois.
    if (rpcError.message.includes("CUSTOMER_DOCUMENT_REQUIRED")) {
      return fail("CUSTOMER_DOCUMENT_REQUIRED", "É necessário informar CPF ou CNPJ válido do cliente antes de gerar o pagamento.");
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

  const baseDto: MarketplacePaymentAttemptDTO = {
    paymentId: result.payment_id,
    status: "pending",
    paymentMethod: result.payment_method as SupportedPaymentMethod,
    amountCents: result.amount_cents,
    currency: "BRL",
  };

  // replay de um pagamento que já saiu de 'pending' (liquidado ou falhou em
  // algum momento anterior) -- nada de PIX pra reexibir, devolve só o
  // status atual. A liquidação em si SÓ acontece via webhook, nunca aqui.
  if (result.status !== "pending") {
    return NextResponse.json({ data: { ...baseDto, status: result.status as MarketplacePaymentAttemptDTO["status"] } }, { status: 200 });
  }

  // ==========================================================================
  // Cliente/CPF -- já validado dentro da RPC (0059), mas os dados em si
  // (nome/cpf/e-mail/telefone) precisam ser buscados aqui pra montar a
  // chamada ao Asaas. Join simples, nunca devolvido ao ToursFlow.
  // ==========================================================================
  const { data: reservationRow } = await admin
    .from("reservations")
    .select("client_id, clients(id, name, cpf, email, phone, asaas_customer_id)")
    .eq("id", bookingId)
    .maybeSingle();

  const client = reservationRow
    ? ((Array.isArray(reservationRow.clients) ? reservationRow.clients[0] : reservationRow.clients) as
        | { id: string; name: string; cpf: string | null; email: string | null; phone: string | null; asaas_customer_id: string | null }
        | null)
    : null;

  if (!client || !client.cpf) {
    // defesa em profundidade -- a RPC já barrou isso, mas nunca confia só
    // na camada de baixo sem checar de novo aqui.
    return fail("CUSTOMER_DOCUMENT_REQUIRED", "É necessário informar CPF ou CNPJ válido do cliente antes de gerar o pagamento.");
  }

  const customerResult = await findOrCreateMarketplaceAsaasCustomer({
    existingCustomerId: client.asaas_customer_id,
    clientId: client.id,
    name: client.name,
    cpfCnpj: client.cpf,
    email: client.email,
    phone: client.phone,
  });
  if (!customerResult.ok) {
    console.error("findOrCreateMarketplaceAsaasCustomer:", customerResult.error);
    return fail("PAYMENT_PROVIDER_ERROR", "Não foi possível preparar o pagamento no provedor. Tente novamente.");
  }

  if (client.asaas_customer_id !== customerResult.data.customerId) {
    // persiste só se mudou -- evita um UPDATE sem efeito em toda chamada
    // (a maioria das chamadas é replay, com o customer já resolvido).
    await admin.from("clients").update({ asaas_customer_id: customerResult.data.customerId }).eq("id", client.id);
  }

  const chargeResult = await createOrReconcileMarketplacePixCharge({
    internalPaymentId: result.payment_id,
    customerId: customerResult.data.customerId,
    amountCents: result.amount_cents,
  });
  if (!chargeResult.ok) {
    console.error("createOrReconcileMarketplacePixCharge:", chargeResult.error);
    return fail("PAYMENT_PROVIDER_ERROR", "Não foi possível criar a cobrança Pix. Tente novamente.");
  }

  await admin.rpc("mark_marketplace_payment_provider_created", {
    p_payment_id: result.payment_id,
    p_provider_payment_id: chargeResult.data.providerPaymentId,
  });

  const qrResult = await getMarketplacePixQrCode(chargeResult.data.providerPaymentId);
  if (!qrResult.ok) {
    console.error("getMarketplacePixQrCode:", qrResult.error);
    return fail("PAYMENT_PROVIDER_ERROR", "Não foi possível obter o QR Code Pix. Tente novamente.");
  }

  const dto: MarketplacePaymentAttemptDTO = {
    ...baseDto,
    pix: { payload: qrResult.data.payload, encodedImage: qrResult.data.encodedImage, expirationDate: qrResult.data.expirationDate },
  };
  return NextResponse.json({ data: dto }, { status: result.is_replay ? 200 : 201 });
}
