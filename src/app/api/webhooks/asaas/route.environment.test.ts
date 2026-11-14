import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Composição real rota -> verifyAsaasPaymentSettled -> asaasFetch (sem mockar
// @/lib/asaas): Preview apontando para o endpoint de Produção precisa virar
// 503 (o Asaas reenvia o webhook) sem nenhum fetch e sem tocar a RPC de
// renovação. Só Supabase e o log são simulados; nenhuma chave real.

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), log: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => {
      mocks.rpc(...args);
      throw new Error("rpc must not be reached");
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          limit: async () => ({ data: [], error: null }),
        }),
      }),
      insert: async () => ({ error: null }),
    }),
  }),
}));
vi.mock("@/lib/security-log", () => ({ logSecurityEvent: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "./route";

const TOKEN = "correct-webhook-token";
const originalFetch = global.fetch;

function saasWebhook(): Request {
  return new Request("https://nauticflow.com.br/api/webhooks/asaas", {
    method: "POST",
    headers: { "content-type": "application/json", "asaas-access-token": TOKEN },
    body: JSON.stringify({
      id: "evt_1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_1", externalReference: "company-not-a-uuid" },
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("ASAAS_WEBHOOK_TOKEN", TOKEN);
  vi.stubEnv("ASAAS_API_KEY", "test-key-not-real");
  vi.stubEnv("ASAAS_API_URL", "https://api.asaas.com/v3");
  mocks.rpc.mockReset();
  mocks.log.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("POST /api/webhooks/asaas -- Asaas environment lock", () => {
  it.each([
    ["Preview", "preview", undefined],
    ["custom target", "production", "staging"],
  ])("answers 503 without fetch when %s points at the Production endpoint", async (_label, vercelEnv, target) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("VERCEL_TARGET_ENV", target);
    const fetchFn = vi.fn();
    global.fetch = fetchFn as unknown as typeof fetch;

    const response = await POST(saasWebhook());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "verification_unavailable" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
