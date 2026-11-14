import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMarketplacePixTransfer,
  createSubscription,
  getMarketplacePixQrCode,
  verifyAsaasPaymentSettled,
} from "./asaas";

// Trava de ambiente do Asaas: fora de Produção identificada pela Vercel,
// nenhuma chamada pode sair para o endpoint de Produção. fetch é sempre
// mockado (vitest.setup.ts bloqueia rede); env só via vi.stubEnv, restaurado
// a cada teste. Nenhuma chave real, nenhuma chave Pix real.

const PROD_URL = "https://api.asaas.com/v3";
const SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
const FAKE_KEY = "test-key-not-real";
const originalFetch = global.fetch;

function setRuntime(vercelEnv: string | undefined, targetEnv?: string) {
  vi.stubEnv("VERCEL_ENV", vercelEnv);
  vi.stubEnv("VERCEL_TARGET_ENV", targetEnv);
}

function mockFetchOk(body: unknown = { id: "sub_1" }) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const subscriptionParams = { customerId: "cus_1", valueCents: 1000, planName: "Teste", companyId: "company-1" };

function expectSafeError(error: string) {
  for (const leaked of ["asaas.com", "ASAAS", "VERCEL", "http", FAKE_KEY]) {
    expect(error).not.toContain(leaked);
  }
}

