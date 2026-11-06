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
  sessionRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    rpc: (name: string, args: unknown) => ({
      maybeSingle: async () => mocks.sessionRpc(name, args),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(mocks.sessionRpc(name, args)).then(ok, ko),
    }),
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
  mocks.sessionRpc.mockResolvedValue({ data: { id: WITHDRAWAL_ID, status: "pending", is_replay: false }, error: null });
  mocks.adminRpc.mockImplementation(async (name: string) =>
    name === "get_marketplace_payout_account_raw_for_transfer"
      ? { data: [{ pix_key_type: "CPF", pix_key_normalized: "52998224725" }], error: null }
      : { data: null, error: null }
  );
});

function amountForm(value: string) {
  const f = new FormData();
  f.set("amount_reais", value);
  return f;
}

// Rodada de correções 2026-11-06: o valor digitado vira p_amount_cents (int no
// Postgres). Fração abaixo do centavo e valor acima do int eram arredondados
// ou enviados ao banco; agora param antes da RPC.
describe("createWithdrawal amount validation (before the RPC)", () => {
  it.each(["10.005", "0.001", "21474836.48", "1e400", "-5", "0", "abc", ""])("rejects %s without calling the RPC", async (value) => {
    const { createWithdrawal } = await import("./withdrawal-actions");
    expect(await createWithdrawal({ error: "" }, amountForm(value))).toEqual({ error: "Valor inválido." });
    expect(mocks.sessionRpc).not.toHaveBeenCalled();
    expect(mocks.transfer).not.toHaveBeenCalled();
  });

  it.each([
    ["10.5", 1050],
    ["0.29", 29],
    ["21474836.47", 2147483647],
  ])("sends %s as %s cents", async (value, cents) => {
    mocks.transfer.mockResolvedValue({ ok: true, data: { providerTransferId: "tr_syn" } });
    const { createWithdrawal } = await import("./withdrawal-actions");
    await createWithdrawal({ error: "" }, amountForm(value));
    expect(mocks.sessionRpc).toHaveBeenCalledWith("request_marketplace_withdrawal", expect.objectContaining({ p_amount_cents: cents }));
  });
});

describe("createWithdrawal dispatch", () => {
  it("never logs the provider's free-text error (token-shaped or not)", async () => {
    mocks.transfer.mockResolvedValue({ ok: false, error: "NFSYNTH_PIXKEY_52998224725", status: 400 });
    const { createWithdrawal } = await import("./withdrawal-actions");
    await createWithdrawal({ error: "" }, form());
    expect(mocks.log).toHaveBeenCalledWith("marketplace_withdrawal_dispatch_rejected", {
      withdrawalId: WITHDRAWAL_ID,
      providerStatus: 400,
      errorCode: "PROVIDER_HTTP_400",
    });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("NFSYNTH");
  });

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
      errorCode: "PROVIDER_HTTP_504",
    });
  });

  it("logs a not-sent exit and never posts a transfer when the raw payout key read fails", async () => {
    mocks.adminRpc.mockImplementation(async () => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    const { createWithdrawal } = await import("./withdrawal-actions");

    const result = await createWithdrawal({ error: "" }, form());

    expect(result.ok).toBe(true);
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("marketplace_withdrawal_dispatch_not_sent", {
      withdrawalId: WITHDRAWAL_ID,
      reason: "payout_key_read_failed",
      errorCode: "42501",
    });
  });

  it("logs the failure to mark processing after an accepted transfer, without a second transfer", async () => {
    mocks.transfer.mockResolvedValue({ ok: true, data: { providerTransferId: "tr_1" } });
    mocks.adminRpc.mockImplementation(async (name: string) =>
      name === "mark_marketplace_withdrawal_processing"
        ? { data: null, error: { code: "42702", message: "column reference is ambiguous" } }
        : { data: [{ pix_key_type: "CPF", pix_key_normalized: "52998224725" }], error: null }
    );
    const { createWithdrawal } = await import("./withdrawal-actions");

    const result = await createWithdrawal({ error: "" }, form());

    expect(result.ok).toBe(true);
    expect(mocks.transfer).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith("marketplace_withdrawal_mark_processing_failed", {
      withdrawalId: WITHDRAWAL_ID,
      providerTransferId: "tr_1",
      errorCode: "42702",
    });
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

describe("withdrawal console logs carry only codes", () => {
  it.each(RAW_ERROR_CASES)("createWithdrawal: %s", async (_l, error, code) => {
    mocks.sessionRpc.mockResolvedValue({ data: null, error });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { createWithdrawal } = await import("./withdrawal-actions");
    expect(await createWithdrawal({ error: "" }, form())).toEqual({ error: "Não foi possível solicitar o saque. Tente novamente." });
    expectOnlyCode(spy, "createWithdrawal:", code);
    spy.mockRestore();
  });
  it.each(RAW_ERROR_CASES)("listWithdrawals: %s", async (_l, error, code) => {
    mocks.sessionRpc.mockResolvedValue({ data: null, error });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { listWithdrawals } = await import("./withdrawal-actions");
    expect(await listWithdrawals()).toEqual({ error: "Não foi possível carregar o histórico de saques." });
    expectOnlyCode(spy, "listWithdrawals:", code);
    spy.mockRestore();
  });
});
