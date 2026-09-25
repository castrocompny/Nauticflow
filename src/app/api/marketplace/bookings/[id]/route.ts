import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security-log";
import { getMarketplacePixQrCode } from "@/lib/asaas";
import { attemptMarketplacePaymentCleanup } from "@/lib/marketplace-payment-cleanup";
import {
  isAuthorizedToursFlowRequest,
  normalizeClientKey,
  MARKETPLACE_PAYMENT_ERROR_STATUS,
  TOURSFLOW_POLL_RATE_LIMIT_CONSUMER_KEY,
  TOURSFLOW_POLL_RATE_LIMIT_MAX_REQUESTS,
  TOURSFLOW_POLL_RATE_LIMIT_WINDOW_SECONDS,
  TOURSFLOW_POLL_CLIENT_RATE_LIMIT_MAX_REQUESTS,
  TOURSFLOW_POLL_CLIENT_RATE_LIMIT_WINDOW_SECONDS,
  buildPollClientRateLimitConsumerKey,
  type MarketplacePaymentErrorCode,
  type MarketplaceBookingStatusDTO,
} from "@/lib/marketplace-api";

export const dynamic = "force-dynamic";

// FASE 4A -- consulta server-to-server pro ToursFlow saber o estado atual de
// uma reserva (e, quando existir, da tentativa de pagamento mais recente).
// Rota só de LEITURA -- mesma autenticação Bearer das demais rotas de
// marketplace. Nunca devolve: client_id interno, CPF, e-mail/telefone do
// cliente, nada do Asaas (chave, payload bruto, wallet), nada de outra
// company que não seja a dona desta reserva (indistinguível de "não existe"
// pra quem chama, mesmo padrão de erro genérico já usado no resto do
// marketplace).

