import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// PAYMENT: cobre só o gate de auth e o gate da flag MARKETPLACE_PAYMENTS_
// ENABLED (achado da FASE 4A -- a checagem precisa vir ANTES de qualquer
// escrita em `payments`/chamada ao Asaas). createAdminClient importa
// "server-only" (não roda fora do Next) -- mock mínimo só pra permitir
// passar pelos rate limits e chegar no gate da flag, sem tocar Postgres/
// Asaas real. O resto do fluxo (RPC de verdade, Asaas de verdade) é
// E2E/DB INTEGRATION REQUIRED, fora do escopo desta base mínima.

const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null });
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

const securityLog = vi.hoisted(() => ({ logSecurityEvent: vi.fn() }));
vi.mock("@/lib/security-log", () => securityLog);

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

// Cobrança criada no Asaas, mas o vínculo local (provider_payment_id) não
// foi gravado: nunca devolve o QR de uma cobrança que o NauticFlow não
// rastreia. O retry é seguro -- createOrReconcileMarketplacePixCharge procura
// pelo externalReference antes de criar, então não gera segunda cobrança.
describe("POST /api/marketplace/bookings/[id]/payment (vínculo da cobrança)", () => {
  const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";

  function arrangeHappyPath(markResult: { data: unknown; error: { message: string } | null }) {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "check_rate_limit") return { data: true, error: null };
      if (name === "create_marketplace_payment_attempt") {
        return { data: [{ payment_id: PAYMENT_ID, status: "pending", payment_method: "pix", amount_cents: 15000, is_replay: false }], error: null };
      }
      if (name === "mark_marketplace_payment_provider_created") return markResult;
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    });
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { client_id: "c-1", clients: { id: "c-1", name: "Cliente", cpf: "52998224725", email: null, phone: null, asaas_customer_id: "cus_1" } },
            error: null,
          }),
        }),
      }),
    }));
    asaasSpies.findOrCreateMarketplaceAsaasCustomer.mockResolvedValue({ ok: true, data: { customerId: "cus_1" } });
    asaasSpies.createOrReconcileMarketplacePixCharge.mockResolvedValue({ ok: true, data: { providerPaymentId: "pay_1", status: "PENDING" } });
    asaasSpies.getMarketplacePixQrCode.mockResolvedValue({ ok: true, data: { payload: "pix", encodedImage: "img", expirationDate: null } });
  }

  it("does not return the QR code when persisting the provider charge id fails", async () => {
    arrangeHappyPath({ data: null, error: { message: "PROVIDER_PAYMENT_ID_MISMATCH" } });
    const { POST } = await import("./route");

    const response = await POST(paymentRequest(), { params: Promise.resolve({ id: "b-1" }) });

    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(asaasSpies.getMarketplacePixQrCode).not.toHaveBeenCalled();
    expect(asaasSpies.createOrReconcileMarketplacePixCharge).toHaveBeenCalledTimes(1);
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("marketplace_payment_provider_link_failed", {
      paymentId: PAYMENT_ID,
      errorCode: "PROVIDER_PAYMENT_ID_MISMATCH",
    });
  });

  it("returns the QR code once the provider charge id is persisted", async () => {
    arrangeHappyPath({ data: [{ id: PAYMENT_ID, provider_payment_id: "pay_1" }], error: null });
    const { POST } = await import("./route");

    const response = await POST(paymentRequest(), { params: Promise.resolve({ id: "b-1" }) });

    expect(response.status).toBe(201);
    expect(asaasSpies.getMarketplacePixQrCode).toHaveBeenCalledWith("pay_1");
  });
});
