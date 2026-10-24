import { describe, it, expect, vi, beforeEach } from "vitest";

// Cleanup de um pagamento com claim de criação de cobrança mas SEM
// provider_payment_id (migration 0082): o resultado no Asaas é incerto, então o
// cleanup nunca pode liberar o slot nem reportar "cancelled" -- isso reabriria
// o caminho para um segundo POST.

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
const securityLog = vi.hoisted(() => ({ logSecurityEvent: vi.fn() }));
vi.mock("@/lib/security-log", () => securityLog);
const cancelSpy = vi.hoisted(() => ({ cancelMarketplacePendingPayment: vi.fn() }));
vi.mock("@/lib/asaas", () => cancelSpy);

import { attemptMarketplacePaymentCleanup } from "./marketplace-payment-cleanup";

const PENDING_NO_ID = { id: "p-1", status: "pending", providerPaymentId: null };

beforeEach(() => vi.clearAllMocks());

describe("attemptMarketplacePaymentCleanup (claim sem provider id)", () => {
  it("defers when the database refuses to cancel a claimed attempt without provider id", async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [{ id: "p-1", status: "pending", was_cancelled: false }], error: null }) };
    const outcome = await attemptMarketplacePaymentCleanup(admin as never, PENDING_NO_ID);

    expect(outcome).toBe("deferred");
    expect(cancelSpy.cancelMarketplacePendingPayment).not.toHaveBeenCalled();
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("payment_cleanup_deferred", expect.objectContaining({ paymentId: "p-1" }));
  });

  it("does not claim cancellation when the database returns no row", async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    expect(await attemptMarketplacePaymentCleanup(admin as never, PENDING_NO_ID)).toBe("failed");
  });

  it("defers after provider deletion when the database reports a concurrent state change", async () => {
    cancelSpy.cancelMarketplacePendingPayment.mockResolvedValue({ ok: true, data: { cancelled: true, currentStatus: null } });
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [{ id: "p-1", status: "paid", was_cancelled: false }], error: null }) };

    expect(await attemptMarketplacePaymentCleanup(admin as never, { ...PENDING_NO_ID, providerPaymentId: "pay-1" })).toBe("deferred");
    expect(cancelSpy.cancelMarketplacePendingPayment).toHaveBeenCalledWith("pay-1");
  });

  it("reports cancellation only after the database confirms it", async () => {
    cancelSpy.cancelMarketplacePendingPayment.mockResolvedValue({ ok: true, data: { cancelled: true, currentStatus: null } });
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [{ id: "p-1", status: "failed", was_cancelled: true }], error: null }) };

    expect(await attemptMarketplacePaymentCleanup(admin as never, { ...PENDING_NO_ID, providerPaymentId: "pay-1" })).toBe("cancelled");
  });
});
