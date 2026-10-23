import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";

// Isolamento total para os testes de PAYMENT_RECEIVED (marketplace): o client
// do Supabase e a verificação no Asaas são substituídos -- nenhuma rede, nenhum
// Supabase remoto. Os testes de AUTH abaixo nunca chegam a usá-los.
const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  // consulta de linha local: (tabela, coluna, valor) -> { data, error }.
  // Padrão: payments por id existe (fluxo marketplace); o resto não existe.
  lookup: vi.fn(),
}));

function defaultLookup(table: string, column: string) {
  if (table === "payments" && column === "id") return { data: { id: "payment-row" }, error: null };
  return { data: null, error: null };
}

beforeEach(() => {
  supabaseMock.lookup.mockReset();
  supabaseMock.lookup.mockImplementation(defaultLookup);
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => supabaseMock.lookup(table, column, value),
          limit: async () => {
            const res = supabaseMock.lookup(table, column, value) as { data: unknown; error: unknown };
            return { data: res.data ? [res.data] : [], error: res.error };
          },
        }),
      }),
      insert: (row: unknown) => supabaseMock.insert(table, row),
    }),
    rpc: (name: string, args: unknown) => {
      const result = supabaseMock.rpc(name, args);
      // o caminho de produção usa .maybeSingle() em algumas RPCs; aqui o
      // resultado é thenable e também expõe maybeSingle().
      return Object.assign(Promise.resolve(result), { maybeSingle: async () => result });
    },
  }),
}));