function fail(code: MarketplacePaymentErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: MARKETPLACE_PAYMENT_ERROR_STATUS[code] });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedToursFlowRequest(request)) {
    // mesmo padrão do hardening de segurança em POST /bookings -- mesmo
    // evento, reaproveitado (não um tipo novo por rota).
    logSecurityEvent("marketplace_unauthorized");
    return fail("UNAUTHORIZED", "Não autorizado.");
  }

  // X-ToursFlow-Client-Key exigido aqui também -- mesma política de toda
  // chamada autenticada do marketplace, mesmo sendo só leitura (consistência
  // e não abrir uma exceção "GET não precisa" que um cliente antigo poderia
  // explorar pra nunca mandar o header).
  const clientKey = normalizeClientKey(request.headers.get("x-toursflow-client-key"));
  if (!clientKey) return fail("INVALID_CLIENT_KEY", "Cabeçalho X-ToursFlow-Client-Key ausente ou inválido.");

  const admin = createAdminClient();

  // Rate limit do polling (migration/achado da auditoria de prontidão
  // ToursFlow, 2026-09-24): mesma infraestrutura (public.check_rate_limit)
  // e mesmo padrão fail-closed das rotas POST, mas com namespace/limite
  // PRÓPRIOS -- um polling legítimo de status chama este GET com frequência
  // bem maior que criar reserva/pagamento (ver TOURSFLOW_POLL_* em
  // marketplace-api.ts).
  //
  // Checagem do cliente ANTES da global -- achado da revisão adversarial
  // (2026-09-24): check_rate_limit incrementa o contador na própria
  // chamada, então checar a global primeiro deixava um único cliente acima
  // do PRÓPRIO limite (40/min) consumir o orçamento COMPARTILHADO (200/min)
  // com requisições que ainda assim seriam rejeitadas -- na prática,
  // esgotando o polling de status pra todo mundo. Checando o cliente
  // primeiro, uma requisição rejeitada por estourar o limite individual
  // nunca chega a gastar o orçamento global.
  const clientPollRateLimit = await admin.rpc("check_rate_limit", {
    p_consumer_key: buildPollClientRateLimitConsumerKey(clientKey),
    p_max_requests: TOURSFLOW_POLL_CLIENT_RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: TOURSFLOW_POLL_CLIENT_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (clientPollRateLimit.error) return fail("INTERNAL_ERROR", "Erro interno.");
  if (clientPollRateLimit.data !== true) {
    return fail("RATE_LIMITED", "Muitas requisições. Tente novamente em instantes.");
  }

  const globalPollRateLimit = await admin.rpc("check_rate_limit", {
    p_consumer_key: TOURSFLOW_POLL_RATE_LIMIT_CONSUMER_KEY,
    p_max_requests: TOURSFLOW_POLL_RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: TOURSFLOW_POLL_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (globalPollRateLimit.error) return fail("INTERNAL_ERROR", "Erro interno.");
  if (globalPollRateLimit.data !== true) {
    return fail("RATE_LIMITED", "Muitas requisições. Tente novamente em instantes.");
  }

  const { id: bookingId } = await params;
  if (!bookingId) return fail("BOOKING_NOT_FOUND", "Reserva não encontrada.");

  const { data: reservation, error } = await admin
    .from("reservations")
    .select("id, status, hold_expires_at, people_count, total_cents, source, departure_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) return fail("INTERNAL_ERROR", "Erro interno.");
  // 404 genérico -- reserva inexistente e reserva que nunca veio do
  // marketplace (ex: criada manualmente pelo operador) são indistinguíveis
  // pra quem chama.
  if (!reservation || reservation.source !== "marketplace") {
    return fail("BOOKING_NOT_FOUND", "Reserva não encontrada.");
  }

  const { data: departure } = await admin
    .from("departures")
    .select("price_cents")
    .eq("id", reservation.departure_id)
    .maybeSingle();

  // pagamento mais recente desta reserva, se existir alguma tentativa --
  // provider_payment_id é lido só pra reconsultar o QR (nunca devolvido em
  // si na resposta -- é detalhe interno do provider).
  const { data: payment } = await admin
    .from("payments")
    .select("id, status, payment_method, provider_payment_id")
    .eq("reservation_id", reservation.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // PIX só reexibido enquanto: pagamento ainda pending E o hold ainda não
  // venceu -- o hold continua sendo a autoridade de "ainda vale apresentar
  // este Pix como válido pro turista" (ver docs/adr/0007-marketplace-pix-
  // payment-settlement.md), mesmo que a cobrança em si pudesse, em teoria,
  // continuar tecnicamente pagável no provider além disso (política de
  // pagamento tardio já coberta pelo settlement, não pela exibição aqui).
  const holdStillValid = reservation.hold_expires_at !== null && new Date(reservation.hold_expires_at).getTime() > Date.now();

  // CLEANUP LAZY: hold já venceu e o pagamento ainda está pending -- este
  // GET é um dos pontos onde a limpeza acontece (nunca depende só do
  // ToursFlow esconder o QR no frontend dele). Se cancelar de verdade, o
  // status refletido na resposta já é o final ('failed'), sem precisar de
  // uma segunda ida ao banco.
  let effectivePaymentStatus = payment?.status ?? null;
  if (payment && payment.status === "pending" && !holdStillValid) {
    const outcome = await attemptMarketplacePaymentCleanup(admin, {
      id: payment.id,
      status: payment.status,
      providerPaymentId: payment.provider_payment_id,
    });
    if (outcome === "cancelled") effectivePaymentStatus = "failed";
  }

  const dto: MarketplaceBookingStatusDTO = {
    bookingId: reservation.id,
    bookingStatus: reservation.status as "pendente" | "confirmada" | "cancelada",
    holdExpiresAt: reservation.hold_expires_at,
    quantity: reservation.people_count,
    priceCents: (departure?.price_cents as number | undefined) ?? 0,
    totalCents: reservation.total_cents,
    payment: payment ? { status: effectivePaymentStatus ?? payment.status, method: payment.payment_method } : null,
  };

  if (payment?.status === "pending" && payment.provider_payment_id && holdStillValid) {
    const qr = await getMarketplacePixQrCode(payment.provider_payment_id);
    if (qr.ok) {
      dto.pix = { payload: qr.data.payload, encodedImage: qr.data.encodedImage, expirationDate: qr.data.expirationDate };
    }
  }

  return NextResponse.json({ data: dto }, { status: 200 });
}
