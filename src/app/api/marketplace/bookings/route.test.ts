import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeRequestFingerprint } from "@/lib/marketplace-api";

// POST /api/marketplace/bookings: cobre validação de `marketplacePolicy`, o
// que é repassado pra RPC create_marketplace_booking (assinatura com snapshot,
// migration 0080) e o mapeamento dos erros de política vindos do banco.
// createAdminClient importa "server-only" -- mock mínimo só do encadeamento
// usado pela rota. Imutabilidade/replay/ACL do snapshot de verdade vivem no
// banco e são testados em supabase/tests/database/ (pgTAP, Supabase local).

const DEPARTURE_ID = "11111111-1111-4111-8111-111111111111";

const departureRow = {
  id: DEPARTURE_ID,
  company_id: "22222222-2222-4222-8222-222222222222",
  departs_at: "2099-01-01T12:00:00+00:00",
  status: "agendada",
  price_cents: 10000,
  price_type: "por_pessoa",
  marketplace_sales_enabled: true,
  tours: {
    id: "t-1",
    slug: "passeio-teste",
    name: "Passeio teste",
    active: true,
    marketplace_status: "published",
    marketplace_suspended_at: null,
    price_type: "por_pessoa",
  },
  companies: { suspended_at: null },
};

type RpcResult = { data: unknown; error: { message: string } | null };
let bookingRpcResult: RpcResult;

const rpcMock = vi.fn(async (name: string): Promise<RpcResult> => {
  if (name === "check_rate_limit") return { data: true, error: null };
  return bookingRpcResult;
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: rpcMock,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: departureRow, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/security-log", () => ({ logSecurityEvent: vi.fn() }));

const ORIGINAL_SECRET = process.env.TOURSFLOW_API_SECRET;

const validPolicy = {
  id: "toursflow-cancelamento",
  version: "2026-10-01",
  title: "Política de cancelamento",
  summary: "Cancelamento gratuito até 24h antes.",
  terms: ["Reembolso integral até 24h antes da saída."],
};

const customer = { name: "Maria Teste", email: "maria@example.com" };

function bookingRequest(body: Record<string, unknown>): Request {
  return new Request("https://nauticflow.com.br/api/marketplace/bookings", {
    method: "POST",
    headers: {
      authorization: "Bearer correct-secret",
      "x-toursflow-client-key": "a".repeat(64),
      "idempotency-key": "toursflow-booking-12345678",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function bookingCalls() {
  return rpcMock.mock.calls.filter(([name]) => name === "create_marketplace_booking");
}

beforeEach(() => {
  process.env.TOURSFLOW_API_SECRET = "correct-secret";
  rpcMock.mockClear();
  bookingRpcResult = {
    data: [{ booking_id: "b-1", hold_expires_at: "2099-01-01T11:00:00+00:00", people_count: 2, total_cents: 20000, is_replay: false }],
    error: null,
  };
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.TOURSFLOW_API_SECRET;
  else process.env.TOURSFLOW_API_SECRET = ORIGINAL_SECRET;
});

describe("POST /api/marketplace/bookings (marketplacePolicy)", () => {
  it("rejects a request without marketplacePolicy before calling the booking RPC", async () => {
    const { POST } = await import("./route");
    const response = await POST(bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer }));
    const json = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_REQUEST");
    expect(bookingCalls()).toHaveLength(0);
  });

  it("rejects a policy with an empty terms array", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: { ...validPolicy, terms: [] } })
    );
    expect(response.status).toBe(400);
    expect(bookingCalls()).toHaveLength(0);
  });

  it("forwards only the allowlisted, trimmed policy fields to the snapshot RPC signature", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      bookingRequest({
        departureId: DEPARTURE_ID,
        quantity: 2,
        customer,
        marketplacePolicy: { ...validPolicy, id: `  ${validPolicy.id} `, extra: "nunca persistir" },
      })
    );
    expect(response.status).toBe(201);
    const [, args] = bookingCalls()[0] as unknown as [string, Record<string, unknown>];
    expect(args.p_marketplace_policy_id).toBe(validPolicy.id);
    expect(args.p_marketplace_policy_version).toBe(validPolicy.version);
    expect(args.p_marketplace_policy_snapshot).toEqual(validPolicy);
  });

  it("keeps the idempotency fingerprint independent of the policy (stable across the 0080 deploy)", async () => {
    const { POST } = await import("./route");
    await POST(bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: validPolicy }));
    const [, args] = bookingCalls()[0] as unknown as [string, Record<string, unknown>];
    expect(args.p_request_fingerprint).toBe(
      computeRequestFingerprint({
        departureId: DEPARTURE_ID,
        quantity: 2,
        name: customer.name,
        email: customer.email,
        phone: null,
        cpfDigits: null,
      })
    );
  });

  it("maps MARKETPLACE_POLICY_CONFLICT from the RPC to 409, never a retryable 500", async () => {
    bookingRpcResult = { data: null, error: { message: "MARKETPLACE_POLICY_CONFLICT" } };
    const { POST } = await import("./route");
    const response = await POST(bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: validPolicy }));
    const json = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(409);
    expect(json.error.code).toBe("MARKETPLACE_POLICY_CONFLICT");
  });

  it("maps INVALID_MARKETPLACE_POLICY_SNAPSHOT from the RPC to 400 INVALID_REQUEST", async () => {
    bookingRpcResult = { data: null, error: { message: "INVALID_MARKETPLACE_POLICY_SNAPSHOT" } };
    const { POST } = await import("./route");
    const response = await POST(bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: validPolicy }));
    const json = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_REQUEST");
  });
});

