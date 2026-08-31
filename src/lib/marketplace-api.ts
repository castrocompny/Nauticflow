// Compartilhado por POST /api/marketplace/bookings (server-to-server, chamado
// futuramente pelo SERVIDOR do ToursFlow, nunca pelo navegador do turista).
// Nada de checkout/Asaas/split/voucher/QR aqui -- só a fundação da reserva
// (hold + idempotência + preço seguro), ver DOCUMENTACAO.md.
//
// Só importado por código server-only (a própria rota) -- import de "crypto"
// abaixo nunca entra em bundle de client.
import { createHash, timingSafeEqual } from "crypto";

// Hold de vaga: decisão de produto já aprovada, fixo em 15 minutos (não é
// parâmetro de configuração de ambiente -- é regra de negócio).
export const MARKETPLACE_HOLD_MINUTES = 15;

// Rate limit do consumidor "toursflow" contra a rota de escrita -- configurável
// por env (nunca hardcoded espalhado pelo código), com um default conservador
// caso a variável não esteja definida.
export const TOURSFLOW_RATE_LIMIT_MAX_REQUESTS = Number(process.env.TOURSFLOW_RATE_LIMIT_MAX_REQUESTS) || 30;
export const TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS = Number(process.env.TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS) || 60;
export const TOURSFLOW_RATE_LIMIT_CONSUMER_KEY = "toursflow";

// Segunda camada de rate limit, POR VISITANTE do ToursFlow -- reaproveita a
// MESMA infraestrutura acima (public.check_rate_limit + public.api_rate_limits),
// só com um consumer_key diferente por chamador. Protege contra um único
// visitante (ou script malicioso se passando por um) esgotar tentativas/vagas
// sozinho, sem depender do limite GLOBAL do consumidor "toursflow" (que existe
// pra proteger o NauticFlow como um todo, não guarda relação com visitante
// individual nenhum). Configurável por env, mesmo padrão do limite global.
export const TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS =
  Number(process.env.TOURSFLOW_CLIENT_RATE_LIMIT_MAX_REQUESTS) || 10;
export const TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS =
  Number(process.env.TOURSFLOW_CLIENT_RATE_LIMIT_WINDOW_SECONDS) || 60;

// O ToursFlow calcula isto no PRÓPRIO servidor dele, a partir do IP do
// visitante (nunca em claro): HMAC-SHA256(TOURSFLOW_API_SECRET, "rate-limit:v1:"
// + ipNormalizado). O NauticFlow só recebe o resultado -- 64 caracteres
// hexadecimais, já pseudônimo, nunca o IP em si. Aceita maiúsculas na entrada
// (case-insensitive) mas sempre normaliza pra minúsculas antes de usar --
// "ABC123..." e "abc123..." têm que cair no MESMO consumer_key de rate limit,
// nunca em dois separados.
const CLIENT_KEY_PATTERN = /^[a-f0-9]{64}$/i;

export function normalizeClientKey(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!CLIENT_KEY_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

// Prefixo próprio ("toursflow:client:") pra nunca colidir com o consumer_key
// global ("toursflow") nem com nenhum outro consumidor futuro que reaproveite
// esta mesma tabela/função -- e deixa claro, só olhando a linha em
// api_rate_limits, que aquele contador é de um visitante individual, não do
// consumidor inteiro. O valor gravado já é o hash (pseudônimo) -- nunca IP,
// e-mail, telefone, CPF ou nome.
export function buildClientRateLimitConsumerKey(normalizedClientKey: string): string {
  return `toursflow:client:${normalizedClientKey}`;
}

// price_type efetivamente vendável nesta primeira versão -- 'a_partir_de' existe
// no catálogo (migration 0039) mas não tem regra de cálculo de total definida,
// então nunca é aceito na criação de reserva (decisão aprovada, não inventada aqui).
export const SELLABLE_PRICE_TYPES = ["por_pessoa", "por_grupo"] as const;
export type SellablePriceType = (typeof SELLABLE_PRICE_TYPES)[number];

export function isSellablePriceType(value: string | null | undefined): value is SellablePriceType {
  return !!value && (SELLABLE_PRICE_TYPES as readonly string[]).includes(value);
}

// cálculo com inteiros (centavos) -- nunca float para dinheiro. Postgres `int`
// (reservations.total_cents) vai até 2147483647 -- MAX_TOTAL_CENTS abaixo é o
// limite real da coluna, checado ANTES do insert pra devolver um 400/422 claro
// em vez de deixar o banco estourar com um erro genérico.
export const POSTGRES_INT4_MAX = 2147483647;

export function calculateTotalCents(priceType: SellablePriceType, priceCents: number, quantity: number): number {
  if (priceType === "por_grupo") return priceCents;
  return priceCents * quantity;
}

// limites de payload -- "razoáveis", não arbitrariamente apertados. quantity
// tem um teto bem acima de qualquer embarcação real (capacidade real quem
// decide é sempre o gatilho de capacidade, isto aqui só barra valor absurdo
// que poderia estourar o cálculo de preço antes de chegar lá).
export const MARKETPLACE_QUANTITY_MAX = 50;
export const CUSTOMER_NAME_MAX_LENGTH = 200;
export const CUSTOMER_EMAIL_MAX_LENGTH = 320; // limite prático de e-mail (RFC 5321)
export const CUSTOMER_PHONE_MAX_LENGTH = 30;

const CPF_DIGITS_PATTERN = /^\d{11}$/;

export function isValidCpfDigits(digitsOnly: string): boolean {
  return CPF_DIGITS_PATTERN.test(digitsOnly);
}

// Autenticação server-to-server compartilhada por TODAS as rotas do
// marketplace (POST /bookings, POST /bookings/[id]/payment, GET
// /bookings/[id]) -- extraída aqui pra nunca duplicar a comparação de
// segredo em mais de um lugar. Comparação em tempo constante -- mesmo
// padrão do webhook do Asaas.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isAuthorizedToursFlowRequest(request: Request): boolean {
  const secret = process.env.TOURSFLOW_API_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return false;
  return safeEqual(match[1], secret);
}

