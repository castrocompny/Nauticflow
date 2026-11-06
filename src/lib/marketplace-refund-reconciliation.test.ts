import { describe, it, expect } from "vitest";
import { interpretMarkProcessingResult } from "./marketplace-refund-reconciliation";

// Rodada de correções 2026-11-06: logCode vai para logSecurityEvent (Sentry).
describe("interpretMarkProcessingResult logCode", () => {
  it("uses the structured code, never the RPC's free-text message", () => {
    const out = interpretMarkProcessingResult(null, { code: "XX000", message: "falha nfsynth.cliente@example.invalid" });
    expect(out).toMatchObject({ ok: false, logCode: "XX000" });
    expect(JSON.stringify(out)).not.toContain("nfsynth");
  });
  it("keeps a domain token raised by our SQL (P0001)", () => {
    expect(interpretMarkProcessingResult(null, { code: "P0001", message: "REFUND_NOT_PENDING" })).toMatchObject({ ok: false, logCode: "REFUND_NOT_PENDING" });
  });
  it("still never reports success without an explicit processing row", () => {
    expect(interpretMarkProcessingResult(null, null)).toMatchObject({ ok: false, logCode: "empty_row" });
    expect(interpretMarkProcessingResult({ id: "r", status: "processing", provider_refund_id: "x" }, null)).toEqual({ ok: true, status: "processing" });
  });
});