vi.mock("@/lib/asaas", () => ({
  verifyAsaasPaymentSettled: vi.fn(async () => ({ ok: true, status: "RECEIVED", valueCents: 15000 })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const securityLog = vi.hoisted(() => ({ logSecurityEvent: vi.fn() }));
vi.mock("@/lib/security-log", () => securityLog);

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
  const INTERNAL_PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
  const receivedEvent = {
    id: "evt_received_1",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_provider_1", externalReference: INTERNAL_PAYMENT_ID, value: 150 },
  };

  beforeEach(() => {
    supabaseMock.rpc.mockReset();
    supabaseMock.insert.mockReset();
    supabaseMock.insert.mockResolvedValue({ error: null });
  });

  it("responds 5xx (so Asaas retries) when settlement fails, never 200", async () => {
    supabaseMock.rpc.mockReturnValue({ data: null, error: { message: "settlement exploded" } });

    const response = await POST(webhookRequest(receivedEvent, "correct-webhook-token"));

    expect(response.status).toBeGreaterThanOrEqual(500);
    // a marca de dedupe nunca é gravada fora da transação da RPC
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it("calls the atomic settlement RPC when it reports a pre-existing marker/replay", async () => {
    supabaseMock.rpc.mockReturnValue({
      data: [{ payment_id: INTERNAL_PAYMENT_ID, status: "paid", reservation_status: "confirmada", is_replay: true, requires_manual_review: false, marker_reused: true }],
      error: null,
    });

    const response = await POST(webhookRequest(receivedEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("settle_marketplace_payment_received_once", {
      p_event_key: "evt_received_1",
      p_event_type: "PAYMENT_RECEIVED",
      p_internal_payment_id: INTERNAL_PAYMENT_ID,
      p_provider_payment_id: "pay_provider_1",
      p_confirmed_amount_cents: 15000,
    });
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it("responds 200 and logs the payment exception when the RPC recorded one (local payment failed)", async () => {
    securityLog.logSecurityEvent.mockClear();
    supabaseMock.rpc.mockReturnValue({
      data: [{
        payment_id: INTERNAL_PAYMENT_ID, status: "failed", reservation_status: null, is_replay: false,
        requires_manual_review: true, marker_reused: false, payment_exception_id: "22222222-2222-4222-8222-222222222222",
      }],
      error: null,
    });

    const response = await POST(webhookRequest(receivedEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, paymentException: true });
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("marketplace_payment_exception_recorded", {
      paymentId: INTERNAL_PAYMENT_ID,
      exceptionId: "22222222-2222-4222-8222-222222222222",
      isReplay: false,
    });
  });

  it("responds 200 for a normal settlement row (paid, no exception)", async () => {
    supabaseMock.rpc.mockReturnValue({
      data: [{
        payment_id: INTERNAL_PAYMENT_ID, status: "paid", reservation_status: "confirmada", is_replay: false,
        requires_manual_review: false, marker_reused: false, payment_exception_id: null,
      }],
      error: null,
    });

    const response = await POST(webhookRequest(receivedEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("responds 200 for the 0059 amount-mismatch outcome (pending + manual review recorded)", async () => {
    supabaseMock.rpc.mockReturnValue({
      data: [{
        payment_id: INTERNAL_PAYMENT_ID, status: "pending", reservation_status: null, is_replay: false,
        requires_manual_review: true, marker_reused: false, payment_exception_id: null,
      }],
      error: null,
    });

    const response = await POST(webhookRequest(receivedEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
  });

  it("responds 200 when externalReference is an uppercase UUID and the RPC echoes it in canonical lowercase", async () => {
    const upperId = "ABCDEF12-3456-4ABC-8DEF-ABCDEF123456";
    supabaseMock.rpc.mockReturnValue({
      data: [{
        payment_id: upperId.toLowerCase(), status: "paid", reservation_status: "confirmada", is_replay: false,
        requires_manual_review: false, marker_reused: false, payment_exception_id: null,
      }],
      error: null,
    });

    const response = await POST(webhookRequest(
      { ...receivedEvent, payment: { ...receivedEvent.payment, externalReference: upperId } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("responds 200 for the 0059 paid + manual review outcome (reservation not confirmable / capacity lost)", async () => {
    supabaseMock.rpc.mockReturnValue({
      data: [{
        payment_id: INTERNAL_PAYMENT_ID, status: "paid", reservation_status: "cancelada", is_replay: false,
        requires_manual_review: true, marker_reused: false, payment_exception_id: null,
      }],
      error: null,
    });

    const response = await POST(webhookRequest(receivedEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
  });

  // Sem erro mas sem confirmação válida de persistência: nunca 200 -- 5xx
  // retryable, para o Asaas reenviar.
  const unconfirmedResults: Array<[string, unknown]> = [
    ["null data", null],
    ["empty array", []],
    ["a non-array object", { payment_id: INTERNAL_PAYMENT_ID, status: "paid" }],
    ["more than one row", [
      { payment_id: INTERNAL_PAYMENT_ID, status: "paid", reservation_status: "confirmada", is_replay: false, requires_manual_review: false, marker_reused: false, payment_exception_id: null },
      { payment_id: INTERNAL_PAYMENT_ID, status: "paid", reservation_status: "confirmada", is_replay: true, requires_manual_review: false, marker_reused: true, payment_exception_id: null },
    ]],
    ["a row for another payment", [{
      payment_id: "99999999-9999-4999-8999-999999999999", status: "paid", reservation_status: "confirmada",
      is_replay: false, requires_manual_review: false, marker_reused: false, payment_exception_id: null,
    }]],
    ["an unknown status", [{
      payment_id: INTERNAL_PAYMENT_ID, status: "processing", reservation_status: null,
      is_replay: false, requires_manual_review: false, marker_reused: false, payment_exception_id: null,
    }]],
    ["pending without manual review", [{
      payment_id: INTERNAL_PAYMENT_ID, status: "pending", reservation_status: null,
      is_replay: false, requires_manual_review: false, marker_reused: false, payment_exception_id: null,
    }]],
    ["non-boolean flags", [{
      payment_id: INTERNAL_PAYMENT_ID, status: "paid", reservation_status: "confirmada",
      is_replay: "false", requires_manual_review: null, marker_reused: false, payment_exception_id: null,
    }]],
    ["an exception id with a status other than failed", [{
      payment_id: INTERNAL_PAYMENT_ID, status: "paid", reservation_status: "confirmada", is_replay: false,
      requires_manual_review: true, marker_reused: false, payment_exception_id: "22222222-2222-4222-8222-222222222222",
    }]],
    ["status failed without an exception id", [{
      payment_id: INTERNAL_PAYMENT_ID, status: "failed", reservation_status: null, is_replay: false,
      requires_manual_review: true, marker_reused: false, payment_exception_id: null,
    }]],
    ["a malformed exception id", [{
      payment_id: INTERNAL_PAYMENT_ID, status: "failed", reservation_status: null, is_replay: false,
      requires_manual_review: true, marker_reused: false, payment_exception_id: "not-a-uuid",
    }]],
  ];

  it.each(unconfirmedResults)("responds 5xx (retryable) when the RPC returns %s without error", async (_label, data) => {
    securityLog.logSecurityEvent.mockClear();
    supabaseMock.rpc.mockReturnValue({ data, error: null });

    const response = await POST(webhookRequest(receivedEvent, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "settlement_unconfirmed" });
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("marketplace_payment_settlement_unconfirmed", {
      paymentId: INTERNAL_PAYMENT_ID,
    });
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });
});

// Ramos de transferência, PAYMENT_CONFIRMED, PAYMENT_DELETED e refunds
// (migration 0085): marca + efeito numa única RPC transacional. A rota nunca
// grava a marca sozinha e só responde 200 com um resultado reconhecido.
describe("POST /api/webhooks/asaas (transfer events, atomic RPC)", () => {
  const WITHDRAWAL_ID = "33333333-3333-4333-8333-333333333333";
  const doneEvent = {
    id: "evt_transfer_done_1",
    event: "TRANSFER_DONE",
    transfer: { id: "tr_provider_1", externalReference: WITHDRAWAL_ID, fee: 1.5 },
  };

  beforeEach(() => {
    supabaseMock.rpc.mockReset();
    supabaseMock.insert.mockReset();
    supabaseMock.insert.mockResolvedValue({ error: null });
    securityLog.logSecurityEvent.mockClear();
  });

  it("calls the atomic transfer RPC and responds 200 for a finalized outcome", async () => {
    supabaseMock.rpc.mockReturnValue({
      data: [{ withdrawal_id: WITHDRAWAL_ID, withdrawal_status: "completed", outcome: "finalized", marker_reused: false }],
      error: null,
    });

    const response = await POST(webhookRequest(doneEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("process_marketplace_transfer_webhook_event", {
      p_event_key: "evt_transfer_done_1",
      p_event_type: "TRANSFER_DONE",
      p_withdrawal_id: WITHDRAWAL_ID,
      p_provider_transfer_id: "tr_provider_1",
      p_provider_fee_cents: 150,
    });
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it("uses the event-prefixed fallback key and no fee for an intermediate event", async () => {
    supabaseMock.rpc.mockReturnValue({
      data: [{ withdrawal_id: WITHDRAWAL_ID, withdrawal_status: "processing", outcome: "in_progress", marker_reused: false }],
      error: null,
    });

    const response = await POST(webhookRequest(
      { event: "TRANSFER_BLOCKED", transfer: { id: "tr_provider_1", externalReference: WITHDRAWAL_ID, fee: 1.5 } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("process_marketplace_transfer_webhook_event", expect.objectContaining({
      p_event_key: "TRANSFER_BLOCKED:tr_provider_1",
      p_provider_fee_cents: null,
    }));
  });

  it("responds 200 for an already-final or unknown withdrawal (recognized outcomes)", async () => {
    for (const row of [
      { withdrawal_id: WITHDRAWAL_ID, withdrawal_status: "failed", outcome: "already_final", marker_reused: true },
      { withdrawal_id: WITHDRAWAL_ID, withdrawal_status: null, outcome: "withdrawal_not_found", marker_reused: false },
    ]) {
      supabaseMock.rpc.mockReturnValue({ data: [row], error: null });
      const response = await POST(webhookRequest(doneEvent, "correct-webhook-token"));
      expect(response.status).toBe(200);
    }
  });

  it("responds 5xx (retryable) when the transfer RPC fails, never 200", async () => {
    supabaseMock.rpc.mockReturnValue({ data: null, error: { message: "INVALID_PROVIDER_FEE" } });

    const response = await POST(webhookRequest(doneEvent, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "transfer_processing_failed" });
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["null data", null],
    ["empty array", []],
    ["another withdrawal", [{ withdrawal_id: "44444444-4444-4444-8444-444444444444", withdrawal_status: "completed", outcome: "finalized", marker_reused: false }]],
    ["an unknown outcome", [{ withdrawal_id: WITHDRAWAL_ID, withdrawal_status: "completed", outcome: "done", marker_reused: false }]],
    ["an in-progress outcome for a terminal event", [{ withdrawal_id: WITHDRAWAL_ID, withdrawal_status: "processing", outcome: "in_progress", marker_reused: false }]],
    ["a non-boolean marker flag", [{ withdrawal_id: WITHDRAWAL_ID, withdrawal_status: "completed", outcome: "finalized", marker_reused: "no" }]],
  ])("responds 5xx when the transfer RPC returns %s", async (_label, data) => {
    supabaseMock.rpc.mockReturnValue({ data, error: null });

    const response = await POST(webhookRequest(doneEvent, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "transfer_processing_unconfirmed" });
  });

  it("ignores a non-uuid externalReference of a transfer that is not ours (no RPC)", async () => {
    const response = await POST(webhookRequest(
      { ...doneEvent, transfer: { ...doneEvent.transfer, externalReference: "not-a-withdrawal" } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.insert).not.toHaveBeenCalled();
    expect(supabaseMock.lookup).toHaveBeenCalledWith("marketplace_withdrawals", "provider_transfer_id", "tr_provider_1");
  });

  // 0086/H: evento que claramente pertence a um saque LOCAL, mas sem os
  // campos para processá-lo, nunca é descartado com 200.
  it("responds 422 (never 200) when a local withdrawal's event has no transfer id", async () => {
    supabaseMock.lookup.mockImplementation((table: string, column: string) =>
      table === "marketplace_withdrawals" && column === "id" ? { data: { id: WITHDRAWAL_ID }, error: null } : { data: null, error: null });

    const response = await POST(webhookRequest(
      { id: "evt_x", event: "TRANSFER_DONE", transfer: { externalReference: WITHDRAWAL_ID } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_DONE", kind: "transfer", reason: "missing_transfer_id",
    });
  });

  it("responds 422 when the transfer id belongs to a local withdrawal but externalReference does not", async () => {
    supabaseMock.lookup.mockImplementation((table: string, column: string, value: unknown) =>
      table === "marketplace_withdrawals" && column === "provider_transfer_id" && value === "tr_provider_1"
        ? { data: { id: WITHDRAWAL_ID }, error: null } : { data: null, error: null });

    const response = await POST(webhookRequest(
      { ...doneEvent, transfer: { id: "tr_provider_1" } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(422);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "TRANSFER_DONE", kind: "transfer", reason: "reference_mismatch",
    });
  });

  it("responds 200 for a transfer without local reference nor local transfer id (not ours)", async () => {
    const response = await POST(webhookRequest({ event: "TRANSFER_DONE", transfer: { id: "tr_someone_else" } }, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("responds 5xx when the local-reference lookup fails (cannot tell if the event is ours)", async () => {
    supabaseMock.lookup.mockReturnValue({ data: null, error: { message: "boom" } });

    const response = await POST(webhookRequest({ event: "TRANSFER_DONE", transfer: { id: "tr_x" } }, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "reference_lookup_failed" });
  });

  // 0086/E: o status precisa ser coerente com o evento e o desfecho.
  it.each([
    ["finalized with a non-final status", doneEvent, { withdrawal_status: "pending", outcome: "finalized" }],
    ["finalized with the status of another outcome", doneEvent, { withdrawal_status: "failed", outcome: "finalized" }],
    ["already_final with a non-final status", doneEvent, { withdrawal_status: "processing", outcome: "already_final" }],
    ["in_progress still pending", { ...doneEvent, event: "TRANSFER_PENDING" }, { withdrawal_status: "pending", outcome: "in_progress" }],
    ["finalized for an intermediate event", { ...doneEvent, event: "TRANSFER_PENDING" }, { withdrawal_status: "completed", outcome: "finalized" }],
  ])("responds 5xx when the transfer RPC returns %s", async (_label, body, over) => {
    supabaseMock.rpc.mockReturnValue({ data: [{ withdrawal_id: WITHDRAWAL_ID, marker_reused: false, ...over }], error: null });

    const response = await POST(webhookRequest(body, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "transfer_processing_unconfirmed" });
  });

  it.each([
    ["TRANSFER_FAILED finalized/failed", "TRANSFER_FAILED", { withdrawal_status: "failed", outcome: "finalized" }],
    ["TRANSFER_CANCELLED finalized/cancelled", "TRANSFER_CANCELLED", { withdrawal_status: "cancelled", outcome: "finalized" }],
    ["late intermediate event on a final withdrawal", "TRANSFER_PENDING", { withdrawal_status: "completed", outcome: "in_progress" }],
  ])("responds 200 for the coherent result %s", async (_label, event, over) => {
    supabaseMock.rpc.mockReturnValue({ data: [{ withdrawal_id: WITHDRAWAL_ID, marker_reused: false, ...over }], error: null });

    const response = await POST(webhookRequest({ ...doneEvent, event }, "correct-webhook-token"));

    expect(response.status).toBe(200);
  });
});

describe("POST /api/webhooks/asaas (marketplace CONFIRMED/DELETED/refunds, atomic RPC)", () => {
  const INTERNAL_PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
  const confirmedEvent = {
    id: "evt_confirmed_1",
    event: "PAYMENT_CONFIRMED",
    payment: { id: "pay_provider_1", externalReference: INTERNAL_PAYMENT_ID, value: 150 },
  };
  const refundedEvent = {
    id: "evt_refunded_1",
    event: "PAYMENT_REFUNDED",
    payment: {
      id: "pay_provider_1", externalReference: INTERNAL_PAYMENT_ID, value: 150,
      refunds: [{ id: "ref_old", value: 10 }, { id: "ref_provider_1", value: 150 }],
    },
  };
  const row = (over: Record<string, unknown>) => ({
    payment_id: INTERNAL_PAYMENT_ID, payment_status: "pending", outcome: "provider_marked",
    refund_id: null, refund_status: null, marker_reused: false, ...over,
  });

  beforeEach(() => {
    supabaseMock.rpc.mockReset();
    supabaseMock.insert.mockReset();
    supabaseMock.insert.mockResolvedValue({ error: null });
    securityLog.logSecurityEvent.mockClear();
  });

  it("PAYMENT_CONFIRMED calls the atomic payment RPC and responds 200", async () => {
    supabaseMock.rpc.mockReturnValue({ data: [row({})], error: null });

    const response = await POST(webhookRequest(confirmedEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("process_marketplace_payment_webhook_event", {
      p_event_key: "evt_confirmed_1",
      p_event_type: "PAYMENT_CONFIRMED",
      p_payment_id: INTERNAL_PAYMENT_ID,
      p_provider_payment_id: "pay_provider_1",
      p_provider_refund_id: null,
      p_reported_amount_cents: null,
    });
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it("PAYMENT_DELETED responds 200 for the recognized hold_still_valid outcome", async () => {
    supabaseMock.rpc.mockReturnValue({ data: [row({ outcome: "hold_still_valid" })], error: null });

    const response = await POST(webhookRequest({ ...confirmedEvent, id: "evt_deleted_1", event: "PAYMENT_DELETED" }, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("process_marketplace_payment_webhook_event", expect.objectContaining({
      p_event_type: "PAYMENT_DELETED",
    }));
  });

  it("refund events pass the latest refund id/value and log manual review outcomes", async () => {
    supabaseMock.rpc.mockReturnValue({
      data: [row({ payment_status: "paid", outcome: "manual_review_created", refund_id: "55555555-5555-4555-8555-555555555555", refund_status: "manual_review" })],
      error: null,
    });

    const response = await POST(webhookRequest(refundedEvent, "correct-webhook-token"));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("process_marketplace_payment_webhook_event", {
      p_event_key: "evt_refunded_1",
      p_event_type: "PAYMENT_REFUNDED",
      p_payment_id: INTERNAL_PAYMENT_ID,
      p_provider_payment_id: "pay_provider_1",
      p_provider_refund_id: "ref_provider_1",
      p_reported_amount_cents: 15000,
    });
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("refund_reconciliation_required", {
      paymentId: INTERNAL_PAYMENT_ID,
      eventType: "PAYMENT_REFUNDED",
    });
  });

  it.each([
    ["PAYMENT_CONFIRMED", confirmedEvent],
    ["PAYMENT_DELETED", { ...confirmedEvent, event: "PAYMENT_DELETED" }],
    ["PAYMENT_REFUNDED", refundedEvent],
  ])("%s responds 5xx (retryable) when the RPC fails, never 200", async (_label, body) => {
    supabaseMock.rpc.mockReturnValue({ data: null, error: { message: "PROVIDER_PAYMENT_ID_MISMATCH" } });

    const response = await POST(webhookRequest(body, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "payment_event_failed" });
    expect(supabaseMock.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["null data", confirmedEvent, null],
    ["empty array", confirmedEvent, []],
    ["another payment", confirmedEvent, [row({ payment_id: "99999999-9999-4999-8999-999999999999" })]],
    ["an outcome of another event type", confirmedEvent, [row({ outcome: "cancelled" })]],
    ["an unknown refund action", refundedEvent, [row({ outcome: "refunded_ok", refund_id: "55555555-5555-4555-8555-555555555555", refund_status: "completed" })]],
    ["a refund outcome without refund id", refundedEvent, [row({ outcome: "completed", refund_status: "completed" })]],
    ["a non-boolean marker flag", confirmedEvent, [row({ marker_reused: null })]],
  ])("responds 5xx when the payment RPC returns %s", async (_label, body, data) => {
    supabaseMock.rpc.mockReturnValue({ data, error: null });

    const response = await POST(webhookRequest(body, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "payment_event_unconfirmed" });
  });

  // 0086/E: estado do payment/refund coerente com evento e desfecho.
  const REFUND_ID = "55555555-5555-4555-8555-555555555555";
  const deletedEvent = { ...confirmedEvent, id: "evt_deleted_2", event: "PAYMENT_DELETED" };
  const deniedEvent = { ...refundedEvent, id: "evt_denied_1", event: "PAYMENT_REFUND_DENIED" };
  const inProgressEvent = { ...refundedEvent, id: "evt_in_progress_1", event: "PAYMENT_REFUND_IN_PROGRESS" };
  const refundRow = (over: Record<string, unknown>) => row({ payment_status: "paid", refund_id: REFUND_ID, ...over });

  it.each([
    ["CONFIRMED with an unknown payment status", confirmedEvent, row({ payment_status: "settled" })],
    ["DELETED cancelled while the payment is still pending", deletedEvent, row({ outcome: "cancelled", payment_status: "pending" })],
    ["DELETED not_pending while pending", deletedEvent, row({ outcome: "not_pending", payment_status: "pending" })],
    ["DELETED hold_still_valid on a failed payment", deletedEvent, row({ outcome: "hold_still_valid", payment_status: "failed" })],
    ["DENIED with a completed outcome", deniedEvent, refundRow({ outcome: "completed", refund_status: "completed" })],
    ["DENIED failed while the refund is completed", deniedEvent, refundRow({ outcome: "failed", refund_status: "completed" })],
    ["REFUNDED completed while the refund is in manual review", refundedEvent, refundRow({ outcome: "completed", refund_status: "manual_review" })],
    ["REFUNDED with an in-progress outcome", refundedEvent, refundRow({ outcome: "processing", refund_status: "processing" })],
    ["IN_PROGRESS processing while the refund is completed", inProgressEvent, refundRow({ outcome: "processing", refund_status: "completed" })],
    ["no_op on a refund still open", refundedEvent, refundRow({ outcome: "no_op", refund_status: "processing" })],
    ["manual review outcome with another status", refundedEvent, refundRow({ outcome: "manual_review_created", refund_status: "completed" })],
    ["an unknown refund status", refundedEvent, refundRow({ outcome: "no_op", refund_status: "refunded" })],
    ["an unknown payment status on a refund", refundedEvent, refundRow({ outcome: "completed", refund_status: "completed", payment_status: "x" })],
  ])("responds 5xx when the payment RPC returns %s", async (_label, body, data) => {
    supabaseMock.rpc.mockReturnValue({ data: [data], error: null });

    const response = await POST(webhookRequest(body, "correct-webhook-token"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "payment_event_unconfirmed" });
  });

  it.each([
    ["DELETED cancelled", deletedEvent, row({ outcome: "cancelled", payment_status: "failed" })],
    ["DELETED not_pending (already paid)", deletedEvent, row({ outcome: "not_pending", payment_status: "paid" })],
    ["DENIED failed", deniedEvent, refundRow({ outcome: "failed", refund_status: "failed" })],
    ["DENIED no_op on a completed refund", deniedEvent, refundRow({ outcome: "no_op", refund_status: "completed" })],
    ["REFUNDED completed", refundedEvent, refundRow({ outcome: "completed", refund_status: "completed" })],
    ["REFUNDED amount mismatch", refundedEvent, refundRow({ outcome: "manual_review_existing", refund_status: "manual_review" })],
    ["IN_PROGRESS processing", inProgressEvent, refundRow({ outcome: "processing", refund_status: "processing" })],
    ["IN_PROGRESS late on a completed refund", inProgressEvent, refundRow({ outcome: "no_op", refund_status: "completed" })],
  ])("responds 200 for the coherent result %s", async (_label, body, data) => {
    supabaseMock.rpc.mockReturnValue({ data: [data], error: null });

    const response = await POST(webhookRequest(body, "correct-webhook-token"));

    expect(response.status).toBe(200);
  });

  // 0086/H
  it("responds 422 (never 200) when a local payment's event has no payment id", async () => {
    const response = await POST(webhookRequest(
      { id: "evt_r", event: "PAYMENT_REFUNDED", payment: { externalReference: INTERNAL_PAYMENT_ID, value: 150 } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unprocessable_marketplace_event" });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event: "PAYMENT_REFUNDED", kind: "payment", reason: "missing_payment_id",
    });
  });

  it.each([
    ["PAYMENT_DELETED", "not-a-uuid"],
    ["PAYMENT_REFUNDED", undefined],
    ["PAYMENT_CONFIRMED", "22222222-2222-4222-8222-222222222222"],
  ])("responds 422 when %s carries a charge of a local payment but externalReference does not match (%s)", async (event, externalReference) => {
    supabaseMock.lookup.mockImplementation((table: string, column: string, value: unknown) =>
      table === "payments" && column === "provider_payment_id" && value === "pay_provider_1"
        ? { data: { id: INTERNAL_PAYMENT_ID }, error: null } : { data: null, error: null });

    const response = await POST(webhookRequest(
      { id: "evt_m", event, payment: { id: "pay_provider_1", externalReference, value: 150 } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(422);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(securityLog.logSecurityEvent).toHaveBeenCalledWith("asaas_webhook_unprocessable_marketplace_event", {
      event, kind: "payment", reason: "reference_mismatch",
    });
  });

  it("responds 200 for a refund event of a charge that is not ours (no local reference)", async () => {
    supabaseMock.lookup.mockImplementation(() => ({ data: null, error: null }));

    const response = await POST(webhookRequest(
      { id: "evt_o", event: "PAYMENT_REFUNDED", payment: { id: "pay_other", value: 10 } },
      "correct-webhook-token",
    ));

    expect(response.status).toBe(200);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});
