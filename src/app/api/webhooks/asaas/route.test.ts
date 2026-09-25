import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";

// WEBHOOK: só o que é 100% isolável sem tocar Postgres real -- o gate de
// autenticação (asaas-access-token) e o descarte de evento irrelevante
// acontecem ANTES de qualquer createClient()/chamada ao Supabase (ver
// route.ts), então dá pra exercitar o handler real de ponta a ponta pra
// esses dois casos sem mock nenhum. Dedupe/PAYMENT_RECEIVED/transferência
// dependem de Postgres real -- E2E/DB INTEGRATION REQUIRED, fora do escopo
// desta base mínima.

const ORIGINAL_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

beforeEach(() => {
  process.env.ASAAS_WEBHOOK_TOKEN = "correct-webhook-token";
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
  else process.env.ASAAS_WEBHOOK_TOKEN = ORIGINAL_TOKEN;
  vi.unstubAllGlobals();
});

function webhookRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers["asaas-access-token"] = token;
  return new Request("https://nauticflow.com.br/api/webhooks/asaas", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/asaas (AUTH)", () => {
  it("rejects when ASAAS_WEBHOOK_TOKEN is not configured (fail-closed)", async () => {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    const response = await POST(webhookRequest({ event: "PAYMENT_RECEIVED" }, "anything"));
    expect(response.status).toBe(401);
  });

  it("rejects when the asaas-access-token header is absent", async () => {
    const response = await POST(webhookRequest({ event: "PAYMENT_RECEIVED" }));
    expect(response.status).toBe(401);
  });

  it("rejects an incorrect token", async () => {
    const response = await POST(webhookRequest({ event: "PAYMENT_RECEIVED" }, "wrong-token"));
    expect(response.status).toBe(401);
  });

  it("accepts a correct token and never touches the network for an irrelevant event", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const response = await POST(webhookRequest({ event: "SOME_UNKNOWN_EVENT" }, "correct-webhook-token"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores an authenticated request with no payment/transfer body (no network call)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const response = await POST(webhookRequest({ event: "PAYMENT_RECEIVED" }, "correct-webhook-token"));
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
