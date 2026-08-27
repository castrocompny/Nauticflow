import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MARKETPLACE_HOLD_MINUTES,
  MARKETPLACE_ERROR_STATUS,
  MARKETPLACE_QUANTITY_MAX,
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
  POSTGRES_INT4_MAX,
  TOURSFLOW_RATE_LIMIT_MAX_REQUESTS,
  TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS,
  TOURSFLOW_RATE_LIMIT_CONSUMER_KEY,
  TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS,
  TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS,
  isSellablePriceType,
  isValidIdempotencyKey,
  isValidCpfDigits,
  calculateTotalCents,
  computeRequestFingerprint,
  normalizeClientKey,
  buildClientRateLimitConsumerKey,
  type MarketplaceBookingErrorCode,
  type MarketplaceBookingDTO,
} from "@/lib/marketplace-api";

export const dynamic = "force-dynamic";

// Rota servidor-servidor pro ToursFlow INICIAR uma reserva (nasce "pendente",
// com hold de vaga -- ver DOCUMENTACAO.md). Fora de escopo aqui: checkout,
// Asaas, split, voucher, QR, área do cliente. O navegador do turista nunca deve
// chamar esta rota diretamente -- só o SERVIDOR do ToursFlow, com o segredo
// compartilhado (nunca exposto a um cliente/navegador).
//
// Resolução de cliente + criação da reserva rodam ATOMICAMENTE dentro da RPC
// create_marketplace_booking (migration 0042) -- achado na revisão pré-deploy:
// fazer isso em chamadas separadas a partir daqui deixava um `client` órfão
// pra trás quando a requisição perdia uma corrida de Idempotency-Key.

function fail(code: MarketplaceBookingErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: MARKETPLACE_ERROR_STATUS[code] });
}

// comparação em tempo constante -- mesmo padrão já usado no webhook do Asaas
// (src/app/api/webhooks/asaas/route.ts): "!==" normal vaza, por timing, quantos
// caracteres iniciais bateram.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.TOURSFLOW_API_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return false;
  return safeEqual(match[1], secret);
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

type TourEmbed = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  marketplace_status: string;
  price_type: string;
};

type BookingRpcRow = {
  booking_id: string;
  hold_expires_at: string;
  people_count: number;
  total_cents: number;
  is_replay: boolean;
};