describe("POST /api/marketplace/bookings (status HTTP)", () => {
  it("returns 201 without Idempotency-Replayed on a new booking", async () => {
    const { POST } = await import("./route");
    const response = await POST(bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: validPolicy }));
    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotency-Replayed")).toBeNull();
  });

  it("returns 200 with Idempotency-Replayed: true on a replay", async () => {
    bookingRpcResult = {
      data: [{ booking_id: "b-1", hold_expires_at: "2099-01-01T11:00:00+00:00", people_count: 2, total_cents: 20000, is_replay: true }],
      error: null,
    };
    const { POST } = await import("./route");
    const response = await POST(bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: validPolicy }));
    const json = (await response.json()) as { data: { bookingId: string } };
    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(json.data.bookingId).toBe("b-1");
  });
});

describe("POST /api/marketplace/bookings (normalização da política)", () => {
  async function postPolicy(policy: Record<string, unknown>) {
    const { POST } = await import("./route");
    return POST(bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: policy }));
  }

  function forwardedSnapshot() {
    const [, args] = bookingCalls()[0] as unknown as [string, Record<string, unknown>];
    return args.p_marketplace_policy_snapshot as Record<string, unknown>;
  }

  it("trims title, summary and every term before validating and forwarding", async () => {
    const response = await postPolicy({
      ...validPolicy,
      title: `\n ${validPolicy.title}\t`,
      summary: `  ${validPolicy.summary} `,
      terms: [` ${validPolicy.terms[0]}\n`],
    });
    expect(response.status).toBe(201);
    expect(forwardedSnapshot()).toEqual(validPolicy);
  });

  it("measures a term after trimming (1000 chars plus surrounding spaces is accepted)", async () => {
    const term = "a".repeat(1000);
    const response = await postPolicy({ ...validPolicy, terms: [`  ${term}  `] });
    expect(response.status).toBe(201);
    expect(forwardedSnapshot().terms).toEqual([term]);
  });

  it("counts emoji as one character, like PostgreSQL (200 emoji title is accepted)", async () => {
    const response = await postPolicy({ ...validPolicy, title: "🚤".repeat(200) });
    expect(response.status).toBe(201);
  });

  it("rejects a title with 201 emoji", async () => {
    const response = await postPolicy({ ...validPolicy, title: "🚤".repeat(201) });
    expect(response.status).toBe(400);
    expect(bookingCalls()).toHaveLength(0);
  });

  it("rejects a term that is only whitespace", async () => {
    const response = await postPolicy({ ...validPolicy, terms: ["válido", " \n\t "] });
    expect(response.status).toBe(400);
    expect(bookingCalls()).toHaveLength(0);
  });
});

describe("POST /api/marketplace/bookings (caractere NUL)", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["policy.id", { marketplacePolicy: { ...validPolicy, id: "pol\u0000x" } }],
    ["policy.version", { marketplacePolicy: { ...validPolicy, version: "2026\u0000" } }],
    ["policy.title", { marketplacePolicy: { ...validPolicy, title: "Pol\u0000ítica" } }],
    ["policy.summary", { marketplacePolicy: { ...validPolicy, summary: "Resumo\u0000" } }],
    ["policy.terms[]", { marketplacePolicy: { ...validPolicy, terms: ["ok", "termo\u0000"] } }],
    ["customer.name", { customer: { ...customer, name: "Maria\u0000" } }],
    ["customer.email", { customer: { ...customer, email: "maria\u0000@example.com" } }],
    ["customer.phone", { customer: { ...customer, phone: "1199\u00009999" } }],
    ["customer.cpf", { customer: { ...customer, cpf: "529.982.247-25\u0000" } }],
    ["departureId", { departureId: `${DEPARTURE_ID}\u0000` }],
  ];

  it.each(cases)("rejects NUL in %s with 400 INVALID_REQUEST before calling the booking RPC", async (_field, override) => {
    const { POST } = await import("./route");
    const response = await POST(
      bookingRequest({ departureId: DEPARTURE_ID, quantity: 2, customer, marketplacePolicy: validPolicy, ...override })
    );
    const json = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_REQUEST");
    expect(bookingCalls()).toHaveLength(0);
  });
});
