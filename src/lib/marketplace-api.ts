// Compartilhado por POST /api/marketplace/bookings (server-to-server, chamado
// futuramente pelo SERVIDOR do ToursFlow, nunca pelo navegador do turista).
// Nada de checkout/Asaas/split/voucher/QR aqui -- só a fundação da reserva
// (hold + idempotência + preço seguro), ver DOCUMENTACAO.md.
//
// Só importado por código server-only (a própria rota) -- import de "crypto"
// abaixo nunca entra em bundle de client.
import { createHash } from "crypto";

// Hold de vaga: decisão de produto já aprovada, fixo em 15 minutos (não é
// parâmetro de configuração de ambiente -- é regra de negócio).
export const MARKETPLACE_HOLD_MINUTES = 15;

// Rate limit do consumidor "toursflow" contra a rota de escrita -- configurável
// por env (nunca hardcoded espalhado pelo código), com um default conservador
// caso a variável não esteja definida.
export const TOURSFLOW_RATE_LIMIT_MAX_REQUESTS = Number(process.env.TOURSFLOW_RATE_LIMIT_MAX_REQUESTS) || 30;
export const TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS = Number(process.env.TOURSFLOW_RATE_LIMIT_WINDOW_SECONDS) || 60;
export const TOURSFLOW_RATE_LIMIT_CONSUMER_KEY = "toursflow";

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

export type MarketplaceBookingErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IDEMPOTENCY_KEY"
  | "UNAUTHORIZED"
  | "DEPARTURE_NOT_FOUND"
  | "DEPARTURE_IN_PAST"
  | "DEPARTURE_NOT_SELLABLE"
  | "PRICE_NOT_CONFIGURED"
  | "PRICE_TYPE_NOT_SELLABLE"
  | "INSUFFICIENT_CAPACITY"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export const MARKETPLACE_ERROR_STATUS: Record<MarketplaceBookingErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  UNAUTHORIZED: 401,
  DEPARTURE_NOT_FOUND: 404,
  DEPARTURE_IN_PAST: 422,
  DEPARTURE_NOT_SELLABLE: 422,
  PRICE_NOT_CONFIGURED: 422,
  PRICE_TYPE_NOT_SELLABLE: 422,
  INSUFFICIENT_CAPACITY: 409,
  IDEMPOTENCY_CONFLICT: 409,
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
