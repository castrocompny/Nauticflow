// Códigos seguros para logs (Sentry via logSecurityEvent, console do servidor).
// Mensagens de erro de banco, rede ou provider podem carregar dado pessoal
// (CPF, e-mail, telefone, chave Pix) ou texto arbitrário de terceiros --
// truncar não resolve. Daqui só sai código estruturado ou constante.

const STRUCTURED_CODE = /^([0-9A-Z]{5}|PGRST\d{3})$/; // SQLSTATE ou código do PostgREST

// Lista FECHADA dos tokens de RAISE EXCEPTION (SQLSTATE P0001) das funções SQL
// cujos erros chegam a log, conferida em supabase/migrations (0060-0090).
// Formato de token não é confiança: "CLIENTE_CPF_..." também casa com
// [A-Z_]+. Token novo em SQL que deva aparecer no log entra aqui, com teste.
const SQL_DOMAIN_TOKENS = new Set([
  // mark_marketplace_withdrawal_processing / process_marketplace_transfer_webhook_event (0089)
  "WITHDRAWAL_NOT_FOUND", "INVALID_PROVIDER_TRANSFER_ID", "PROVIDER_TRANSFER_ID_MISMATCH",
  "INVALID_EVENT_KEY", "INVALID_EVENT_TYPE", "EVENT_KEY_CONFLICT", "TRANSFER_IDENTITY_UNPROVEN", "TERMINAL_OUTCOME_CONFLICT",
  // mark_marketplace_payment_provider_created / process_marketplace_payment_received_event (0081), claim (0082)
  "PAYMENT_NOT_FOUND", "PROVIDER_PAYMENT_ID_MISMATCH", "PROVIDER_PAYMENT_ID_REQUIRED", "INVALID_CONFIRMED_AMOUNT",
  "PAYMENT_RECEIVED_EXCEPTION_MISMATCH", "PAYMENT_NOT_PENDING",
  // reconcile_marketplace_refund_webhook_event (0060), mark_marketplace_refund_processing (0061/0062)
  "INVALID_REFUND_EVENT_TYPE", "INVALID_PROVIDER_REFUND_ID", "REFUND_NOT_FOUND", "PROVIDER_REFUND_ID_MISMATCH", "REFUND_NOT_PENDING",
  // renew_subscription_from_asaas_payment (0079)
  "INVALID_COMPANY_ID", "INVALID_PROVIDER_PAYMENT_ID", "SUBSCRIPTION_RENEWAL_NOT_APPLIED",
  // record_marketplace_transfer_conflict (0090)
  "CONFLICT_CAPTURE_INVALID_INPUT", "CONFLICT_CAPTURE_POLICY_MISSING", "CONFLICT_CAPTURE_CAPACITY_EXCEEDED",
]);

export function safeErrorCode(code: unknown): string {
  if (code === undefined || code === null || code === "") return "NONE";
  return typeof code === "string" && STRUCTURED_CODE.test(code) ? code : "UNRECOGNIZED";
}

// Erro do supabase-js/PostgREST. A mensagem só é usada quando é P0001 E está
// em SQL_DOMAIN_TOKENS; qualquer outra mensagem (inclusive com cara de token)
// é descartada e fica só o SQLSTATE.
export function safeDbErrorCode(error: { code?: unknown; message?: unknown } | null | undefined): string {
  if (!error) return "NONE";
  if (error.code === "P0001" && typeof error.message === "string" && SQL_DOMAIN_TOKENS.has(error.message)) return error.message;
  return safeErrorCode(error.code);
}

// Códigos fixos que o próprio adapter (src/lib/asaas.ts) devolve; o resto de
// `error` é descrição do Asaas (texto externo) e nunca é registrado.
const ADAPTER_CODES = new Set(["AMBIGUOUS_CUSTOMER_MATCH", "AMBIGUOUS_PAYMENT_MATCH", "AMBIGUOUS_EXISTING_REFUND", "REFUND_ID_MISSING_IN_RESPONSE"]);

export function safeProviderErrorCode(result: { error: string; status?: number }): string {
  if (ADAPTER_CODES.has(result.error)) return result.error;
  const s = result.status;
  return Number.isInteger(s) && (s as number) >= 100 && (s as number) <= 599 ? `PROVIDER_HTTP_${s}` : "PROVIDER_ERROR";
}

// Constantes fixas que os callers registram diretamente.
const FIXED_LOG_CODES = new Set(["NONE", "UNRECOGNIZED", "UNEXPECTED_RESULT", "PROVIDER_ERROR"]);
const PROVIDER_HTTP = /^PROVIDER_HTTP_[1-5]\d\d$/;

// Rede de segurança de logSecurityEvent para o campo errorCode: só códigos
// conhecidos; o resto vira "UNRECOGNIZED" no caller (security-log.ts).
export function isSafeLogCode(value: unknown): boolean {
  return typeof value === "string" && (
    STRUCTURED_CODE.test(value) || SQL_DOMAIN_TOKENS.has(value) || ADAPTER_CODES.has(value)
    || FIXED_LOG_CODES.has(value) || PROVIDER_HTTP.test(value)
  );
}