export async function POST(request: Request) {
  // 401 sempre primeiro, sem revelar qual parte da autenticação falhou (sem
  // header, header mal formado, ou segredo errado -- mesma resposta genérica)
  if (!isAuthorized(request)) return fail("UNAUTHORIZED", "Não autorizado.");

  const admin = createAdminClient();

  // ==========================================================================
  // X-ToursFlow-Client-Key: só é considerada DEPOIS do Bearer validado acima --
  // nunca aceitar isto de uma requisição não autenticada. É um pseudônimo do
  // visitante final do ToursFlow (HMAC-SHA256 do IP normalizado, calculado no
  // SERVIDOR do ToursFlow -- o NauticFlow nunca vê o IP em si, nunca recebe
  // X-Forwarded-For, e não guarda nada além do hash já pronto). Exigida em toda
  // chamada autenticada -- uma implementação antiga do ToursFlow que não a
  // envie ainda não consegue contornar o limite por visitante (seção 6 abaixo).
  // ==========================================================================
  const clientKey = normalizeClientKey(request.headers.get("x-toursflow-client-key"));
  if (!clientKey) return fail("INVALID_CLIENT_KEY", "Cabeçalho X-ToursFlow-Client-Key ausente ou inválido.");

  // rate limit GLOBAL do consumidor "toursflow" -- protege o NauticFlow contra
  // volume total excessivo vindo do marketplace como um todo, independente de
  // quantos visitantes distintos geraram esse volume.
  const globalRateLimit = await admin.rpc("check_rate_limit", {
    p_consumer_key: TOURSFLOW_RATE_LIMIT_CONSUMER_KEY,
    p_max_requests: TOURSFLOW_RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (globalRateLimit.error) return fail("INTERNAL_ERROR", "Erro interno.");
  if (globalRateLimit.data !== true) {
    return fail("RATE_LIMITED", "Muitas requisições. Tente novamente em instantes.");
  }

  // rate limit POR VISITANTE -- mesma função/tabela, consumer_key própria por
  // hash de cliente (nunca cria tabela nova). Protege contra um único
  // visitante monopolizar tentativas/vagas, independente do volume global
  // ainda estar dentro do limite acima.
  const clientRateLimit = await admin.rpc("check_rate_limit", {
    p_consumer_key: buildClientRateLimitConsumerKey(clientKey),
    p_max_requests: TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (clientRateLimit.error) return fail("INTERNAL_ERROR", "Erro interno.");
  if (clientRateLimit.data !== true) {
    // mesma mensagem genérica do limite global -- nunca revela qual das duas
    // camadas bloqueou, nem contador, hash ou qualquer detalhe interno.
    return fail("RATE_LIMITED", "Muitas requisições. Tente novamente em instantes.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return fail("INVALID_IDEMPOTENCY_KEY", "Cabeçalho Idempotency-Key ausente ou inválido.");
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("INVALID_REQUEST", "Corpo da requisição inválido.");

  const departureId = String((body as Record<string, unknown>).departureId ?? "").trim();
  const quantity = Number((body as Record<string, unknown>).quantity);
  const customer = (body as Record<string, unknown>).customer as Record<string, unknown> | undefined;

  if (!departureId) return fail("INVALID_REQUEST", "departureId é obrigatório.");
  // limite superior evita valor absurdo estourando o cálculo de preço antes de
  // chegar na checagem de capacidade real (essa sim, a autoridade de verdade)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MARKETPLACE_QUANTITY_MAX) {
    return fail("INVALID_REQUEST", `quantity deve ser um número inteiro entre 1 e ${MARKETPLACE_QUANTITY_MAX}.`);
  }
  if (!customer || typeof customer !== "object") return fail("INVALID_REQUEST", "customer é obrigatório.");

  const customerName = String(customer.name ?? "").trim();
  const customerEmail = String(customer.email ?? "").trim();
  const customerPhone = String(customer.phone ?? "").trim() || null;
  const customerCpfRaw = customer.cpf ? String(customer.cpf).trim() : "";

  if (!customerName || customerName.length > CUSTOMER_NAME_MAX_LENGTH) {
    return fail("INVALID_REQUEST", "customer.name é obrigatório e deve ser razoavelmente curto.");
  }
  if (!customerEmail || !customerEmail.includes("@") || customerEmail.length > CUSTOMER_EMAIL_MAX_LENGTH) {
    return fail("INVALID_REQUEST", "customer.email inválido.");
  }
  if (customerPhone && customerPhone.length > CUSTOMER_PHONE_MAX_LENGTH) {
    return fail("INVALID_REQUEST", "customer.phone é inválido.");
  }
  const normalizedCpf = customerCpfRaw ? onlyDigits(customerCpfRaw) : null;
  if (normalizedCpf && !isValidCpfDigits(normalizedCpf)) {
    return fail("INVALID_REQUEST", "customer.cpf inválido -- se informado, deve ter 11 dígitos.");
  }

  // ==========================================================================
  // 1. RESOLUÇÃO SERVER-SIDE: departure -> tour -> company. Nunca aceitar
  // company_id/price/total/status/source/tour_id/payment_status do request --
  // tudo isso é decidido aqui, a partir só do departureId.
  // ==========================================================================

  const { data: departure, error: departureError } = await admin
    .from("departures")
    .select(
      "id, company_id, departs_at, status, price_cents, price_type, tours(id, slug, name, active, marketplace_status, price_type)"
    )
    .eq("id", departureId)
    .maybeSingle();

  if (departureError) return fail("INTERNAL_ERROR", "Erro ao consultar a saída.");

  const tour = departure
    ? ((Array.isArray(departure.tours) ? departure.tours[0] : departure.tours) as TourEmbed | null)
    : null;

  // mesmo 404 genérico para: saída inexistente, passeio inexistente/inativo, ou
  // passeio não publicado -- nunca revelar qual desses é o caso real (mesma
  // lógica de "not found" já usada em /api/public/tours/[slug])
  if (!departure || !tour || !tour.active || tour.marketplace_status !== "published") {
    return fail("DEPARTURE_NOT_FOUND", "Saída não encontrada.");
  }

  if (new Date(departure.departs_at as string).getTime() <= Date.now()) {
    return fail("DEPARTURE_IN_PAST", "Esta saída já ocorreu.");
  }
  if (departure.status !== "agendada") {
    return fail("DEPARTURE_NOT_SELLABLE", "Esta saída não está disponível para venda.");
  }
  if (departure.price_cents == null) {
    return fail("PRICE_NOT_CONFIGURED", "Esta saída ainda não tem preço configurado para venda.");
  }

  // ==========================================================================
  // 2. PREÇO: departures.price_cents é sempre a fonte oficial -- o request nunca
  // é consultado pra isso, nem se o campo vier preenchido. Inteiros sempre;
  // checa contra o limite real da coluna (Postgres int4) antes de persistir.
  // ==========================================================================

  const effectivePriceType = (departure.price_type as string | null) ?? tour.price_type;
  if (!isSellablePriceType(effectivePriceType)) {
    return fail("PRICE_TYPE_NOT_SELLABLE", "Este tipo de preço ainda não está disponível para reserva.");
  }
  const priceCents = departure.price_cents as number;
  const totalCents = calculateTotalCents(effectivePriceType, priceCents, quantity);
  if (!Number.isSafeInteger(totalCents) || totalCents > POSTGRES_INT4_MAX) {
    return fail("INVALID_REQUEST", "Quantidade solicitada resulta em um valor total inválido.");
  }

  // ==========================================================================
  // 3. CRIA A RESERVA (cliente + reserva, atômico -- ver create_marketplace_
  // booking na migration 0042). A garantia de idempotência (índice único),
  // de capacidade (trigger check_departure_capacity) e de que uma mesma
  // Idempotency-Key nunca representa duas operações diferentes (fingerprint)
  // vivem inteiramente no banco -- nunca em checagem prévia no TypeScript, que
  // não protegeria contra duas requisições verdadeiramente concorrentes.
  // ==========================================================================

  const requestFingerprint = computeRequestFingerprint({
    departureId,
    quantity,
    name: customerName,
    email: customerEmail,
    phone: customerPhone,
    cpfDigits: normalizedCpf,
  });

  const { data: rows, error: rpcError } = await admin.rpc("create_marketplace_booking", {
    p_departure_id: departureId,
    p_quantity: quantity,
    p_total_cents: totalCents,
    p_customer_name: customerName,
    p_customer_email: customerEmail,
    p_customer_phone: customerPhone,
    p_customer_cpf: normalizedCpf,
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: requestFingerprint,
    p_hold_minutes: MARKETPLACE_HOLD_MINUTES,
  });

  if (rpcError) {
    if (rpcError.message.includes("IDEMPOTENCY_CONFLICT")) {
      return fail("IDEMPOTENCY_CONFLICT", "Esta Idempotency-Key já foi usada para uma reserva diferente.");
    }
    if (rpcError.message.includes("Capacidade excedida")) {
      return fail("INSUFFICIENT_CAPACITY", "Não há vagas suficientes nesta saída.");
    }
    if (rpcError.message.includes("DEPARTURE_NOT_FOUND")) {
      return fail("DEPARTURE_NOT_FOUND", "Saída não encontrada.");
    }
    return fail("INTERNAL_ERROR", "Erro ao criar a reserva.");
  }

  const result = (Array.isArray(rows) ? rows[0] : rows) as BookingRpcRow | undefined;
  if (!result) return fail("INTERNAL_ERROR", "Erro ao criar a reserva.");

  const dto: MarketplaceBookingDTO = {
    bookingId: result.booking_id,
    status: "pendente",
    holdExpiresAt: result.hold_expires_at,
    tour: { slug: tour.slug, name: tour.name },
    departure: { id: departure.id as string, departsAt: departure.departs_at as string },
    quantity: result.people_count,
    priceType: effectivePriceType,
    priceCents,
    totalCents: result.total_cents,
    currency: "BRL",
  };

  return NextResponse.json(
    { data: dto },
    result.is_replay ? { status: 200, headers: { "Idempotency-Replayed": "true" } } : { status: 201 }
  );
}
