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
  // captura da 0090 (record_marketplace_transfer_conflict): (args, signal) ->
  // resposta no formato do cliente ({ data, error, status }).
  capture: vi.fn(),
  // signal recebido por chamada de RPC, na ordem: [nome, signal | undefined].
  signals: [] as [string, AbortSignal | undefined][],
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
    rpc: (name: string, params: unknown) => {
      let signal: AbortSignal | undefined;
      const builder = {
        abortSignal: (s: AbortSignal) => { signal = s; return builder; },
        maybeSingle: async () => {
          mocks.signals.push([name, signal]);
          return name === "record_marketplace_transfer_conflict" ? mocks.capture(params, signal) : mocks.rpc(name, params);
        },
      };
      return builder;
    },
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
  mocks.capture.mockReset();
  mocks.capture.mockImplementation(() => capturedRow());
  mocks.signals.length = 0;
  mocks.log.mockClear();
});

const CONFLICT_ID = "99999999-9999-4999-8999-999999999999";
function capturedRow(outcome = "recorded", occurrence_count = 1) {
  return { data: { outcome, conflict_id: CONFLICT_ID, occurrence_count }, error: null, status: 200 };
}

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

// Captura durável de conflitos TRANSFER_* (0090) como SEGUNDA RPC, depois da
// decisão de 422 -- nunca altera o HTTP. RPCs simuladas: provam a lógica da
// rota, não gravação no banco nem comportamento real do PostgREST.
describe("POST /api/webhooks/asaas (TRANSFER_* conflict capture, 0090)", () => {
  const WITHDRAWAL_ID = "66666666-6666-4666-8666-666666666666";
  const OTHER_ID = "44444444-4444-4444-8444-444444444444";
  const send = (body: unknown) => POST(webhookRequest(body, "correct-webhook-token"));
  const body = (transfer: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) => ({
    id: "evt_c1", event: "TRANSFER_FAILED", ...envelope,
    transfer: { id: "tr_c1", externalReference: WITHDRAWAL_ID, fee: 1.5, ...transfer },
  });
  const pgError = (message: string, code: unknown = "P0001", status = 400) =>
    ({ data: null, error: { message, code, details: "detail-secret", hint: "hint-secret" }, status });
  const rpcNames = () => mocks.signals.map(([name]) => name);
  const captureArgs = () => mocks.capture.mock.calls.map(([args]) => args);
  const localById = (table: string, column: string) =>
    table === "marketplace_withdrawals" && column === "id" ? { data: { id: WITHDRAWAL_ID }, error: null } : { data: null, error: null };
  const localByTransfer = (owner: string) => (table: string, column: string, value: unknown) =>
    table === "marketplace_withdrawals" && column === "provider_transfer_id" && value === "tr_c1"
      ? { data: { id: owner }, error: null } : { data: null, error: null };

  describe("eligibility", () => {
    it("captures a missing transfer id pre-check without calling the financial RPC", async () => {
      mocks.lookup.mockImplementation(localById);

      const response = await send(body({ id: undefined }));

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
      expect(rpcNames()).toEqual(["record_marketplace_transfer_conflict"]);
      expect(captureArgs()).toEqual([{
        p_reason: "missing_transfer_id", p_event_type: "TRANSFER_FAILED", p_event_key: null,
        p_notification_id: "evt_c1", p_provider_transfer_id: null,
        p_reference_class: "uuid", p_referenced_withdrawal_id: WITHDRAWAL_ID, p_fee_class: "valid", p_fee_cents: 150,
      }]);
    });

    it("captures a reference mismatch pre-check (no reference, transfer id is local)", async () => {
      mocks.lookup.mockImplementation(localByTransfer(WITHDRAWAL_ID));

      const response = await send(body({ externalReference: undefined }));

      expect(response.status).toBe(422);
      expect(rpcNames()).toEqual(["record_marketplace_transfer_conflict"]);
      expect(captureArgs()).toEqual([expect.objectContaining({
        p_reason: "reference_mismatch", p_event_key: null, p_provider_transfer_id: "tr_c1",
        p_reference_class: "absent", p_referenced_withdrawal_id: null,
      })]);
    });

    it("captures a reference mismatch pre-check (transfer id bound to another withdrawal)", async () => {
      mocks.lookup.mockImplementation(localByTransfer(OTHER_ID));

      const response = await send(body());

      expect(response.status).toBe(422);
      expect(rpcNames()).toEqual(["record_marketplace_transfer_conflict"]);
      expect(captureArgs()).toEqual([expect.objectContaining({
        p_reason: "reference_mismatch", p_event_key: null, p_reference_class: "uuid", p_referenced_withdrawal_id: WITHDRAWAL_ID,
      })]);
    });

    it.each([
      ["PROVIDER_TRANSFER_ID_MISMATCH", "provider_transfer_id_mismatch", "reference_mismatch"],
      ["TERMINAL_OUTCOME_CONFLICT", "terminal_outcome_conflict", "terminal_outcome_conflict"],
      ["EVENT_KEY_CONFLICT", "event_key_conflict", "event_key_conflict"],
      ["TRANSFER_IDENTITY_UNPROVEN", "transfer_identity_unproven", "transfer_identity_unproven"],
      ["WITHDRAWAL_NOT_FOUND", "withdrawal_not_found", "withdrawal_not_found"],
    ])("captures structured %s after the financial RPC, with the same event key", async (code, captureReason, httpReason) => {
      mocks.rpc.mockReturnValue(pgError(code));

      const response = await send(body());

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
      expect(rpcNames()).toEqual(["process_marketplace_transfer_webhook_event", "record_marketplace_transfer_conflict"]);
      const financial = mocks.rpc.mock.calls[0][1] as { p_event_key: string };
      expect(financial.p_event_key).toBe("evt_c1");
      expect(captureArgs()).toEqual([{
        p_reason: captureReason, p_event_type: "TRANSFER_FAILED", p_event_key: financial.p_event_key,
        p_notification_id: "evt_c1", p_provider_transfer_id: "tr_c1",
        p_reference_class: "uuid", p_referenced_withdrawal_id: WITHDRAWAL_ID, p_fee_class: "valid", p_fee_cents: 150,
      }]);
      // log HTTP atual preservado
      expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
        event: "TRANSFER_FAILED", kind: "transfer", reason: httpReason,
      });
    });

    it.each([
      ["message only, no code", { message: "TERMINAL_OUTCOME_CONFLICT" }, 400, "NONE"],
      ["transport text containing the code", { message: "FetchError: TERMINAL_OUTCOME_CONFLICT", code: "" }, 0, "NONE"],
      ["another SQLSTATE", { message: "TERMINAL_OUTCOME_CONFLICT", code: "XX000" }, 500, "XX000"],
      ["P0001 with a longer message", { message: "TERMINAL_OUTCOME_CONFLICT: extra", code: "P0001" }, 400, "P0001"],
      ["unsafe code", { message: "TERMINAL_OUTCOME_CONFLICT", code: "<b>x</b>" }, 400, "UNRECOGNIZED"],
    ])("keeps the 422 but never captures an unproven conflict (%s)", async (_name, error, status, errorCode) => {
      mocks.rpc.mockReturnValue({ data: null, error, status });

      const response = await send(body());

      expect(response.status).toBe(422);
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.log).toHaveBeenCalledWith("transfer_conflict_unverified", {
        event: "TRANSFER_FAILED", reason: "terminal_outcome_conflict", errorCode,
      });
      expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
        event: "TRANSFER_FAILED", kind: "transfer", reason: "terminal_outcome_conflict",
      });
    });

    it.each([
      ["transport error", { data: null, error: { message: "FetchError: fetch failed", code: "" }, status: 0 }, 500],
      ["generic database error", pgError("boom", "XX000", 500), 500],
      ["coherent success", { data: { outcome: "applied", withdrawal_status: "failed" }, error: null, status: 200 }, 200],
      ["incoherent success", { data: { outcome: "applied", withdrawal_status: "completed" }, error: null, status: 200 }, 500],
    ])("never captures a non-eligible financial result (%s)", async (_name, result, status) => {
      mocks.rpc.mockReturnValue(result);

      expect((await send(body())).status).toBe(status);
      expect(mocks.capture).not.toHaveBeenCalled();
    });

    it("never captures when the local lookup fails (500)", async () => {
      mocks.lookup.mockReturnValue({ data: null, error: { message: "boom" } });

      expect((await send(body({ id: undefined }))).status).toBe(500);
      expect(mocks.capture).not.toHaveBeenCalled();
    });
  });

  describe("arguments", () => {
    const structured = async (transfer: Record<string, unknown>, envelope: Record<string, unknown> = {}) => {
      mocks.rpc.mockReturnValue(pgError("TERMINAL_OUTCOME_CONFLICT"));
      const response = await send(body(transfer, envelope));
      expect(response.status).toBe(422);
      return captureArgs()[0] as Record<string, unknown> | undefined;
    };

    it.each([
      ["absent", undefined, "absent", null],
      ["null", null, "absent", null],
      ["uuid", WITHDRAWAL_ID, "uuid", WITHDRAWAL_ID],
      ["empty string", "", "invalid", null],
      ["non-uuid string", "not-a-withdrawal", "invalid", null],
      ["number", 123, "invalid", null],
      ["object", { id: WITHDRAWAL_ID }, "invalid", null],
    ])("classifies the reference without raw content (%s)", async (_name, externalReference, cls, id) => {
      // pré-checagem pelo transfer id (ligado a outro saque): cobre referência uuid e não-uuid
      mocks.lookup.mockImplementation(localByTransfer(OTHER_ID));

      expect((await send(body({ externalReference }))).status).toBe(422);
      const args = captureArgs()[0] as Record<string, unknown>;
      expect(args.p_reference_class).toBe(cls);
      expect(args.p_referenced_withdrawal_id).toBe(id);
    });

    it.each([
      ["absent", undefined, "absent", null],
      ["null", null, "absent", null],
      ["zero", 0, "valid", 0],
      ["decimal", 2.35, "valid", 235],
      ["small negative that rounds to zero", -0.001, "invalid", null],
      ["negative", -1, "invalid", null],
      ["string", "1.50", "invalid", null],
      ["boolean", true, "invalid", null],
      ["above int range", 21474836.48, "invalid", null],
      ["max int", 21474836.47, "valid", 2147483647],
    ])("classifies the fee (%s)", async (_name, fee, cls, cents) => {
      const args = await structured({ fee });
      expect(args?.p_fee_class).toBe(cls);
      expect(args?.p_fee_cents).toBe(cents);
    });

    it("keeps the financial fee argument unchanged", async () => {
      await structured({ fee: -0.001 });
      expect((mocks.rpc.mock.calls[0][1] as { p_provider_fee_cents: unknown }).p_provider_fee_cents).toBe(-0);
    });

    it.each([
      ["empty", ""],
      ["with spaces", "evt bad/1"],
      ["excessive", "a".repeat(257)],
    ])("passes the received notification id exactly (%s)", async (_name, id) => {
      // pré-checagem: body.id "" não vira chave e chega cru à captura
      mocks.lookup.mockImplementation(localById);
      await send(body({ id: undefined }, { id }));
      expect((captureArgs()[0] as Record<string, unknown>).p_notification_id).toBe(id);
    });

    it("passes an empty transfer id exactly (pre-check: treated as missing)", async () => {
      mocks.lookup.mockImplementation(localById);
      await send(body({ id: "" }));
      expect((captureArgs()[0] as Record<string, unknown>).p_provider_transfer_id).toBe("");
    });

    it.each([
      ["with spaces", "tr cc bad"],
      ["excessive", "t".repeat(257)],
    ])("passes the received transfer id exactly (%s)", async (_name, id) => {
      const args = await structured({ id });
      expect(args?.p_provider_transfer_id).toBe(id);
    });

    it("passes null for an absent notification id and the fallback key only as the event key", async () => {
      const args = await structured({}, { id: undefined });
      expect(args?.p_notification_id).toBeNull();
      expect(args?.p_event_key).toBe("TRANSFER_FAILED:tr_c1");
    });

    it.each([
      ["notification id number", {}, { id: 123 }, "notification_id", "number"],
      ["notification id object", {}, { id: { x: 1 } }, "notification_id", "object"],
      ["transfer id number", { id: 42 }, {}, "transfer_id", "number"],
      ["transfer id array", { id: ["tr"] }, {}, "transfer_id", "array"],
    ])("does not capture an identifier of the wrong type (%s), keeping the 422", async (_name, transfer, envelope, field, type) => {
      mocks.lookup.mockImplementation(localById);

      const response = await send(body({ ...transfer, ...("id" in transfer ? {} : { id: undefined }) }, envelope));

      expect(response.status).toBe(422);
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.log).toHaveBeenCalledWith("transfer_conflict_identifier_type", {
        event: "TRANSFER_FAILED", reason: "missing_transfer_id", field, type,
      });
    });
  });

  describe("capture result (never changes the 422)", () => {
    const run = async (captureResult: unknown) => {
      mocks.rpc.mockReturnValue(pgError("TERMINAL_OUTCOME_CONFLICT"));
      mocks.capture.mockImplementation(() => captureResult);
      const response = await send(body());
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
      expect(mocks.rpc).toHaveBeenCalledTimes(1); // financeira nunca repetida
      expect(mocks.capture).toHaveBeenCalledTimes(1); // captura nunca repetida
    };
    const expectOnlyCaptureLog = (name: string, extra: Record<string, unknown>) => {
      const captureLogs = mocks.log.mock.calls.filter(([n]) => String(n).startsWith("transfer_conflict_"));
      expect(captureLogs).toEqual([[name, { event: "TRANSFER_FAILED", reason: "terminal_outcome_conflict", ...extra }]]);
    };

    it.each([
      ["recorded", 1],
      ["repeated", 2],
      ["repeated", 7],
    ])("logs a confirmed capture (%s, %d)", async (outcome, count) => {
      await run(capturedRow(outcome as string, count as number));
      expectOnlyCaptureLog("transfer_conflict_captured", { outcome, conflictId: CONFLICT_ID, occurrenceCount: count });
    });

    it.each([
      "CONFLICT_CAPTURE_INVALID_INPUT",
      "CONFLICT_CAPTURE_POLICY_MISSING",
      "CONFLICT_CAPTURE_CAPACITY_EXCEEDED",
    ])("logs a domain rejection of the capture (%s)", async (code) => {
      await run(pgError(code));
      expectOnlyCaptureLog("transfer_conflict_capture_rejected", { errorCode: code });
    });

    it.each([
      ["transport", { data: null, error: { message: "FetchError: fetch failed", code: "" }, status: 0 }],
      ["missing status", { data: null, error: { message: "FetchError: x", code: "" } }],
    ])("logs an unknown capture result (%s)", async (_name, result) => {
      await run(result);
      expectOnlyCaptureLog("transfer_conflict_capture_unknown", { cause: "transport" });
    });

    it.each([
      ["function missing", pgError("Could not find the function", "PGRST202", 404), "PGRST202", 404],
      ["permission", pgError("permission denied", "42501", 403), "42501", 403],
      ["P0001 not in contract", pgError("CONFLICT_CAPTURE_SOMETHING", "P0001"), "P0001", 400],
      ["rejection code without P0001", pgError("CONFLICT_CAPTURE_POLICY_MISSING", "XX000", 500), "XX000", 500],
      ["unsafe code", pgError("x", "<script>", 500), "UNRECOGNIZED", 500],
      ["non-JSON body", { data: null, error: { message: "<html>CONFLICT_CAPTURE_POLICY_MISSING</html>" }, status: 502 }, "NONE", 502],
    ])("logs a capture error outside the contract (%s) without raw message, details or hint", async (_name, result, errorCode, status) => {
      await run(result);
      expectOnlyCaptureLog("transfer_conflict_capture_failed", { errorCode, status });
      expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/detail-secret|hint-secret|<html>|permission denied/);
    });

    it.each([
      ["no row", { data: null, error: null, status: 200 }],
      ["array", { data: [capturedRow().data], error: null, status: 200 }],
      ["recorded with 2", capturedRow("recorded", 2)],
      ["repeated with 1", capturedRow("repeated", 1)],
      ["unknown outcome", capturedRow("ignored", 1)],
      ["count as string", { data: { outcome: "recorded", conflict_id: CONFLICT_ID, occurrence_count: "1" }, error: null, status: 200 }],
      ["fractional count", capturedRow("repeated", 2.5)],
      ["bad conflict id", { data: { outcome: "recorded", conflict_id: "not-a-uuid", occurrence_count: 1 }, error: null, status: 200 }],
      ["missing conflict id", { data: { outcome: "recorded", occurrence_count: 1 }, error: null, status: 200 }],
    ])("logs an invalid capture result and never treats it as confirmed (%s)", async (_name, result) => {
      await run(result);
      expectOnlyCaptureLog("transfer_conflict_capture_invalid_result", {});
    });

    it("treats an unexpected rejection of the capture call as unknown, keeping the 422", async () => {
      await run(Promise.reject(new Error("socket hang up")));
      expectOnlyCaptureLog("transfer_conflict_capture_unknown", { cause: "exception" });
    });

    it("bounds only the capture call with an abort signal and classifies the timeout as unknown", async () => {
      vi.useFakeTimers();
      try {
        mocks.rpc.mockReturnValue(pgError("TERMINAL_OUTCOME_CONFLICT"));
        mocks.capture.mockImplementation((_args: unknown, signal: AbortSignal) =>
          new Promise((resolve) => signal.addEventListener("abort", () =>
            resolve({ data: null, error: { message: "AbortError: aborted", code: "" }, status: 0 }))));

        let settled = false;
        const pending = send(body()).finally(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(2999);
        expect(mocks.signals.find(([n]) => n === "record_marketplace_transfer_conflict")?.[1]?.aborted).toBe(false);
        expect(settled).toBe(false); // antes do prazo a resposta continua pendente
        await vi.advanceTimersByTimeAsync(1);
        const response = await pending;

        expect(settled).toBe(true);
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.capture).toHaveBeenCalledTimes(1);
        const signals = Object.fromEntries(mocks.signals);
        expect(signals.process_marketplace_transfer_webhook_event).toBeUndefined();
        expect(signals.record_marketplace_transfer_conflict?.aborted).toBe(true);
        expectOnlyCaptureLog("transfer_conflict_capture_unknown", { cause: "timeout" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the POST pending until the capture settles, then answers the same 422", async () => {
      mocks.rpc.mockReturnValue(pgError("TERMINAL_OUTCOME_CONFLICT"));
      let release: ((value: unknown) => void) | undefined;
      const started = new Promise<void>((markStarted) => {
        mocks.capture.mockImplementation(() => {
          markStarted();
          return new Promise((resolve) => { release = resolve; });
        });
      });

      let settled = false;
      const pending = send(body()).finally(() => { settled = true; });
      try {
        // a captura precisa ter começado; se o POST terminar antes, falha em vez de travar
        await Promise.race([
          started,
          pending.then(() => { throw new Error("POST finished before the capture started"); }),
        ]);
        // checkpoint do event loop: esvazia microtasks e uma volta de macrotask
        await new Promise((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
      } finally {
        release?.(capturedRow());
      }

      const response = await pending;
      expect(settled).toBe(true);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
      expectOnlyCaptureLog("transfer_conflict_captured", { outcome: "recorded", conflictId: CONFLICT_ID, occurrenceCount: 1 });
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.capture).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["positive", "1e400", Infinity],
      ["negative", "-1e400", -Infinity],
    ])("classifies a non-finite fee (%s) as invalid without raw content in logs", async (_name, literal, parsed) => {
      // JSON literal válido: JSON.stringify(Infinity) daria null e não exercitaria o caminho.
      const raw = `{"id":"evt_c1","event":"TRANSFER_FAILED","transfer":{"id":"tr_c1","externalReference":"${WITHDRAWAL_ID}","fee":${literal}}}`;
      expect(JSON.parse(raw).transfer.fee).toBe(parsed);
      mocks.rpc.mockReturnValue(pgError("TERMINAL_OUTCOME_CONFLICT"));

      const response = await POST(new Request("https://nauticflow.com.br/api/webhooks/asaas", {
        method: "POST",
        headers: { "content-type": "application/json", "asaas-access-token": "correct-webhook-token" },
        body: raw,
      }));

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
      // a rota recebeu o número não finito (não null): a conversão financeira existente o propaga
      expect((mocks.rpc.mock.calls[0][1] as { p_provider_fee_cents: unknown }).p_provider_fee_cents).toBe(parsed);
      const args = captureArgs()[0] as Record<string, unknown>;
      expect(args.p_fee_class).toBe("invalid");
      expect(args.p_fee_cents).toBeNull();
      const logged = mocks.log.mock.calls.flatMap(([, extra]) => Object.values((extra ?? {}) as Record<string, unknown>));
      expect(logged.some((v) => typeof v === "number" && !Number.isFinite(v))).toBe(false);
      expect(logged.some((v) => typeof v === "string" && /e400|Infinity/i.test(v))).toBe(false);
    });

    it("never calls the capture RPC from payment or SaaS flows", async () => {
      mocks.verify.mockResolvedValue({ ok: true, valueCents: 15000 });
      mocks.rpc.mockReturnValue({ data: null, error: { message: "TERMINAL_OUTCOME_CONFLICT", code: "P0001" }, status: 400 });
      await send({ id: "evt_p", event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: PAYMENT_ID } });
      mocks.lookup.mockImplementation(() => ({ data: null, error: null }));
      await send({ id: "evt_s", event: "PAYMENT_CONFIRMED", payment: { id: "pay_2", externalReference: "88888888-8888-4888-8888-888888888888" } });

      expect(mocks.capture).not.toHaveBeenCalled();
      expect(rpcNames()).not.toContain("record_marketplace_transfer_conflict");
    });
  });
});

