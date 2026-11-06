import { describe, it, expect, vi, beforeEach } from "vitest";

// Caminho REAL de emissão: logSecurityEvent -> Sentry.captureMessage (SDK
// mockado; nada sai do processo). Sentinelas sintéticas.
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

import { logSecurityEvent } from "./security-log";

const EMAIL = "nfsynth.cliente@example.invalid";

beforeEach(() => sentry.captureMessage.mockClear());

function emitted() {
  expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  return sentry.captureMessage.mock.calls[0] as [string, { level: string; tags: Record<string, string>; extra: Record<string, unknown> }];
}

describe("logSecurityEvent errorCode safety net", () => {
  it("replaces a free-text errorCode before it reaches Sentry, keeping event and ids", () => {
    logSecurityEvent("asaas_webhook_payment_lookup_failed", { event: "PAYMENT_RECEIVED", paymentId: "pay_1", errorCode: `permission denied for ${EMAIL}` });
    const [msg, opts] = emitted();
    expect(msg).toBe("security.asaas_webhook_payment_lookup_failed");
    expect(opts.tags).toEqual({ event: "asaas_webhook_payment_lookup_failed" });
    expect(opts.extra).toEqual({ event: "PAYMENT_RECEIVED", paymentId: "pay_1", errorCode: "UNRECOGNIZED" });
    expect(JSON.stringify(sentry.captureMessage.mock.calls)).not.toContain("nfsynth");
  });

  it("replaces an unknown token-shaped errorCode carrying personal data (closed list, not format)", () => {
    logSecurityEvent("asaas_webhook_payment_lookup_failed", { paymentId: "pay_1", errorCode: "CLIENTE_CPF_00000000000" });
    expect(emitted()[1].extra).toEqual({ paymentId: "pay_1", errorCode: "UNRECOGNIZED" });
    expect(JSON.stringify(sentry.captureMessage.mock.calls)).not.toContain("00000000000");
  });

  it.each([
    "P0001", "42501", "PGRST301", "PROVIDER_HTTP_400", "PROVIDER_ERROR", "NONE", "UNRECOGNIZED", "UNEXPECTED_RESULT",
    "REFUND_NOT_PENDING", "PROVIDER_PAYMENT_ID_MISMATCH", "CONFLICT_CAPTURE_POLICY_MISSING", "AMBIGUOUS_EXISTING_REFUND",
  ])("keeps a known errorCode %s", (code) => {
    logSecurityEvent("x", { errorCode: code });
    expect(emitted()[1].extra).toEqual({ errorCode: code });
  });

  it("leaves extra untouched when there is no errorCode", () => {
    logSecurityEvent("x", { paymentId: "pay_1" });
    expect(emitted()[1].extra).toEqual({ paymentId: "pay_1" });
    sentry.captureMessage.mockClear();
    logSecurityEvent("y");
    expect(emitted()[1].extra).toBeUndefined();
  });
});
