import { describe, it, expect } from "vitest";
import { safeErrorCode, safeDbErrorCode, safeProviderErrorCode } from "./safe-log-codes";

// Sentinelas SINTÉTICAS (não são dados reais): CPF de teste, e-mail em
// domínio .invalid, e um texto externo com formato de "código" aparentemente
// normal -- nenhum deles pode sair destas funções.
const CPF = "52998224725";
const EMAIL = "nfsynth.cliente@example.invalid";
const TOKEN_SHAPED_EXTERNAL = `NFSYNTH_CPF_${CPF}`;
const leaks = (out: string) => [CPF, EMAIL, "NFSYNTH"].filter((s) => out.includes(s));

describe("safeErrorCode (código estruturado de erro)", () => {
  it.each([
    ["42501", "42501"],
    ["P0001", "P0001"],
    ["PGRST301", "PGRST301"],
    [undefined, "NONE"],
    [null, "NONE"],
    ["", "NONE"],
    ["permission denied", "UNRECOGNIZED"],
    [TOKEN_SHAPED_EXTERNAL, "UNRECOGNIZED"],
    [42501, "UNRECOGNIZED"],
  ])("%s -> %s", (input, expected) => {
    expect(safeErrorCode(input)).toBe(expected);
  });
});

describe("safeDbErrorCode (erro do PostgREST/Postgres)", () => {
  // Lista fechada (revisão Hermes 2026-11-06): formato de token não basta.
  it.each([
    "WITHDRAWAL_NOT_FOUND", "INVALID_PROVIDER_TRANSFER_ID", "PROVIDER_TRANSFER_ID_MISMATCH",
    "PAYMENT_NOT_FOUND", "PROVIDER_PAYMENT_ID_MISMATCH", "PAYMENT_NOT_PENDING",
    "INVALID_REFUND_EVENT_TYPE", "INVALID_PROVIDER_REFUND_ID", "REFUND_NOT_FOUND", "PROVIDER_REFUND_ID_MISMATCH", "REFUND_NOT_PENDING",
    "INVALID_COMPANY_ID", "INVALID_PROVIDER_PAYMENT_ID", "INVALID_EVENT_TYPE", "SUBSCRIPTION_RENEWAL_NOT_APPLIED",
    "PROVIDER_PAYMENT_ID_REQUIRED", "INVALID_CONFIRMED_AMOUNT", "PAYMENT_RECEIVED_EXCEPTION_MISMATCH",
    "INVALID_EVENT_KEY", "EVENT_KEY_CONFLICT", "TRANSFER_IDENTITY_UNPROVEN", "TERMINAL_OUTCOME_CONFLICT",
    "CONFLICT_CAPTURE_INVALID_INPUT", "CONFLICT_CAPTURE_POLICY_MISSING", "CONFLICT_CAPTURE_CAPACITY_EXCEEDED",
  ])("keeps the known SQL domain token %s (P0001)", (token) => {
    expect(safeDbErrorCode({ code: "P0001", message: token })).toBe(token);
  });
  it("drops an unknown token-shaped P0001 message carrying personal data (P0001 alone is not trust)", () => {
    const out = safeDbErrorCode({ code: "P0001", message: "CLIENTE_CPF_00000000000" });
    expect(out).toBe("P0001");
    expect(out).not.toContain("00000000000");
  });
  it("drops free text even under P0001 (keeps only the SQLSTATE)", () => {
    expect(safeDbErrorCode({ code: "P0001", message: `Cliente ${EMAIL} sem documento` })).toBe("P0001");
  });
  it("never uses the message of other SQLSTATEs, even when it looks like a token", () => {
    expect(safeDbErrorCode({ code: "22P02", message: `invalid input syntax for type uuid: "${TOKEN_SHAPED_EXTERNAL}"` })).toBe("22P02");
    expect(safeDbErrorCode({ code: "23505", message: TOKEN_SHAPED_EXTERNAL })).toBe("23505");
  });
  it("network/client errors without a code become NONE, never the message", () => {
    const out = safeDbErrorCode({ message: `TypeError: fetch failed ${EMAIL}` });
    expect(out).toBe("NONE");
    expect(leaks(out)).toEqual([]);
  });
  it("null/undefined error -> NONE", () => {
    expect(safeDbErrorCode(null)).toBe("NONE");
    expect(safeDbErrorCode(undefined)).toBe("NONE");
  });
});

describe("safeProviderErrorCode (erro devolvido pelo adapter do Asaas)", () => {
  it.each(["AMBIGUOUS_CUSTOMER_MATCH", "AMBIGUOUS_PAYMENT_MATCH", "AMBIGUOUS_EXISTING_REFUND", "REFUND_ID_MISSING_IN_RESPONSE"])(
    "keeps the adapter's own fixed code %s",
    (code) => {
      expect(safeProviderErrorCode({ error: code })).toBe(code);
    }
  );
  it("replaces an external description (token-shaped or not) by the HTTP status", () => {
    expect(safeProviderErrorCode({ error: TOKEN_SHAPED_EXTERNAL, status: 400 })).toBe("PROVIDER_HTTP_400");
    expect(safeProviderErrorCode({ error: `A chave Pix ${EMAIL} é inválida`, status: 400 })).toBe("PROVIDER_HTTP_400");
  });
  it("without a valid status -> PROVIDER_ERROR", () => {
    expect(safeProviderErrorCode({ error: `CPF ${CPF} inválido` })).toBe("PROVIDER_ERROR");
    expect(safeProviderErrorCode({ error: "x", status: 9999 })).toBe("PROVIDER_ERROR");
  });
});
