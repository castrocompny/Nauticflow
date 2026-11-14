import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const REASON = "Validar reservas no Preview";

const mocks = vi.hoisted(() => ({
  authResult: null as any,
  rpcResult: null as any,
  rpcError: null as any,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("@/lib/admin-auth", () => ({
  requireSuperAdminAction: async () => mocks.authResult,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async (name: string, args: unknown) => {
      mocks.rpcCalls.push({ name, args });
      if (mocks.rpcError) throw mocks.rpcError;
      return mocks.rpcResult;
    }),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const originalFlag = process.env.NAUTICFLOW_STAGING_TRIALS_ENABLED;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NAUTICFLOW_STAGING_TRIALS_ENABLED = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ddlgkrpjzmtgmoucangh.supabase.co";
  mocks.authResult = { ok: true, adminId: ADMIN_ID, adminName: "Staging Support" };
  mocks.rpcResult = { data: { status: "granted" }, error: null };
  mocks.rpcError = null;
  mocks.rpcCalls = [];
});

afterAll(() => {
  if (originalFlag === undefined) delete process.env.NAUTICFLOW_STAGING_TRIALS_ENABLED;
  else process.env.NAUTICFLOW_STAGING_TRIALS_ENABLED = originalFlag;
  if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

describe("grantStagingTrial", () => {
  it("delegates the grant to the atomic database RPC with the authenticated admin and normalized reason", async () => {
    const { grantStagingTrial } = await import("./actions");

    const result = await grantStagingTrial(COMPANY_ID, `  ${REASON}  `);

    expect(result).toEqual({ ok: true, message: "Acesso de teste liberado por 7 dias." });
    expect(mocks.rpcCalls).toEqual([
      {
        name: "grant_staging_trial",
        args: { p_company_id: COMPANY_ID, p_admin_id: ADMIN_ID, p_reason: REASON },
      },
    ]);
  });

  it("requires the existing super_admin authorization before calling the database RPC", async () => {
    mocks.authResult = { ok: false, message: "Acesso restrito." };
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial(COMPANY_ID, REASON)).toEqual({ ok: false, message: "Acesso restrito." });
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("fails closed when the Staging-only flag is off", async () => {
    process.env.NAUTICFLOW_STAGING_TRIALS_ENABLED = "false";
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial(COMPANY_ID, REASON)).toEqual({
      ok: false,
      message: "A liberação de teste está desativada neste ambiente.",
    });
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("fails closed if the flag is on but the configured Supabase project is not Staging", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gggpihphjjxndpfntnvm.supabase.co";
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial(COMPANY_ID, REASON)).toEqual({
      ok: false,
      message: "A liberação de teste está desativada neste ambiente.",
    });
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("rejects an invalid company ID or reason before calling the database RPC", async () => {
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial("not-a-uuid", REASON)).toEqual({ ok: false, message: "Empresa inválida." });
    expect(await grantStagingTrial(COMPANY_ID, "  ")).toEqual({
      ok: false,
      message: "Informe um motivo curto, de 3 a 200 caracteres.",
    });
    expect(mocks.rpcCalls).toEqual([]);
  });

  it.each([
    ["company_not_found", "Empresa não encontrada ou indisponível."],
    ["company_asaas_linked", "A empresa já tem vínculo com o Asaas; não pode receber este acesso de teste."],
    ["subscription_not_found", "Assinatura de teste não encontrada ou indisponível."],
    ["subscription_not_eligible", "Só é possível liberar teste para uma assinatura vencida, ativa e sem vínculo com o Asaas."],
  ])("reports the database refusal status %s without retrying", async (status, message) => {
    mocks.rpcResult = { data: { status }, error: null };
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial(COMPANY_ID, REASON)).toEqual({ ok: false, message });
    expect(mocks.rpcCalls).toHaveLength(1);
  });

  it("does not retry or claim success when the RPC returns an error with uncertain commit status", async () => {
    mocks.rpcResult = { data: null, error: { code: "08006" } };
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial(COMPANY_ID, REASON)).toEqual({
      ok: false,
      message: "Não foi possível confirmar o resultado. Não tente novamente; peça uma conferência administrativa.",
    });
    expect(mocks.rpcCalls).toHaveLength(1);
  });

  it("does not retry when the RPC transport throws", async () => {
    mocks.rpcError = new Error("network interruption");
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial(COMPANY_ID, REASON)).toEqual({
      ok: false,
      message: "Não foi possível confirmar o resultado. Não tente novamente; peça uma conferência administrativa.",
    });
    expect(mocks.rpcCalls).toHaveLength(1);
  });

  it("treats an unknown RPC status as uncertain and does not retry", async () => {
    mocks.rpcResult = { data: { status: "unexpected_status" }, error: null };
    const { grantStagingTrial } = await import("./actions");

    expect(await grantStagingTrial(COMPANY_ID, REASON)).toEqual({
      ok: false,
      message: "Não foi possível confirmar o resultado. Não tente novamente; peça uma conferência administrativa.",
    });
    expect(mocks.rpcCalls).toHaveLength(1);
  });
});