// Rodada de correções 2026-11-06 -- sentinelas SINTÉTICAS.
describe("POST /api/webhooks/asaas (safe error codes and refund amounts)", () => {
  const SENTINEL = "nfsynth.cliente@example.invalid";
  const rawRequest = (raw: string) =>
    new Request("https://nauticflow.com.br/api/webhooks/asaas", {
      method: "POST",
      headers: { "content-type": "application/json", "asaas-access-token": "correct-webhook-token" },
      body: raw,
    });

  it("logs only a code when the payment lookup fails with free text", async () => {
    mocks.lookup.mockImplementation(() => ({ data: null, error: { code: "PGRST000", message: `connection to ${SENTINEL} refused` } }));
    const response = await POST(webhookRequest({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: PAYMENT_ID } }, "correct-webhook-token"));
    expect(response.status).toBe(500);
    expect(mocks.log).toHaveBeenCalledWith("asaas_webhook_payment_lookup_failed", { event: "PAYMENT_RECEIVED", paymentId: "pay_1", errorCode: "PGRST000" });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("nfsynth");
  });

  it("logs only a code when the settlement RPC fails with free text", async () => {
    mocks.verify.mockResolvedValue({ ok: true, valueCents: 15000 });
    mocks.rpc.mockImplementation(() => ({ data: null, error: { code: "XX000", message: `unexpected ${SENTINEL}` } }));
    const response = await POST(webhookRequest({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: PAYMENT_ID } }, "correct-webhook-token"));
    expect(response.status).toBe(500);
    expect(mocks.log).toHaveBeenCalledWith("marketplace_payment_settlement_error", { paymentId: PAYMENT_ID, errorCode: "XX000" });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("nfsynth");
  });

  // corpo cru: 1e400 vira Infinity no JSON.parse real da rota (request.json())
  it.each([
    ["1e400 (Infinity after the real JSON.parse)", "1e400"],
    ["negative", "-10.5"],
    ["sub-cent fraction", "10.005"],
    ["above the Postgres int", "21474836.48"],
  ])("sends p_reported_amount_cents=null for an invalid refund value: %s", async (_label, rawValue) => {
    mocks.insert.mockResolvedValue({ error: null });
    mocks.rpc.mockImplementation(() => ({ data: { action: "applied" }, error: null }));
    const raw = `{"event":"PAYMENT_REFUNDED","id":"evt_r1","payment":{"id":"pay_1","externalReference":"${PAYMENT_ID}","refunds":[{"id":"ref_1","value":${rawValue}}]}}`;
    const response = await POST(rawRequest(raw));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("reconcile_marketplace_refund_webhook_event", expect.objectContaining({ p_reported_amount_cents: null }));
  });

  it("keeps a valid refund value in cents", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    mocks.rpc.mockImplementation(() => ({ data: { action: "applied" }, error: null }));
    const raw = `{"event":"PAYMENT_REFUNDED","id":"evt_r2","payment":{"id":"pay_1","externalReference":"${PAYMENT_ID}","refunds":[{"id":"ref_1","value":199.9}]}}`;
    await POST(rawRequest(raw));
    expect(mocks.rpc).toHaveBeenCalledWith("reconcile_marketplace_refund_webhook_event", expect.objectContaining({ p_reported_amount_cents: 19990 }));
  });
});
