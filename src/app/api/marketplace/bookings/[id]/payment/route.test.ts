import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// PAYMENT: cobre só o gate de auth e o gate da flag MARKETPLACE_PAYMENTS_
// ENABLED (achado da FASE 4A -- a checagem precisa vir ANTES de qualquer
// escrita em `payments`/chamada ao Asaas). createAdminClient importa
// "server-only" (não roda fora do Next) -- mock mínimo só pra permitir
// passar pelos rate limits e chegar no gate da flag, sem tocar Postgres/
// Asaas real. O resto do fluxo (RPC de verdade, Asaas de verdade) é
// E2E/DB INTEGRATION REQUIRED, fora do escopo desta base mínima.

const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

const asaasSpies = {
  findOrCreateMarketplaceAsaasCustomer: vi.fn(),
  createOrReconcileMarketplacePixCharge: vi.fn(),
  getMarketplacePixQrCode: vi.fn(),
};

vi.mock("@/lib/asaas", () => asaasSpies);

const ORIGINAL_SECRET = process.env.TOURSFLOW_API_SECRET;
const ORIGINAL_FLAG = process.env.MARKETPLACE_PAYMENTS_ENABLED;

beforeEach(() => {
  process.env.TOURSFLOW_API_SECRET = "correct-secret";
  rpcMock.mockClear();
  rpcMock.mockResolvedValue({ data: true, error: null });
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.TOURSFLOW_API_SECRET;
  else process.env.TOURSFLOW_API_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_FLAG === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_ENABLED = ORIGINAL_FLAG;
  vi.clearAllMocks();
});

function paymentRequest(): Request {
  return new Request("https://nauticflow.com.br/api/marketplace/bookings/b-1/payment", {
    method: "POST",
    headers: {
      authorization: "Bearer correct-secret",
      "x-toursflow-client-key": "a".repeat(64),
      "idempotency-key": "toursflow-payment-12345678",
      "content-type": "application/json",
    },
    body: JSON.stringify({ paymentMethod: "pix" }),
  });
}

describe("POST /api/marketplace/bookings/[id]/payment (AUTH + FLAGS)", () => {
  it("rejects an unauthorized request before creating the admin client's write path", async () => {
    const { POST } = await import("./route");
    const request = new Request("https://nauticflow.com.br/api/marketplace/bookings/b-1/payment", {
      method: "POST",
      headers: { "x-toursflow-client-key": "a".repeat(64) },
    });
    const response = await POST(request, { params: Promise.resolve({ id: "b-1" }) });
    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("blocks with PAYMENT_PROVIDER_NOT_ENABLED when the flag is off, before any Asaas call", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const { POST } = await import("./route");
    const response = await POST(paymentRequest(), { params: Promise.resolve({ id: "b-1" }) });
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("PAYMENT_PROVIDER_NOT_ENABLED");
    expect(asaasSpies.findOrCreateMarketplaceAsaasCustomer).not.toHaveBeenCalled();
    expect(asaasSpies.createOrReconcileMarketplacePixCharge).not.toHaveBeenCalled();
    // gate da flag vem depois dos rate limits (RPC), mas antes de qualquer
    // escrita real de tentativa de pagamento -- create_marketplace_payment_
    // attempt nunca deve ser chamada com o provider desligado.
    expect(rpcMock).not.toHaveBeenCalledWith(
      "create_marketplace_payment_attempt",
      expect.anything()
    );
  });

  it("never calls Asaas when the payment method is unsupported, regardless of the flag", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    const { POST } = await import("./route");
    const request = new Request("https://nauticflow.com.br/api/marketplace/bookings/b-1/payment", {
      method: "POST",
      headers: {
        authorization: "Bearer correct-secret",
        "x-toursflow-client-key": "a".repeat(64),
        "idempotency-key": "toursflow-payment-12345678",
        "content-type": "application/json",
      },
      body: JSON.stringify({ paymentMethod: "credit_card" }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: "b-1" }) });
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("PAYMENT_METHOD_NOT_SUPPORTED");
    expect(asaasSpies.findOrCreateMarketplaceAsaasCustomer).not.toHaveBeenCalled();
  });
});
