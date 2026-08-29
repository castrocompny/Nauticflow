import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isAuthorizedToursFlowRequest,
  normalizeClientKey,
  MARKETPLACE_PAYMENT_ERROR_STATUS,
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
  if (!isAuthorizedToursFlowRequest(request)) return fail("UNAUTHORIZED", "Não autorizado.");

  // X-ToursFlow-Client-Key exigido aqui também -- mesma política de toda
  // chamada autenticada do marketplace, mesmo sendo só leitura (consistência
  // e não abrir uma exceção "GET não precisa" que um cliente antigo poderia
  // explorar pra nunca mandar o header).
  const clientKey = normalizeClientKey(request.headers.get("x-toursflow-client-key"));
  if (!clientKey) return fail("INVALID_CLIENT_KEY", "Cabeçalho X-ToursFlow-Client-Key ausente ou inválido.");

  const { id: bookingId } = await params;
  if (!bookingId) return fail("BOOKING_NOT_FOUND", "Reserva não encontrada.");

  const admin = createAdminClient();

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
  // só status/método, nunca provider_payment_id/payload/wallet.
  const { data: payment } = await admin
    .from("payments")
    .select("status, payment_method")
    .eq("reservation_id", reservation.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dto: MarketplaceBookingStatusDTO = {
    bookingId: reservation.id,
    bookingStatus: reservation.status as "pendente" | "confirmada" | "cancelada",
    holdExpiresAt: reservation.hold_expires_at,
    quantity: reservation.people_count,
    priceCents: (departure?.price_cents as number | undefined) ?? 0,
    totalCents: reservation.total_cents,
    payment: payment ? { status: payment.status, method: payment.payment_method } : null,
  };

  return NextResponse.json({ data: dto }, { status: 200 });
}
