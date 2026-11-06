import { describe, it, expect, beforeEach, vi } from "vitest";

// initiateRealMarketplaceRefund chamada DIRETAMENTE (sem página /admin). O
// helper REAL de src/lib/admin-auth.ts é exercitado; só o client Supabase da
// sessão, o client admin, o Asaas e o Sentry são falsos.
const RESERVATION_ID = "22222222-2222-4222-8222-222222222222";
const REFUND_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  role: "super_admin" as string,
  aal: "aal2" as string,
  sessionRpc: vi.fn(),
  createAdminClient: vi.fn(),
  adminRpc: vi.fn(),
  refund: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.user } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: mocks.aal, nextLevel: "aal2" } }) },
    },
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: mocks.user ? { role: mocks.role, name: "Syn", company_id: null } : null }), single: async () => ({ data: mocks.user ? { id: mocks.user.id, role: mocks.role, company_id: null } : null }) };
      return q;
    },
    rpc: (name: string, args: unknown) => ({ maybeSingle: async () => mocks.sessionRpc(name, args) }),
  }),
}));
vi.mock("@/lib/profile", () => ({ getProfile: async () => (mocks.user ? { id: mocks.user.id, company_id: null, role: mocks.role } : null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/asaas", () => ({ initiateMarketplacePaymentRefund: mocks.refund }));
vi.mock("@/lib/security-log", () => ({ logSecurityEvent: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "44444444-4444-4444-8444-444444444444" };
  mocks.role = "super_admin";
  mocks.aal = "aal2";
  mocks.sessionRpc.mockResolvedValue({ data: { id: REFUND_ID, status: "pending", customer_refund_cents: 5000, operator_deduction_cents: 0, is_replay: false }, error: null });
  mocks.adminRpc.mockImplementation((name: string) => ({
    maybeSingle: async () =>
      name === "get_marketplace_refund_provider_context"
        ? { data: { refund_id: REFUND_ID, refund_status: "pending", customer_refund_cents: 5000, provider_refund_id: null, payment_status: "paid", provider_payment_id: "pay_syn" }, error: null }
        : { data: { id: REFUND_ID, status: "processing", provider_refund_id: "ref_syn" }, error: null },
  }));
  mocks.createAdminClient.mockImplementation(() => ({ rpc: mocks.adminRpc }));
  mocks.refund.mockResolvedValue({ ok: true, data: { providerRefundId: "ref_syn", status: "PENDING" } });
});

function expectNoEffects() {
  expect(mocks.sessionRpc).not.toHaveBeenCalled();
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.refund).not.toHaveBeenCalled();
}

describe("initiateRealMarketplaceRefund authorization", () => {
  it("rejects a super_admin session without the second factor (aal1), before any RPC or provider call", async () => {
    mocks.aal = "aal1";
    const { initiateRealMarketplaceRefund } = await import("./refund-provider-actions");
    const res = await initiateRealMarketplaceRefund(RESERVATION_ID);
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/dois fatores/);
    expectNoEffects();
  });

  it.each([["no session", null, "super_admin"], ["company_admin", { id: "u" }, "company_admin"], ["staff", { id: "u" }, "staff"]])(
    "rejects %s before any effect",
    async (_label, user, role) => {
      mocks.user = user;
      mocks.role = role;
      const { initiateRealMarketplaceRefund } = await import("./refund-provider-actions");
      const res = await initiateRealMarketplaceRefund(RESERVATION_ID);
      expect(res.ok).toBeUndefined();
      expect(res.error).not.toBe("");
      expectNoEffects();
    }
  );

  it("keeps the authorized flow for super_admin with aal2", async () => {
    const { initiateRealMarketplaceRefund } = await import("./refund-provider-actions");
    const res = await initiateRealMarketplaceRefund(RESERVATION_ID);
    expect(res).toEqual({ error: "", ok: true, status: "processing", refundId: REFUND_ID });
    expect(mocks.refund).toHaveBeenCalledWith({ providerPaymentId: "pay_syn", amountCents: 5000 });
  });

  it("never returns or logs the provider's free-text error", async () => {
    const external = "Chave nfsynth.cliente@example.invalid recusada";
    mocks.refund.mockResolvedValue({ ok: false, error: external, status: 400 });
    const { initiateRealMarketplaceRefund } = await import("./refund-provider-actions");
    const res = await initiateRealMarketplaceRefund(RESERVATION_ID);
    expect(res.ok).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("nfsynth");
    expect(mocks.log).toHaveBeenCalledWith("marketplace_refund_provider_initiation_failed", { refundId: REFUND_ID, errorCode: "PROVIDER_HTTP_400" });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("nfsynth");
  });
});

// Rodada 2026-11-06 (6 logs brutos): erro sintético com sentinelas em
// message/details/hint; o console só pode receber rótulo + código.
const RAW_ERROR_CASES = [
  ["unknown token-shaped P0001", { code: "P0001", message: "CLIENTE_CPF_00000000000", details: "nfsynth details", hint: "nfsynth hint" }, "P0001"],
  ["known SQL token", { code: "P0001", message: "WITHDRAWAL_NOT_FOUND", details: "nfsynth details", hint: "nfsynth hint" }, "WITHDRAWAL_NOT_FOUND"],
  ["SQLSTATE with free text", { code: "42501", message: "permission denied nfsynth.cliente@example.invalid", details: "nfsynth details", hint: "nfsynth hint" }, "42501"],
] as const;
function expectOnlyCode(spy: { mock: { calls: unknown[][] } }, label: string, code: string) {
  expect(spy.mock.calls).toEqual([[label, code]]);
  expect(JSON.stringify(spy.mock.calls)).not.toMatch(/nfsynth|00000000000/i);
}

describe("refund console logs carry only codes", () => {
  it.each(RAW_ERROR_CASES)("initiateRealMarketplaceRefund/create: %s", async (_l, error, code) => {
    mocks.sessionRpc.mockResolvedValue({ data: null, error });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { initiateRealMarketplaceRefund } = await import("./refund-provider-actions");
    expect(await initiateRealMarketplaceRefund(RESERVATION_ID)).toEqual({ error: "Não foi possível criar o pedido de reembolso." });
    expectOnlyCode(spy, "initiateRealMarketplaceRefund/create:", code);
    expect(mocks.refund).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it.each(RAW_ERROR_CASES)("initiateRealMarketplaceRefund/context: %s", async (_l, error, code) => {
    mocks.adminRpc.mockImplementation(() => ({ maybeSingle: async () => ({ data: null, error }) }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { initiateRealMarketplaceRefund } = await import("./refund-provider-actions");
    expect(await initiateRealMarketplaceRefund(RESERVATION_ID)).toEqual({ error: "Não foi possível carregar o contexto do reembolso.", refundId: REFUND_ID });
    expectOnlyCode(spy, "initiateRealMarketplaceRefund/context:", code);
    expect(mocks.refund).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