export type MarketplaceBookingErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_CLIENT_KEY"
  | "UNAUTHORIZED"
  | "DEPARTURE_NOT_FOUND"
  | "DEPARTURE_IN_PAST"
  | "DEPARTURE_NOT_SELLABLE"
  | "PRICE_NOT_CONFIGURED"
  | "PRICE_TYPE_NOT_SELLABLE"
  | "INSUFFICIENT_CAPACITY"
  | "IDEMPOTENCY_CONFLICT"
  | "COMPANY_NOT_AVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export const MARKETPLACE_ERROR_STATUS: Record<MarketplaceBookingErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  INVALID_CLIENT_KEY: 400,
  UNAUTHORIZED: 401,
  DEPARTURE_NOT_FOUND: 404,
  DEPARTURE_IN_PAST: 422,
  DEPARTURE_NOT_SELLABLE: 422,
  PRICE_NOT_CONFIGURED: 422,
  PRICE_TYPE_NOT_SELLABLE: 422,
  INSUFFICIENT_CAPACITY: 409,
  IDEMPOTENCY_CONFLICT: 409,
  // 404, não 403/409 -- mesmo princípio de "não revelar motivo administrativo"
  // já usado em DEPARTURE_NOT_FOUND: do ponto de vista de quem chama, uma
  // company suspensa deveria parecer indistinguível de "não existe pra venda".
  COMPANY_NOT_AVAILABLE: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export type MarketplaceBookingDTO = {
  bookingId: string;
  status: "pendente";
  holdExpiresAt: string;
  tour: { slug: string; name: string };
  departure: { id: string; departsAt: string };
  quantity: number;
  priceType: SellablePriceType;
  priceCents: number;
  totalCents: number;
  currency: "BRL";
};

// formato aceito pra Idempotency-Key -- só o suficiente pra rejeitar lixo antes
// de bater no banco (a garantia de unicidade de verdade é o índice único da
// migration 0042, nunca esta validação de formato)
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

export function isValidIdempotencyKey(value: string | null): value is string {
  return !!value && IDEMPOTENCY_KEY_PATTERN.test(value);
}