beforeEach(() => {
  vi.stubEnv("ASAAS_API_KEY", FAKE_KEY);
  vi.stubEnv("ASAAS_API_URL", undefined);
  setRuntime(undefined, undefined);
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Asaas transport environment lock -- SaaS", () => {
  it.each([
    ["Preview", "preview", undefined],
    ["development/local (no Vercel signal)", undefined, undefined],
    ["unknown Vercel environment", "staging", undefined],
    ["custom Vercel target environment", "preview", "staging"],
    ["conflicting signals (VERCEL_ENV production, target preview)", "production", "preview"],
  ])("refuses the Production endpoint before fetch in %s", async (_label, vercelEnv, targetEnv) => {
    setRuntime(vercelEnv, targetEnv);
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk();

    const result = await createSubscription(subscriptionParams);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBeUndefined();
      expectSafeError(result.error);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL_ENV production with empty target", "production", ""],
    ["VERCEL_ENV production with custom target", "production", "staging"],
    ["inverse conflict (VERCEL_ENV preview, target production)", "preview", "production"],
    ["only target production, VERCEL_ENV absent", undefined, "production"],
    ["empty VERCEL_ENV", "", undefined],
    ["VERCEL_ENV development", "development", undefined],
  ])("refuses the Production endpoint before fetch with %s", async (_label, vercelEnv, targetEnv) => {
    setRuntime(vercelEnv, targetEnv);
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk();

    const result = await createSubscription(subscriptionParams);

    expect(result.ok).toBe(false);
    if (!result.ok) expectSafeError(result.error);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("calls the Production endpoint when VERCEL_ENV is production and the target is absent", async () => {
    setRuntime("production", undefined);
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk();

    expect((await createSubscription(subscriptionParams)).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.asaas.com/v3/subscriptions");
  });

  it("calls the Production endpoint with a single trailing slash in Production", async () => {
    setRuntime("production", "production");
    vi.stubEnv("ASAAS_API_URL", `${PROD_URL}/`);
    const fetchFn = mockFetchOk();

    expect((await createSubscription(subscriptionParams)).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.asaas.com/v3/subscriptions");
  });

  it("keeps calling the Production endpoint when Vercel identifies Production", async () => {
    setRuntime("production", "production");
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk();

    const result = await createSubscription(subscriptionParams);

    expect(result).toEqual({ ok: true, data: { id: "sub_1" } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.asaas.com/v3/subscriptions");
  });

  it.each([
    ["Preview", "preview"],
    ["development/local", undefined],
    ["Production", "production"],
  ])("allows the Sandbox endpoint in %s", async (_label, vercelEnv) => {
    setRuntime(vercelEnv);
    vi.stubEnv("ASAAS_API_URL", SANDBOX_URL);
    const fetchFn = mockFetchOk();

    expect((await createSubscription(subscriptionParams)).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api-sandbox.asaas.com/v3/subscriptions");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("defaults to Sandbox when the URL is %s", async (_label, value) => {
    setRuntime("preview");
    vi.stubEnv("ASAAS_API_URL", value);
    const fetchFn = mockFetchOk();

    expect((await createSubscription(subscriptionParams)).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api-sandbox.asaas.com/v3/subscriptions");
  });

  it("normalizes a single trailing slash without doubling it in the endpoint", async () => {
    setRuntime("preview");
    vi.stubEnv("ASAAS_API_URL", `${SANDBOX_URL}/`);
    const fetchFn = mockFetchOk();

    expect((await createSubscription(subscriptionParams)).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api-sandbox.asaas.com/v3/subscriptions");
  });

  it.each([
    ["http scheme", "http://api.asaas.com/v3"],
    ["look-alike suffix host", "https://api.asaas.com.evil.example/v3"],
    ["look-alike sandbox host", "https://api-sandbox.asaas.com.evil.example/v3"],
    ["sandbox word only in path", "https://evil.example/api-sandbox.asaas.com/v3"],
    ["sandbox word only in query", "https://evil.example/v3?sandbox"],
    ["trailing-dot host", "https://api.asaas.com./v3"],
    ["embedded credentials", "https://user:pass@api.asaas.com/v3"],
    ["unexpected port", "https://api.asaas.com:8443/v3"],
    ["query string", "https://api.asaas.com/v3?x=1"],
    ["empty query", "https://api.asaas.com/v3?"],
    ["fragment", "https://api.asaas.com/v3#frag"],
    ["wrong base path", "https://api.asaas.com/v2"],
    ["extra path", "https://api.asaas.com/v3/extra"],
    ["no base path", "https://api.asaas.com"],
    ["malformed", "not a url"],
    // formas que new URL() normalizaria para o endpoint canônico
    ["explicit default port :443", "https://api.asaas.com:443/v3"],
    ["dot-dot path segment", "https://api.asaas.com/x/../v3"],
    ["dot path segment", "https://api.asaas.com/./v3"],
    ["backslash separator", "https://api.asaas.com\\v3"],
    ["empty userinfo", "https://@api.asaas.com/v3"],
    ["tab inside host", "https://api.asa\tas.com/v3"],
    ["uppercase scheme/host", "HTTPS://API.ASAAS.COM/v3"],
    ["double trailing slash", "https://api.asaas.com/v3//"],
    ["sandbox :443", "https://api-sandbox.asaas.com:443/v3"],
    ["sandbox dot-dot", "https://api-sandbox.asaas.com/v3/x/.."],
  ])("refuses a custom/look-alike URL (%s) even in Production", async (_label, url) => {
    setRuntime("production", "production");
    vi.stubEnv("ASAAS_API_URL", url);
    const fetchFn = mockFetchOk();

    const result = await createSubscription(subscriptionParams);

    expect(result.ok).toBe(false);
    if (!result.ok) expectSafeError(result.error);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("Asaas transport environment lock -- real marketplace withdrawal", () => {
  const transferParams = {
    withdrawalId: "withdrawal-1",
    amountCents: 1000,
    pixKeyType: "email" as const,
    pixKeyNormalized: "teste@example.invalid",
  };

  beforeEach(() => {
    vi.stubEnv("MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED", "true");
    vi.stubEnv("MARKETPLACE_WITHDRAWAL_MOCK_MODE", undefined);
  });

  it("refuses a real transfer to the Production endpoint from Preview before fetch", async () => {
    setRuntime("preview");
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk({ id: "tr_1" });

    const result = await createMarketplacePixTransfer(transferParams);

    expect(result.ok).toBe(false);
    if (!result.ok) expectSafeError(result.error);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("still sends a real transfer to Sandbox from Preview", async () => {
    setRuntime("preview");
    vi.stubEnv("ASAAS_API_URL", SANDBOX_URL);
    const fetchFn = mockFetchOk({ id: "tr_1" });

    const result = await createMarketplacePixTransfer(transferParams);

    expect(result).toEqual({ ok: true, data: { providerTransferId: "tr_1", status: "processing" } });
    expect(fetchFn.mock.calls[0][0]).toBe("https://api-sandbox.asaas.com/v3/transfers");
  });
});

describe("Asaas transport environment lock -- webhook verification", () => {
  it("stays retryable (webhook answers 503) when Preview points at Production", async () => {
    setRuntime("preview");
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk();

    const result = await verifyAsaasPaymentSettled({
      providerPaymentId: "pay_1",
      expectedExternalReference: "internal-1",
      acceptedStatuses: ["RECEIVED"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("MARKETPLACE_PAYMENTS_MODE guard uses the exact URL validation", () => {
  beforeEach(() => {
    vi.stubEnv("MARKETPLACE_PAYMENTS_ENABLED", "true");
  });

  const qrBody = { encodedImage: "img", payload: "payload" };

  it("refuses mode=sandbox when the URL only contains the word sandbox", async () => {
    setRuntime("preview");
    vi.stubEnv("MARKETPLACE_PAYMENTS_MODE", "sandbox");
    vi.stubEnv("ASAAS_API_URL", "https://evil.example/v3?sandbox");
    const fetchFn = mockFetchOk(qrBody);

    const result = await getMarketplacePixQrCode("pay_1");

    expect(result.ok).toBe(false);
    if (!result.ok) expectSafeError(result.error);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses mode=production with the Sandbox URL", async () => {
    setRuntime("production", "production");
    vi.stubEnv("MARKETPLACE_PAYMENTS_MODE", "production");
    vi.stubEnv("ASAAS_API_URL", SANDBOX_URL);
    const fetchFn = mockFetchOk(qrBody);

    const result = await getMarketplacePixQrCode("pay_1");

    expect(result.ok).toBe(false);
    if (!result.ok) expectSafeError(result.error);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses mode=production with the Production URL outside Production", async () => {
    setRuntime("preview");
    vi.stubEnv("MARKETPLACE_PAYMENTS_MODE", "production");
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk(qrBody);

    expect((await getMarketplacePixQrCode("pay_1")).ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("allows mode=sandbox with the exact Sandbox URL", async () => {
    setRuntime("preview");
    vi.stubEnv("MARKETPLACE_PAYMENTS_MODE", "sandbox");
    vi.stubEnv("ASAAS_API_URL", SANDBOX_URL);
    const fetchFn = mockFetchOk(qrBody);

    expect((await getMarketplacePixQrCode("pay_1")).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api-sandbox.asaas.com/v3/payments/pay_1/pixQrCode");
  });

  it("allows mode=production with the Production URL in Production", async () => {
    setRuntime("production", "production");
    vi.stubEnv("MARKETPLACE_PAYMENTS_MODE", "production");
    vi.stubEnv("ASAAS_API_URL", PROD_URL);
    const fetchFn = mockFetchOk(qrBody);

    expect((await getMarketplacePixQrCode("pay_1")).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.asaas.com/v3/payments/pay_1/pixQrCode");
  });
});
