import { describe, it, expect, beforeEach, vi } from "vitest";

// startAsaasCheckout chamada DIRETAMENTE (como um POST de Server Action faria,
// sem página/botão/layout). Supabase, Asaas e navegação 100% mockados.
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  profile: null as null | { company_id: string | null; role: string; email: string },
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  adminRpc: vi.fn(),
  findOrCreateCustomer: vi.fn(),
  createSubscription: vi.fn(),
  getFirstInvoiceUrl: vi.fn(),
  cancelSubscription: vi.fn(),
  redirect: vi.fn(),
  adminUpdate: vi.fn(),
}));

vi.mock("@/lib/profile", () => ({ getProfile: async () => mocks.profile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/asaas", () => ({
  findOrCreateCustomer: mocks.findOrCreateCustomer,
  createSubscription: mocks.createSubscription,
  getFirstInvoiceUrl: mocks.getFirstInvoiceUrl,
  cancelSubscription: mocks.cancelSubscription,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ROWS: Record<string, unknown> = {
  companies: { id: COMPANY_ID, name: "Empresa Sintética", cnpj: "11222333000181", phone: null, asaas_customer_id: "cus_syn" },
  plans: { code: "pro", name: "Pro", price_cents: 9900, price_cents_yearly: null },
  subscriptions: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockImplementation(() => ({
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: ROWS[table], error: null }) };
      return q;
    },
  }));
  mocks.adminRpc.mockResolvedValue({ error: null });
  mocks.adminUpdate.mockResolvedValue({ error: null });
  mocks.createAdminClient.mockImplementation(() => ({
    rpc: mocks.adminRpc,
    from: () => ({ update: () => ({ eq: mocks.adminUpdate }) }),
  }));
  mocks.findOrCreateCustomer.mockResolvedValue({ ok: true, data: "cus_syn" });
  mocks.createSubscription.mockResolvedValue({ ok: true, data: { id: "sub_syn" } });
  mocks.getFirstInvoiceUrl.mockResolvedValue({ ok: true, data: "https://invoice.example.invalid/1" });
});

function expectNoEffects() {
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.findOrCreateCustomer).not.toHaveBeenCalled();
  expect(mocks.cancelSubscription).not.toHaveBeenCalled();
  expect(mocks.createSubscription).not.toHaveBeenCalled();
  expect(mocks.getFirstInvoiceUrl).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
}

describe("startAsaasCheckout authorization (direct Server Action call)", () => {
  it("rejects a call without a session, before any query or provider call", async () => {
    mocks.profile = null;
    const { startAsaasCheckout } = await import("./billing-actions");
    expect(await startAsaasCheckout("pro", "mensal")).toEqual({ error: "Sessão inválida." });
    expectNoEffects();
  });

  it("rejects staff, before reading company/plan data, using the admin client or calling Asaas", async () => {
    mocks.profile = { company_id: COMPANY_ID, role: "staff", email: "staff@example.invalid" };
    const { startAsaasCheckout } = await import("./billing-actions");
    expect(await startAsaasCheckout("pro", "anual")).toEqual({ error: "Só o administrador da empresa pode assinar ou trocar o plano." });
    expectNoEffects();
  });

  it.each(["company_admin", "super_admin"])("keeps the legitimate flow for %s (link via service_role, then redirect to the invoice)", async (role) => {
    mocks.profile = { company_id: COMPANY_ID, role, email: "admin@example.invalid" };
    const { startAsaasCheckout } = await import("./billing-actions");
    await startAsaasCheckout("pro", "mensal");
    expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_syn", valueCents: 9900, companyId: COMPANY_ID, cycle: "MONTHLY" }));
    expect(mocks.adminRpc).toHaveBeenCalledWith("link_asaas_subscription", expect.objectContaining({ p_company_id: COMPANY_ID, p_plan_code: "pro" }));
    expect(mocks.redirect).toHaveBeenCalledWith("https://invoice.example.invalid/1");
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

describe("billing console logs carry only codes", () => {
  it.each(RAW_ERROR_CASES)("startAsaasCheckout link_asaas_subscription: %s", async (_l, error, code) => {
    mocks.profile = { company_id: COMPANY_ID, role: "company_admin", email: "admin@example.invalid" };
    mocks.adminRpc.mockResolvedValue({ error });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startAsaasCheckout } = await import("./billing-actions");
    expect(await startAsaasCheckout("pro", "mensal")).toEqual({ error: "Cobrança criada, mas houve um erro ao vincular a assinatura. Entre em contato com o suporte." });
    expectOnlyCode(spy, "startAsaasCheckout link_asaas_subscription:", code);
    spy.mockRestore();
  });
  it.each(RAW_ERROR_CASES)("cancelAsaasSubscription: %s", async (_l, error, code) => {
    mocks.profile = { company_id: COMPANY_ID, role: "company_admin", email: "admin@example.invalid" };
    mocks.createClient.mockImplementation(() => ({
      from: () => {
        const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: { id: "sub-row", status: "ativa", paid_until: null, asaas_subscription_id: "sub_syn" }, error: null }) };
        return q;
      },
    }));
    mocks.cancelSubscription.mockResolvedValue({ ok: true });
    mocks.adminUpdate.mockResolvedValue({ error });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cancelAsaasSubscription } = await import("./billing-actions");
    expect(await cancelAsaasSubscription()).toEqual({ error: "Não foi possível cancelar a assinatura. Tente novamente." });
    expectOnlyCode(spy, "cancelAsaasSubscription:", code);
    spy.mockRestore();
  });
});