// Achado na revisão pré-deploy (2 rodadas): uma Idempotency-Key só deve
// representar UMA operação lógica. A 1ª versão deste fingerprint só cobria
// departureId+quantity+e-mail -- ainda deixava passar como "replay válido" um
// reenvio com a MESMA key mas name/phone/cpf DIFERENTES. Cobre agora TODOS os
// campos semanticamente relevantes do payload, cada um normalizado de forma
// determinística ANTES do hash (nunca guarda os dados crus -- só o hash vai
// pro banco, em reservations.request_fingerprint):
//   - name: trim + minúsculas + espaços internos colapsados (" João  Silva "
//     e "joão silva" viram a mesma string canônica)
//   - email: trim + minúsculas
//   - phone: só dígitos (formatação como "(11) 9999-9999" vs "11999999999"
//     não deveria contar como payload diferente)
//   - cpf: já chega aqui normalizado (só dígitos) ou null -- null vira string
//     vazia canônica, pra "não informou cpf" ser sempre a mesma representação
// Calculado exclusivamente aqui no servidor -- nunca a partir de um valor que
// o cliente poderia enviar pronto.
export function computeRequestFingerprint(input: {
  departureId: string;
  quantity: number;
  name: string;
  email: string;
  phone: string | null;
  cpfDigits: string | null;
}): string {
  const canonical = [
    input.departureId,
    String(input.quantity),
    input.name.trim().toLowerCase().replace(/\s+/g, " "),
    input.email.trim().toLowerCase(),
    input.phone ? input.phone.replace(/\D/g, "") : "",
    input.cpfDigits ?? "",
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

// ============================================================================
// FASE 4A -- fundação de pagamento (POST /api/marketplace/bookings/[id]/payment,
// GET /api/marketplace/bookings/[id]). NENHUMA chamada real ao Asaas acontece
// por causa deste módulo -- ver src/lib/asaas.ts (createMarketplacePayment,
// nunca invocada fora de teste) e docs/adr/0001-hold-expirado-vs-pagamento-
// confirmado.md.
// ============================================================================

// Único método planejado (Fase 4B) -- nenhum outro é aceito, nem PIX de
// verdade ainda (a chamada ao provider está desligada nesta fase, ver
// MARKETPLACE_PAYMENTS_ENABLED abaixo).
export const SUPPORTED_PAYMENT_METHODS = ["pix"] as const;
export type SupportedPaymentMethod = (typeof SUPPORTED_PAYMENT_METHODS)[number];

export function isSupportedPaymentMethod(value: unknown): value is SupportedPaymentMethod {
  return typeof value === "string" && (SUPPORTED_PAYMENT_METHODS as readonly string[]).includes(value);
}

// Feature flag explícita (mesmo padrão de IMAGE_MODERATION_MODE) -- nunca
// inferida pela presença/ausência de uma chave Asaas. Enquanto false (o
// default, e o único valor válido nesta fase), o endpoint de pagamento
// valida e registra a tentativa (idempotente, com o valor recalculado
// server-side) mas NUNCA chama o Asaas de verdade -- termina em
// PAYMENT_PROVIDER_NOT_ENABLED. Fica pronta pra Fase 4B só trocar esta env
// var, sem precisar mexer no contrato do endpoint.
export function isMarketplacePaymentsEnabled(): boolean {
  return process.env.MARKETPLACE_PAYMENTS_ENABLED === "true";
}

export type MarketplacePaymentErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_CLIENT_KEY"
  | "UNAUTHORIZED"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_PENDING"
  | "HOLD_EXPIRED"
  | "DEPARTURE_NOT_FOUND"
  | "COMPANY_NOT_AVAILABLE"
  | "PAYMENT_METHOD_NOT_SUPPORTED"
  | "PAYMENT_IDEMPOTENCY_CONFLICT"
  | "PAYMENT_ALREADY_ACTIVE"
  | "PAYMENT_PROVIDER_NOT_ENABLED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export const MARKETPLACE_PAYMENT_ERROR_STATUS: Record<MarketplacePaymentErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  INVALID_CLIENT_KEY: 400,
  UNAUTHORIZED: 401,
  // mesmo princípio de "não revelar motivo administrativo"/isolamento entre
  // companies já usado no resto do marketplace: um bookingId de outra
  // company, inexistente, ou que nunca foi criado via marketplace são todos
  // indistinguíveis do ponto de vista de quem chama.
  BOOKING_NOT_FOUND: 404,
  BOOKING_NOT_PENDING: 409,
  HOLD_EXPIRED: 409,
  DEPARTURE_NOT_FOUND: 404,
  COMPANY_NOT_AVAILABLE: 404,
  PAYMENT_METHOD_NOT_SUPPORTED: 422,
  PAYMENT_IDEMPOTENCY_CONFLICT: 409,
  // já existe uma tentativa pending/paid pra esta reserva -- só libera nova
  // tentativa depois que a anterior sair desses dois estados (ver
  // payments_one_active_per_reservation, migration 0052).
  PAYMENT_ALREADY_ACTIVE: 409,
  PAYMENT_PROVIDER_NOT_ENABLED: 501,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export type MarketplacePaymentAttemptDTO = {
  paymentId: string;
  status: "pending";
  paymentMethod: SupportedPaymentMethod;
  amountCents: number;
  currency: "BRL";
};

export type MarketplaceBookingStatusDTO = {
  bookingId: string;
  bookingStatus: "pendente" | "confirmada" | "cancelada";
  holdExpiresAt: string | null;
  quantity: number;
  priceCents: number;
  totalCents: number;
  payment: { status: string; method: string | null } | null;
};
