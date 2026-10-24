import { describe, it, expect, beforeEach, vi } from "vitest";

// RECONSTRUÇÃO (o withdrawal-actions.test.ts original do WIP não sobreviveu).
// Cobre só o que o dispatch promete sem Postgres/Asaas reais: toda saída depois
// de uma tentativa de envio fica registrada e NUNCA gera um segundo POST de
// transferência (resultado ambíguo => revisão manual, sem reenvio).

const WITHDRAWAL_ID = "99999999-9999-4999-8999-999999999999";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  transfer: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    rpc: () => ({ maybeSingle: async () => ({ data: { id: WITHDRAWAL_ID, status: "pending", is_replay: false }, error: null }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: WITHDRAWAL_ID, amount_cents: 5000, payout_account_id: "pa-1" }, error: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/profile", () => ({ getProfile: async () => ({ company_id: "c-1", role: "company_admin" }) }));
vi.mock("@/lib/security-log", () => ({ logSecurityEvent: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/asaas", () => ({
  createMarketplacePixTransfer: mocks.transfer,
  isMarketplaceWithdrawalPayoutEnabled: () => true,
}));

function form() {
  const f = new FormData();
  f.set("amount_reais", "50");
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminRpc.mockImplementation(async (name: string) =>
    name === "get_marketplace_payout_account_raw_for_transfer"
      ? { data: [{ pix_key_type: "CPF", pix_key_normalized: "52998224725" }], error: null }
      : { data: null, error: null }
  );
});

describe("createWithdrawal dispatch", () => {
  it("logs a rejected transfer and never posts a second transfer", async () => {
    mocks.transfer.mockResolvedValue({ ok: false, error: "TIMEOUT_OR_HTTP_ERROR", status: 504 });
    const { createWithdrawal } = await import("./withdrawal-actions");

    const result = await createWithdrawal({ error: "" }, form());

    expect(result.ok).toBe(true);
    expect(mocks.transfer).toHaveBeenCalledTimes(1);
    expect(mocks.adminRpc).not.toHaveBeenCalledWith("mark_marketplace_withdrawal_processing", expect.anything());
    expect(mocks.log).toHaveBeenCalledWith("marketplace_withdrawal_dispatch_rejected", {
      withdrawalId: WITHDRAWAL_ID,
      providerStatus: 504,
      errorCode: "TIMEOUT_OR_HTTP_ERROR",
    });
  });

  it("logs a not-sent exit and never posts a transfer when the raw payout key read fails", async () => {
    mocks.adminRpc.mockImplementation(async () => ({ data: null, error: { message: "permission denied" } }));
    const { createWithdrawal } = await import("./withdrawal-actions");

    const result = await createWithdrawal({ error: "" }, form());

    expect(result.ok).toBe(true);
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("marketplace_withdrawal_dispatch_not_sent", {
      withdrawalId: WITHDRAWAL_ID,
      reason: "payout_key_read_failed",
      errorCode: "permission denied",
    });
  });

  it("logs the failure to mark processing after an accepted transfer, without a second transfer", async () => {
    mocks.transfer.mockResolvedValue({ ok: true, data: { providerTransferId: "tr_1" } });
    mocks.adminRpc.mockImplementation(async (name: string) =>
      name === "mark_marketplace_withdrawal_processing"
        ? { data: null, error: { message: "column reference is ambiguous" } }
        : { data: [{ pix_key_type: "CPF", pix_key_normalized: "52998224725" }], error: null }
    );
    const { createWithdrawal } = await import("./withdrawal-actions");

    const result = await createWithdrawal({ error: "" }, form());

    expect(result.ok).toBe(true);
    expect(mocks.transfer).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith("marketplace_withdrawal_mark_processing_failed", {
      withdrawalId: WITHDRAWAL_ID,
      providerTransferId: "tr_1",
      errorCode: "column reference is ambiguous",
    });
  });
});
