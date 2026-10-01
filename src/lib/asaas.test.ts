import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyAsaasPaymentSettled } from "./asaas";

// ASAAS: fetch 100% mockado -- nenhuma chamada de rede real, nenhuma chave
// necessária além de uma string qualquer em ASAAS_API_KEY (só pra passar a
// checagem de "configurado"). Cobre a defesa em profundidade do webhook
// (commit 578cc6d): o valor liquidado e o status vêm SEMPRE da resposta da
// API, nunca de um parâmetro do chamador.

const originalFetch = global.fetch;
const originalApiKey = process.env.ASAAS_API_KEY;

beforeEach(() => {
  process.env.ASAAS_API_KEY = "test-key";
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.ASAAS_API_KEY;
  else process.env.ASAAS_API_KEY = originalApiKey;
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("verifyAsaasPaymentSettled (WEBHOOK settlement authority)", () => {
  it("is not-ok/retryable when ASAAS_API_KEY is missing (never trusts an unverifiable payment)", async () => {
    delete process.env.ASAAS_API_KEY;
    global.fetch = vi.fn() as unknown as typeof fetch;
    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_123",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("is not-ok/non-retryable (PAYMENT_NOT_FOUND) on a 404 from Asaas", async () => {
    mockFetchOnce(404, { errors: [{ description: "not found" }] });
    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_123",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });
    expect(result).toEqual({ ok: false, retryable: false, reason: "PAYMENT_NOT_FOUND" });
  });

  it("is not-ok/retryable on a 5xx (transient provider failure, Asaas should retry the webhook)", async () => {
    mockFetchOnce(503, {});
    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_123",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it("rejects when externalReference does not match the internal payment (forged-webhook-body defense)", async () => {
    mockFetchOnce(200, {
      id: "pay_123",
      status: "RECEIVED",
      value: 150.5,
      externalReference: "some-other-payment",
    });
    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_123",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });
    expect(result).toEqual({ ok: false, retryable: false, reason: "EXTERNAL_REFERENCE_MISMATCH" });
  });

  it("rejects when the status returned by the API is not in the accepted set", async () => {
    mockFetchOnce(200, {
      id: "pay_123",
      status: "PENDING",
      value: 150.5,
      externalReference: "internal-1",
    });
    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_123",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("STATUS_NOT_SETTLED");
  });

  it("returns the settled amount from the API response, in cents -- never from caller input", async () => {
    mockFetchOnce(200, {
      id: "pay_123",
      status: "RECEIVED",
      value: 199.9,
      externalReference: "internal-1",
    });
    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_123",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });
    expect(result).toEqual({ ok: true, status: "RECEIVED", valueCents: 19990 });
  });

  it("rejects a soft-deleted payment even if id/status/reference would otherwise match", async () => {
    mockFetchOnce(200, {
      id: "pay_123",
      status: "RECEIVED",
      value: 100,
      externalReference: "internal-1",
      deleted: true,
    });
    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_123",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });
    expect(result).toEqual({ ok: false, retryable: false, reason: "PAYMENT_NOT_FOUND" });
  });
});
