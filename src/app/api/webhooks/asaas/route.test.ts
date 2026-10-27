import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";

const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";

// Mocks só para o fluxo marketplace de PAYMENT_RECEIVED (RECONSTRUÇÃO, ver
// docs/adr/0007): o Postgres real não roda aqui, então o contrato do retorno da
// RPC é exercitado com respostas simuladas. O limite transacional em si
// (efeito + exceção) é coberto só pelo pgTAP, executado apenas em banco local
// isolado (com supabase/tests/setup/service_role_platform_grants.sql).
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  verify: vi.fn(),
  log: vi.fn(),
  // consulta de linha local: (tabela, coluna, valor) -> { data, error }.
  // Padrão: payments por id existe (fluxo marketplace); o resto não existe.
  lookup: vi.fn(),
}));

function defaultLookup(table: string, column: string) {
  if (table === "payments" && column === "id") return { data: { id: PAYMENT_ID }, error: null };
  return { data: null, error: null };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => ({ maybeSingle: async () => mocks.rpc(...args) }),
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => mocks.lookup(table, column, value),
          limit: async () => {
            const res = mocks.lookup(table, column, value) as { data: unknown; error: unknown };
            return { data: res.data ? [res.data] : [], error: res.error };
          },
        }),
      }),
      insert: (row: unknown) => mocks.insert(table, row),
    }),
  }),
}));
vi.mock("@/lib/asaas", () => ({ verifyAsaasPaymentSettled: mocks.verify }));
vi.mock("@/lib/security-log", () => ({ logSecurityEvent: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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
  mocks.lookup.mockReset();
  mocks.lookup.mockImplementation(defaultLookup);
  mocks.rpc.mockReset();
  mocks.log.mockClear();
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

describe("POST /api/webhooks/asaas (marketplace PAYMENT_RECEIVED)", () => {
  const received = { event: "PAYMENT_RECEIVED", id: "evt_1", payment: { id: "pay_1", externalReference: PAYMENT_ID } };

  function arrange(rpcResult: { data: unknown; error: { message: string } | null }) {
    mocks.verify.mockResolvedValue({ ok: true, valueCents: 15000 });
    mocks.insert.mockReset();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(() => rpcResult);
  }
  const row = (over: Record<string, unknown> = {}) => ({
    data: { event_type: "PAYMENT_RECEIVED", payment_id: PAYMENT_ID, outcome: "exception_recorded", payment_status: "failed", ...over },
    error: null,
  });
  const send = () => POST(webhookRequest(received, "correct-webhook-token"));

  it("records a durable exception for a failed payment and answers 200 only after the RPC confirms it", async () => {
    arrange(row());
    const response = await send();
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("process_marketplace_payment_received_event", {
      p_internal_payment_id: PAYMENT_ID,
      p_provider_payment_id: "pay_1",
      p_confirmed_amount_cents: 15000,
    });
  });

  it("never writes a dedupe mark outside the RPC transaction", async () => {
    arrange(row());
    await send();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("settle_marketplace_payment_received", expect.anything());
  });

  it("answers 5xx (retryable) when the RPC errors", async () => {
    arrange({ data: null, error: { message: "PROVIDER_PAYMENT_ID_MISMATCH" } });
    expect((await send()).status).toBe(500);
  });

  it.each([
    ["no row", { data: null, error: null }],
    ["unknown outcome", row({ outcome: "ignored" })],
    ["another payment", row({ payment_id: "88888888-8888-4888-8888-888888888888" })],
    ["another event", row({ event_type: "PAYMENT_CONFIRMED" })],
    ["exception outcome with a paid payment", row({ payment_status: "paid" })],
    ["settled outcome with a failed payment", row({ outcome: "settled", payment_status: "failed" })],
  ])("answers 5xx when the RPC contract is violated (%s)", async (_name, result) => {
    arrange(result as { data: unknown; error: null });
    expect((await send()).status).toBe(500);
  });

  it.each([
    ["settled", "paid"],
    ["settled_replay", "paid"],
    ["manual_review", "pending"],
    ["exception_existing", "failed"],
  ])("accepts outcome %s with status %s", async (outcome, payment_status) => {
    arrange(row({ outcome, payment_status }));
    expect((await send()).status).toBe(200);
  });
});

// Referência local ausente/divergente (hunks table-only recuperados do WIP
// cde4f8d; os testes de RPC atômica 0085/0086 daquele WIP NÃO foram portados).
describe("POST /api/webhooks/asaas (local reference guards)", () => {
  const WITHDRAWAL_ID = "33333333-3333-4333-8333-333333333333";
  const send = (body: unknown) => POST(webhookRequest(body, "correct-webhook-token"));

  it("ignores a non-uuid transfer externalReference that is not ours (no RPC)", async () => {
    const response = await send({ event: "TRANSFER_DONE", transfer: { id: "tr_1", externalReference: "not-a-withdrawal" } });

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.lookup).toHaveBeenCalledWith("marketplace_withdrawals", "provider_transfer_id", "tr_1");
  });

  it("responds 422 when a local withdrawal's event has no transfer id", async () => {
    mocks.lookup.mockImplementation((table: string, column: string) =>
      table === "marketplace_withdrawals" && column === "id" ? { data: { id: WITHDRAWAL_ID }, error: null } : { data: null, error: null });

    const response = await send({ id: "evt_x", event: "TRANSFER_DONE", transfer: { externalReference: WITHDRAWAL_ID } });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_DONE", kind: "transfer", reason: "missing_transfer_id",
    });
  });

  it("responds 422 when the transfer id belongs to a local withdrawal but externalReference does not", async () => {
    mocks.lookup.mockImplementation((table: string, column: string, value: unknown) =>
      table === "marketplace_withdrawals" && column === "provider_transfer_id" && value === "tr_1"
        ? { data: { id: WITHDRAWAL_ID }, error: null } : { data: null, error: null });

    const response = await send({ event: "TRANSFER_DONE", transfer: { id: "tr_1" } });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_DONE", kind: "transfer", reason: "reference_mismatch",
    });
  });

  it("rejects a valid local withdrawal reference when the provider transfer id belongs to another withdrawal", async () => {
    const otherWithdrawalId = "44444444-4444-4444-8444-444444444444";
    mocks.lookup.mockImplementation((table: string, column: string, value: unknown) =>
      table === "marketplace_withdrawals" && column === "provider_transfer_id" && value === "tr_conflict"
        ? { data: { id: otherWithdrawalId }, error: null } : { data: null, error: null });
    mocks.insert.mockResolvedValue({ error: null });

    const response = await send({
      id: "evt_transfer_conflict",
      event: "TRANSFER_DONE",
      transfer: { id: "tr_conflict", externalReference: WITHDRAWAL_ID, value: 150 },
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_DONE", kind: "transfer", reason: "reference_mismatch",
    });
  });

  it("returns 5xx before transfer finalization when provider-id association lookup fails", async () => {
    mocks.lookup.mockImplementation((table: string, column: string) =>
      table === "marketplace_withdrawals" && column === "provider_transfer_id"
        ? { data: null, error: { message: "lookup unavailable" } } : { data: null, error: null });

    const response = await send({
      event: "TRANSFER_DONE",
      transfer: { id: "tr_lookup_error", externalReference: WITHDRAWAL_ID, value: 150 },
    });

    expect(response.status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("responds 200 for a transfer without local reference nor local transfer id (not ours)", async () => {
    const response = await send({ event: "TRANSFER_DONE", transfer: { id: "tr_someone_else" } });

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("responds 5xx when the local-reference lookup fails (cannot tell if the event is ours)", async () => {
    mocks.lookup.mockReturnValue({ data: null, error: { message: "boom" } });

    const response = await send({ event: "TRANSFER_DONE", transfer: { id: "tr_x" } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "reference_lookup_failed" });
  });

  it("responds 422 when a local payment's event has no payment id", async () => {
    const response = await send({ id: "evt_r", event: "PAYMENT_REFUNDED", payment: { externalReference: PAYMENT_ID, value: 150 } });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "PAYMENT_REFUNDED", kind: "payment", reason: "missing_payment_id",
    });
  });

  it.each([
    ["PAYMENT_DELETED", "not-a-uuid"],
    ["PAYMENT_REFUNDED", undefined],
    ["PAYMENT_CONFIRMED", "22222222-2222-4222-8222-222222222222"],
  ])("responds 422 when %s carries a charge of a local payment but externalReference does not match (%s)", async (event, externalReference) => {
    mocks.lookup.mockImplementation((table: string, column: string, value: unknown) =>
      table === "payments" && column === "provider_payment_id" && value === "pay_provider_1"
        ? { data: { id: PAYMENT_ID }, error: null } : { data: null, error: null });

    const response = await send({ id: "evt_m", event, payment: { id: "pay_provider_1", externalReference, value: 150 } });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event, kind: "payment", reason: "reference_mismatch",
    });
  });

  it("rejects a valid local externalReference when the provider charge belongs to another local payment", async () => {
    const otherPaymentId = "88888888-8888-4888-8888-888888888888";
    mocks.verify.mockReset();
    mocks.verify.mockResolvedValue({ ok: true, valueCents: 15000 });
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: { event_type: "PAYMENT_RECEIVED", payment_id: PAYMENT_ID, outcome: "settled", payment_status: "paid" },
      error: null,
    });
    mocks.lookup.mockImplementation((table: string, column: string, value: unknown) => {
      if (table === "payments" && column === "id" && value === PAYMENT_ID) return { data: { id: PAYMENT_ID }, error: null };
      if (table === "payments" && column === "provider_payment_id" && value === "pay_owned_by_other") {
        return { data: { id: otherPaymentId }, error: null };
      }
      return { data: null, error: null };
    });

    const response = await send({
      id: "evt_conflict",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_owned_by_other", externalReference: PAYMENT_ID, value: 150 },
    });

    expect(response.status).toBe(422);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "PAYMENT_RECEIVED", kind: "payment", reason: "reference_mismatch",
    });
  });

  it("returns 5xx before settlement when provider-id lookup fails for a valid local reference", async () => {
    mocks.verify.mockReset();
    mocks.rpc.mockReset();
    mocks.lookup.mockImplementation((table: string, column: string, value: unknown) => {
      if (table === "payments" && column === "id" && value === PAYMENT_ID) return { data: { id: PAYMENT_ID }, error: null };
      if (table === "payments" && column === "provider_payment_id") return { data: null, error: { message: "lookup unavailable" } };
      return { data: null, error: null };
    });

    const response = await send({
      id: "evt_lookup_error",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_lookup_error", externalReference: PAYMENT_ID, value: 150 },
    });

    expect(response.status).toBe(500);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("responds 5xx when the charge-id lookup fails", async () => {
    mocks.lookup.mockReturnValue({ data: null, error: { message: "boom" } });

    const response = await send({ id: "evt_o", event: "PAYMENT_REFUNDED", payment: { id: "pay_other", value: 10 } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "payment_lookup_failed" });
  });

  it("responds 200 for a refund event of a charge that is not ours", async () => {
    mocks.lookup.mockImplementation(() => ({ data: null, error: null }));

    const response = await send({ id: "evt_o", event: "PAYMENT_REFUNDED", payment: { id: "pay_other", value: 10 } });

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

// TRANSFER_* (migration 0089): marca de dedupe + efeito numa única RPC/transação
// (mesmo padrão da 0079) -- a rota não grava marca própria e só responde 200
// quando a RPC confirma. Rollback da marca, lock e identidade atômica ficam no
// pgTAP (marketplace_withdrawal_webhook.test.sql), não exercitados aqui.
describe("POST /api/webhooks/asaas (TRANSFER_* effect)", () => {
  const WITHDRAWAL_ID = "55555555-5555-4555-8555-555555555555";
  const send = (event: string, id = "evt_t1") =>
    POST(webhookRequest({ id, event, transfer: { id: "tr_ok", externalReference: WITHDRAWAL_ID, fee: 0 } }, "correct-webhook-token"));
  const row = (outcome: string, withdrawal_status: string) => ({ data: { outcome, withdrawal_status }, error: null });

  beforeEach(() => {
    mocks.insert.mockReset();
    mocks.insert.mockResolvedValue({ error: null });
  });

  it("answers 200 for TRANSFER_DONE only after the atomic RPC confirms, without a route-level dedupe mark", async () => {
    mocks.rpc.mockReturnValue(row("applied", "completed"));

    const response = await send("TRANSFER_DONE");

    expect(response.status).toBe(200);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("process_marketplace_transfer_webhook_event", {
      p_event_key: "evt_t1",
      p_event_type: "TRANSFER_DONE",
      p_withdrawal_id: WITHDRAWAL_ID,
      p_provider_transfer_id: "tr_ok",
      p_provider_fee_cents: 0,
    });
  });

  it("answers 5xx when the RPC errors, and a replay of the same event reaches the RPC again", async () => {
    mocks.rpc.mockReturnValueOnce({ data: null, error: { message: "column reference \"id\" is ambiguous" } });
    expect((await send("TRANSFER_DONE")).status).toBe(500);

    mocks.rpc.mockReturnValueOnce(row("applied", "completed"));
    expect((await send("TRANSFER_DONE")).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  // 0089 decide pelo estado travado do saque, não pela marca: `already_applied`
  // = o estado já reflete este evento (marca legada não prova nada sozinha).
  it("answers 200 duplicate when the RPC reports the state already reflects the event", async () => {
    mocks.rpc.mockReturnValue(row("already_applied", "processing"));

    const response = await send("TRANSFER_CREATED");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
  });

  it.each([
    ["TERMINAL_OUTCOME_CONFLICT", "terminal_outcome_conflict"],
    ["EVENT_KEY_CONFLICT", "event_key_conflict"],
    ["TRANSFER_IDENTITY_UNPROVEN", "transfer_identity_unproven"],
  ])("answers 422 (never 200) when the RPC raises %s", async (code, reason) => {
    mocks.rpc.mockReturnValue({ data: null, error: { message: code } });

    expect((await send("TRANSFER_FAILED")).status).toBe(422);
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_FAILED", kind: "transfer", reason,
    });
  });

  it("routes in-progress events through the same atomic RPC and answers 5xx on error", async () => {
    mocks.rpc.mockReturnValue({ data: null, error: { message: "boom" } });

    expect((await send("TRANSFER_PENDING")).status).toBe(500);
    expect(mocks.rpc).toHaveBeenCalledWith("process_marketplace_transfer_webhook_event", expect.objectContaining({
      p_event_type: "TRANSFER_PENDING", p_withdrawal_id: WITHDRAWAL_ID, p_provider_transfer_id: "tr_ok",
    }));
  });

  it.each([
    ["no row", { data: null, error: null }],
    ["unknown outcome", row("ignored", "completed")],
    ["missing status", { data: { outcome: "applied" }, error: null }],
    ["marker-only duplicate outcome", row("duplicate", "completed")],
  ])("answers 5xx when the RPC contract is violated (%s)", async (_name, result) => {
    mocks.rpc.mockReturnValue(result);
    expect((await send("TRANSFER_DONE")).status).toBe(500);
  });

  // Combinações derivadas da 0089: terminal só devolve o próprio desfecho;
  // intermediário devolve `applied`+processing (vindo de pending) ou
  // `already_applied` com qualquer estado já além de pending (inclusive terminal).
  it.each([
    ["TRANSFER_DONE", "applied", "completed"],
    ["TRANSFER_DONE", "already_applied", "completed"],
    ["TRANSFER_FAILED", "applied", "failed"],
    ["TRANSFER_CANCELLED", "already_applied", "cancelled"],
    ["TRANSFER_CREATED", "applied", "processing"],
    ["TRANSFER_PENDING", "already_applied", "processing"],
    ["TRANSFER_BLOCKED", "already_applied", "completed"],
    ["TRANSFER_IN_BANK_PROCESSING", "already_applied", "failed"],
  ])("answers 200 for %s with coherent RPC result (%s, %s)", async (event, outcome, status) => {
    mocks.rpc.mockReturnValue(row(outcome, status));
    expect((await send(event)).status).toBe(200);
  });

  it.each([
    ["TRANSFER_DONE", "applied", "failed"],
    ["TRANSFER_DONE", "already_applied", "processing"],
    ["TRANSFER_FAILED", "applied", "completed"],
    ["TRANSFER_CANCELLED", "applied", "pending"],
    ["TRANSFER_CREATED", "applied", "completed"],
    ["TRANSFER_PENDING", "applied", "pending"],
    ["TRANSFER_PENDING", "already_applied", "pending"],
    ["TRANSFER_BLOCKED", "already_applied", "weird"],
  ])("answers 5xx for %s with incoherent RPC result (%s, %s)", async (event, outcome, status) => {
    mocks.rpc.mockReturnValue(row(outcome, status));
    expect((await send(event)).status).toBe(500);
  });

  it("answers 422 when the RPC detects a different transfer id bound to the withdrawal", async () => {
    mocks.rpc.mockReturnValue({ data: null, error: { message: "PROVIDER_TRANSFER_ID_MISMATCH" } });

    const response = await send("TRANSFER_DONE");

    expect(response.status).toBe(422);
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_DONE", kind: "transfer", reason: "reference_mismatch",
    });
  });

  // Saque com uuid válido que não existe localmente: não há prova de que o
  // evento seja alheio -- nunca 200 silencioso.
  it("answers 422 (not a silent 200) when the referenced withdrawal does not exist", async () => {
    mocks.rpc.mockReturnValue({ data: null, error: { message: "WITHDRAWAL_NOT_FOUND" } });

    expect((await send("TRANSFER_DONE")).status).toBe(422);
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_DONE", kind: "transfer", reason: "withdrawal_not_found",
    });
  });
});
