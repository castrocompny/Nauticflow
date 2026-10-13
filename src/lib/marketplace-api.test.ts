import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isAuthorizedToursFlowRequest,
  normalizeClientKey,
  buildClientRateLimitConsumerKey,
  buildPollClientRateLimitConsumerKey,
  isValidIdempotencyKey,
  isValidCpfDigits,
  computeRequestFingerprint,
  calculateTotalCents,
  isSellablePriceType,
  isMarketplacePaymentsEnabled,
} from "./marketplace-api";

// Base mínima local/mockada (achado da auditoria de prontidão ToursFlow,
// 2026-09-24: zero testes automatizados no repositório). Cobre só lógica
// isolável em memória -- nada aqui toca Postgres/Asaas real.

const ENV_KEYS = ["TOURSFLOW_API_SECRET", "MARKETPLACE_PAYMENTS_ENABLED"] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://nauticflow.com.br/api/marketplace/bookings", { headers });
}

describe("isAuthorizedToursFlowRequest (AUTH)", () => {
  it("rejects when TOURSFLOW_API_SECRET is not configured (fail-closed)", () => {
    delete process.env.TOURSFLOW_API_SECRET;
    expect(isAuthorizedToursFlowRequest(req({ authorization: "Bearer anything" }))).toBe(false);
  });

  it("rejects when the Authorization header is absent", () => {
    process.env.TOURSFLOW_API_SECRET = "correct-secret";
    expect(isAuthorizedToursFlowRequest(req())).toBe(false);
  });

  it("rejects a malformed Authorization header (no Bearer prefix)", () => {
    process.env.TOURSFLOW_API_SECRET = "correct-secret";
    expect(isAuthorizedToursFlowRequest(req({ authorization: "correct-secret" }))).toBe(false);
  });

  it("rejects an incorrect Bearer secret", () => {
    process.env.TOURSFLOW_API_SECRET = "correct-secret";
    expect(isAuthorizedToursFlowRequest(req({ authorization: "Bearer wrong-secret" }))).toBe(false);
  });

  it("accepts a correct Bearer secret", () => {
    process.env.TOURSFLOW_API_SECRET = "correct-secret";
    expect(isAuthorizedToursFlowRequest(req({ authorization: "Bearer correct-secret" }))).toBe(true);
  });
});

describe("normalizeClientKey", () => {
  it("rejects null/empty", () => {
    expect(normalizeClientKey(null)).toBeNull();
    expect(normalizeClientKey("")).toBeNull();
  });

  it("rejects a key that is not a 64-char hex string", () => {
    expect(normalizeClientKey("not-hex")).toBeNull();
    expect(normalizeClientKey("a".repeat(63))).toBeNull();
  });

  it("lowercases a valid hex key so upper/lowercase share the same rate-limit bucket", () => {
    const hex = "A".repeat(64);
    expect(normalizeClientKey(hex)).toBe("a".repeat(64));
  });
});

describe("rate limit consumer key builders", () => {
  it("booking/payment and polling client keys use disjoint namespaces for the same visitor", () => {
    const clientKey = "b".repeat(64);
    const bookingKey = buildClientRateLimitConsumerKey(clientKey);
    const pollKey = buildPollClientRateLimitConsumerKey(clientKey);
    expect(bookingKey).not.toBe(pollKey);
    expect(bookingKey.startsWith("toursflow:client:")).toBe(true);
    expect(pollKey.startsWith("toursflow:poll:client:")).toBe(true);
  });
});

describe("isValidIdempotencyKey", () => {
  it("rejects null, too short, and invalid characters", () => {
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("has spaces and stuff!!")).toBe(false);
  });

  it("accepts a well-formed key", () => {
    expect(isValidIdempotencyKey("toursflow-booking-12345678")).toBe(true);
  });
});

describe("isValidCpfDigits", () => {
  it("rejects anything that is not exactly 11 digits", () => {
    expect(isValidCpfDigits("123")).toBe(false);
    expect(isValidCpfDigits("123.456.789-00")).toBe(false);
  });

  it("accepts 11 digits", () => {
    expect(isValidCpfDigits("12345678900")).toBe(true);
  });
});

describe("computeRequestFingerprint (BOOKING idempotency payload integrity)", () => {
  const base = {
    departureId: "dep-1",
    quantity: 2,
    name: "Ana Silva",
    email: "ana@example.com",
    phone: "(11) 99999-9999",
    cpfDigits: "12345678900",
  };

  it("is deterministic for the same logical payload", () => {
    expect(computeRequestFingerprint(base)).toBe(computeRequestFingerprint(base));
  });

  it("is insensitive to name/email casing and phone formatting", () => {
    const variant = {
      ...base,
      name: "ANA   silva",
      email: "ANA@EXAMPLE.COM",
      phone: "11999999999",
    };
    expect(computeRequestFingerprint(base)).toBe(computeRequestFingerprint(variant));
  });

  it("changes when the customer identity differs (replay-with-different-payload detection)", () => {
    const differentCustomer = { ...base, email: "outra@example.com" };
    expect(computeRequestFingerprint(base)).not.toBe(computeRequestFingerprint(differentCustomer));
  });

  it("changes when quantity differs", () => {
    const differentQuantity = { ...base, quantity: 3 };
    expect(computeRequestFingerprint(base)).not.toBe(computeRequestFingerprint(differentQuantity));
  });
});

describe("calculateTotalCents (PAYMENT/BOOKING price authority)", () => {
  it("por_pessoa multiplies price by quantity", () => {
    expect(calculateTotalCents("por_pessoa", 5000, 3)).toBe(15000);
  });

  it("por_grupo ignores quantity -- flat price for the whole group", () => {
    expect(calculateTotalCents("por_grupo", 50000, 8)).toBe(50000);
  });
});

describe("isSellablePriceType", () => {
  it("accepts only the sellable set", () => {
    expect(isSellablePriceType("por_pessoa")).toBe(true);
    expect(isSellablePriceType("por_grupo")).toBe(true);
  });

  it("rejects a_partir_de (no total-calculation rule defined yet) and garbage", () => {
    expect(isSellablePriceType("a_partir_de")).toBe(false);
    expect(isSellablePriceType("whatever")).toBe(false);
    expect(isSellablePriceType(null)).toBe(false);
  });
});

describe("isMarketplacePaymentsEnabled (FLAGS)", () => {
  it("is false when the env var is absent (fail-closed)", () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    expect(isMarketplacePaymentsEnabled()).toBe(false);
  });

  it("is false for any value other than the exact string 'true'", () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "1";
    expect(isMarketplacePaymentsEnabled()).toBe(false);
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "TRUE";
    expect(isMarketplacePaymentsEnabled()).toBe(false);
  });

  it("is true only for the exact string 'true'", () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    expect(isMarketplacePaymentsEnabled()).toBe(true);
  });
});
