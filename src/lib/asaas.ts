// Cliente HTTP mínimo pra API do Asaas. So roda no servidor (a chave nunca chega no navegador).

const BASE_URL = process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3";

type AsaasResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

async function asaasFetch<T>(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<AsaasResult<T>> {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return { ok: false, error: "Integração com Asaas ainda não configurada." };

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.errors?.[0]?.description ?? `Erro ${res.status} na API do Asaas.`;
    return { ok: false, error: message, status: res.status };
  }
  return { ok: true, data: json as T };
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

type AsaasCustomer = { id: string };

export async function findOrCreateCustomer(params: {
  existingCustomerId: string | null;
  name: string;
  cpfCnpj: string;
  email?: string | null;
  phone?: string | null;
  companyId: string;
}): Promise<AsaasResult<string>> {
  if (params.existingCustomerId) return { ok: true, data: params.existingCustomerId };

  const created = await asaasFetch<AsaasCustomer>("/customers", "POST", {
    name: params.name,
    cpfCnpj: onlyDigits(params.cpfCnpj),
    email: params.email || undefined,
    phone: params.phone || undefined,
    externalReference: params.companyId,
  });
  if (!created.ok) return created;
  return { ok: true, data: created.data.id };
}

type AsaasSubscription = { id: string };

export async function createSubscription(params: {
  customerId: string;
  valueCents: number;
  planName: string;
  companyId: string;
  cycle?: "MONTHLY" | "YEARLY"; // ciclo de cobrança recorrente no Asaas
}): Promise<AsaasResult<AsaasSubscription>> {
  return asaasFetch<AsaasSubscription>("/subscriptions", "POST", {
    customer: params.customerId,
    billingType: "UNDEFINED", // deixa o pagador escolher Pix, boleto ou cartão na fatura
    value: params.valueCents / 100,
    nextDueDate: new Date().toISOString().slice(0, 10),
    cycle: params.cycle ?? "MONTHLY",
    description: `NauticFlow — Plano ${params.planName}`,
    externalReference: params.companyId,
  });
}

// Cancela a assinatura no Asaas -- para as cobranças futuras (nenhuma fatura nova é
// gerada). Faturas já emitidas e não pagas continuam existindo lá, mas não vencem mais
// nada novo. Idempotente: cancelar de novo uma assinatura já cancelada/inexistente no
// Asaas retorna erro 404, tratado como sucesso (o efeito desejado -- "não cobra mais" --
// já está garantido).
export async function cancelSubscription(subscriptionId: string): Promise<AsaasResult<true>> {
  const res = await asaasFetch<{ deleted: boolean }>(`/subscriptions/${subscriptionId}`, "DELETE");
  if (!res.ok && res.status !== 404) return res;
  return { ok: true, data: true };
}

type AsaasPaymentsList = { data: { invoiceUrl: string }[] };

export async function getFirstInvoiceUrl(subscriptionId: string): Promise<AsaasResult<string>> {
  const res = await asaasFetch<AsaasPaymentsList>(`/subscriptions/${subscriptionId}/payments`, "GET");
  if (!res.ok) return res;
  const url = res.data.data?.[0]?.invoiceUrl;
  if (!url) return { ok: false, error: "Cobrança criada, mas sem link de pagamento disponível ainda." };
  return { ok: true, data: url };
}

// ============================================================================
// FASE 4A -- fundação de pagamento do MARKETPLACE (turista comprando um
// passeio via ToursFlow), diferente de tudo acima (que é a assinatura SaaS
// do operador). createMarketplacePayment() existe só como CONTRATO/adapter
// pronto pra Fase 4B -- NENHUM caminho de produção a chama ainda (a rota
// POST /api/marketplace/bookings/[id]/payment para antes disso, ver
// src/app/api/marketplace/bookings/[id]/payment/route.ts). Só é exercitada
// em teste, com fetch mockado -- nunca bate na rede de verdade nesta fase.
//
// Guard interno redundante de propósito (mesmo espírito de
// runPhotoModeration checar o modo de moderação de novo por dentro, migration
// 0044): mesmo que um código futuro esqueça de checar
// isMarketplacePaymentsEnabled() antes de chamar esta função, ela mesma
// nunca deixa uma requisição real sair enquanto a flag estiver desligada.
// ============================================================================
import { isMarketplacePaymentsEnabled, type SupportedPaymentMethod } from "./marketplace-api";

type AsaasMarketplacePayment = { id: string; status: string };

export async function createMarketplacePayment(params: {
  paymentId: string; // id interno de public.payments -- vira o externalReference (nunca o bookingId cru)
  customerId: string;
  amountCents: number;
  method: SupportedPaymentMethod;
  walletId: string | null; // split -- Fase 4B/futura, null nesta fase (nenhuma company tem wallet configurada ainda)
}): Promise<AsaasResult<AsaasMarketplacePayment>> {
  if (!isMarketplacePaymentsEnabled()) {
    return { ok: false, error: "Pagamento de marketplace ainda não está habilitado." };
  }
  const billingType = params.method === "pix" ? "PIX" : undefined;
  if (!billingType) return { ok: false, error: "Método de pagamento não suportado." };

  return asaasFetch<AsaasMarketplacePayment>("/payments", "POST", {
    customer: params.customerId,
    billingType,
    value: params.amountCents / 100,
    dueDate: new Date().toISOString().slice(0, 10),
    externalReference: params.paymentId,
    // split: só incluído quando existir wallet configurada (Fase 4B) -- Split
    // em si (percentual/regra) continua NÃO IMPLEMENTADO, ver auditoria.
    split: params.walletId ? [{ walletId: params.walletId }] : undefined,
  });
}

// ============================================================================
// SAQUE DO OPERADOR -- transferência Pix (docs/adr/0005-marketplace-
// withdrawal-and-pix-payout.md). Adapter pronto, NENHUM caminho de produção
// chama isto com MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED=false (default) --
// mesmo espírito de isMarketplacePaymentsEnabled(). Guard interno redundante
// (mesmo motivo de createMarketplacePayment): mesmo que o caller esqueça de
// checar a flag antes, esta função nunca deixa uma chamada de rede real sair
// enquanto ela estiver desligada.
//
// ATENÇÃO -- formato do payload (`/transfers`, `pixAddressKey`/
// `pixAddressKeyType`) e os nomes exatos de evento de webhook usados em
// src/app/api/webhooks/asaas/route.ts refletem o entendimento geral da API
// de Transferências do Asaas, mas NÃO foram confirmados contra a
// documentação oficial ao vivo nesta sessão (sem acesso à rede/docs externos
// aqui) -- precisam de validação contra a doc real do Asaas ANTES de
// qualquer chamada real, mesmo em sandbox. Registrado explicitamente como
// pendência, não uma afirmação de fato verificado.
// ============================================================================
import { isValidCpfChecksum, isValidCnpjChecksum, type PixKeyType } from "./payout-accounts";

export function isMarketplaceWithdrawalPayoutEnabled(): boolean {
  return process.env.MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED === "true";
}

// Modo mock/sandbox CONTROLADO desta fase -- quando true, createMarketplacePixTransfer()
// nunca faz nenhuma chamada de rede, simula uma transferência bem-sucedida
// imediatamente (providerTransferId sintético, sem custo/risco nenhum).
// Pensado só pra testar o fluxo de ponta a ponta localmente -- nunca deve
// estar true em produção (documentado no .env.example quando existir).
export function isMarketplaceWithdrawalMockModeEnabled(): boolean {
  return process.env.MARKETPLACE_WITHDRAWAL_MOCK_MODE === "true";
}

function pixKeyTypeToAsaasFormat(type: PixKeyType): string {
  // Asaas usa CPF/CNPJ/EMAIL/PHONE/EVP (maiúsculas) pro campo pixAddressKeyType
  // -- mapeamento direto dos 5 tipos já suportados (src/lib/payout-accounts.ts).
  // PENDÊNCIA: o formato exato esperado por PHONE (com/sem +55, com/sem DDI)
  // não foi confirmado contra a documentação oficial nesta sessão -- por ora
  // enviamos os mesmos dígitos puros (DDD+número) já normalizados em
  // src/lib/payout-accounts.ts, sem nenhuma transformação adicional (nunca
  // alterar silenciosamente uma chave, EVP incluso -- pedido explícito da
  // revisão). Precisa de validação real antes de qualquer saque de verdade.
  const map: Record<PixKeyType, string> = { cpf: "CPF", cnpj: "CNPJ", email: "EMAIL", telefone: "PHONE", evp: "EVP" };
  return map[type];
}

// Conversão SEGURA de centavos (nosso domínio interno, sempre inteiro) pra
// reais (o que o Asaas espera no campo `value`) -- só acontece aqui, na
// BORDA da integração, nunca usada em nenhum cálculo financeiro interno
// (que continuam inteiramente em centavos inteiros, nunca float). `toFixed`
// evita o clássico problema de imprecisão de ponto flutuante (ex:
// 0.1+0.2 !== 0.3) se alguma divisão gerar uma dízima binária.
export function centsToReaisForProvider(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

type AsaasPixTransfer = { id: string; status: string };
export type MarketplacePixTransferResult = { providerTransferId: string; status: "processing" | "completed" | "failed" };

export async function createMarketplacePixTransfer(params: {
  withdrawalId: string; // vira o externalReference -- NUNCA a chave Pix, nunca o companyId direto
  amountCents: number;
  pixKeyType: PixKeyType;
  pixKeyNormalized: string;
}): Promise<AsaasResult<MarketplacePixTransferResult>> {
  if (!isMarketplaceWithdrawalPayoutEnabled()) {
    return { ok: false, error: "Saque do marketplace ainda não está habilitado." };
  }

  // defesa em profundidade -- nunca envia uma chave malformada pro provider,
  // mesmo que algo upstream tenha pulado a validação (mesmo espírito de toda
  // RPC financeira deste projeto revalidando por conta própria).
  if (params.pixKeyType === "cpf" && !isValidCpfChecksum(params.pixKeyNormalized)) {
    return { ok: false, error: "Chave Pix (CPF) inválida." };
  }
  if (params.pixKeyType === "cnpj" && !isValidCnpjChecksum(params.pixKeyNormalized)) {
    return { ok: false, error: "Chave Pix (CNPJ) inválida." };
  }

  if (isMarketplaceWithdrawalMockModeEnabled()) {
    // simulação determinística -- NENHUMA chamada de rede, nenhum dinheiro
    // real, nenhuma dependência de ASAAS_API_KEY.
    return { ok: true, data: { providerTransferId: `mock-transfer-${params.withdrawalId}`, status: "completed" } };
  }

  return asaasFetch<AsaasPixTransfer>("/transfers", "POST", {
    value: centsToReaisForProvider(params.amountCents),
    pixAddressKey: params.pixKeyNormalized,
    pixAddressKeyType: pixKeyTypeToAsaasFormat(params.pixKeyType),
    // externalReference é SEMPRE o id interno do saque (marketplace_
    // withdrawals.id) -- nunca company_id, chave Pix, CPF/CNPJ, e-mail ou
    // telefone, conforme contrato oficial confirmado nesta revisão.
    externalReference: params.withdrawalId,
    operationType: "PIX",
  }).then((res) => (res.ok ? { ok: true, data: { providerTransferId: res.data.id, status: "processing" as const } } : res));
}

// ============================================================================
// PIX DO CLIENTE -- cobrança real ao turista comprando um passeio via
// ToursFlow (docs/adr/0007-marketplace-pix-payment-settlement.md). NUNCA
// confundir com createSubscription/findOrCreateCustomer acima (aquilo é a
// mensalidade SaaS do OPERADOR -- este bloco é o turista pagando o
// passeio). Guard duplo, mesmo espírito de createMarketplacePixTransfer:
// isMarketplacePaymentsEnabled() (flag mestra) + MARKETPLACE_PAYMENTS_MODE
// (mock/sandbox/production, nunca implícito) -- nenhuma chamada de rede
// real acontece sem os dois.
// ============================================================================
export type MarketplacePaymentsMode = "mock" | "sandbox" | "production";

// Não confundir com isMarketplaceWithdrawalMockModeEnabled (saque) -- este é
// o modo do fluxo de COBRANÇA. Ausente/valor desconhecido = null = fail
// closed (nunca assume um modo default, muito menos "production").
export function getMarketplacePaymentsMode(): MarketplacePaymentsMode | null {
  const raw = process.env.MARKETPLACE_PAYMENTS_MODE;
  if (raw === "mock" || raw === "sandbox" || raw === "production") return raw;
  return null;
}

// Cross-validação entre MARKETPLACE_PAYMENTS_MODE e ASAAS_API_URL -- pedido
// explícito da revisão ("nenhum código pode usar produção por acidente").
// mode='production' com uma API_URL de sandbox (ou vice-versa) é uma
// configuração inconsistente -- recusada, nunca corrigida silenciosamente
// escolhendo um dos dois.
function validateModeMatchesBaseUrl(mode: MarketplacePaymentsMode): string | null {
  const looksLikeSandbox = BASE_URL.includes("sandbox");
  if (mode === "production" && looksLikeSandbox) {
    return "MARKETPLACE_PAYMENTS_MODE=production mas ASAAS_API_URL ainda aponta pro sandbox -- configuração inconsistente, recusado.";
  }
  if (mode === "sandbox" && !looksLikeSandbox) {
    return "MARKETPLACE_PAYMENTS_MODE=sandbox mas ASAAS_API_URL não aponta pro sandbox -- configuração inconsistente, recusado.";
  }
  return null;
}

function guardMarketplacePixCall(): { mode: MarketplacePaymentsMode } | { error: string } {
  if (!isMarketplacePaymentsEnabled()) return { error: "Pagamento de marketplace ainda não está habilitado." };
  const mode = getMarketplacePaymentsMode();
  if (!mode) return { error: "MARKETPLACE_PAYMENTS_MODE não configurado -- recusado (fail closed, nunca assume um modo default)." };
  if (mode !== "mock") {
    const mismatch = validateModeMatchesBaseUrl(mode);
    if (mismatch) return { error: mismatch };
  }
  return { mode };
}

type AsaasCustomerSearchResult = { data: { id: string }[]; totalCount: number };

export type MarketplaceCustomerResult = { customerId: string };

// 1) reutiliza se já persistido; 2) senão, procura por externalReference
// (reconciliação -- cobre o caso de uma tentativa anterior ter criado o
// customer no Asaas mas caído antes de persistirmos o id localmente); 3) só
// então cria. Nunca cria um segundo customer pra quem já tem um -- retry
// seguro em qualquer ponto de falha.
export async function findOrCreateMarketplaceAsaasCustomer(params: {
  existingCustomerId: string | null;
  clientId: string; // vira o externalReference -- id interno, não sensível
  name: string;
  cpfCnpj: string; // já validado (checksum) antes de chegar aqui -- ver create_marketplace_payment_attempt, 0059
  email?: string | null;
  phone?: string | null;
}): Promise<AsaasResult<MarketplaceCustomerResult>> {
  const guard = guardMarketplacePixCall();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (params.existingCustomerId) return { ok: true, data: { customerId: params.existingCustomerId } };

  if (guard.mode === "mock") {
    return { ok: true, data: { customerId: `mock-customer-${params.clientId}` } };
  }

  const search = await asaasFetch<AsaasCustomerSearchResult>(`/customers?externalReference=${encodeURIComponent(params.clientId)}`, "GET");
  if (!search.ok) return search;

  if (search.data.totalCount === 1) {
    return { ok: true, data: { customerId: search.data.data[0].id } };
  }
  if (search.data.totalCount > 1) {
    // situação ambígua -- mais de um customer com a mesma externalReference
    // (não deveria acontecer se este fluxo sempre passar por aqui, mas
    // nunca adivinha qual é "o certo"). Fail closed, precisa de revisão
    // manual.
    return { ok: false, error: "AMBIGUOUS_CUSTOMER_MATCH" };
  }

  const created = await asaasFetch<{ id: string }>("/customers", "POST", {
    name: params.name,
    cpfCnpj: onlyDigits(params.cpfCnpj),
    email: params.email || undefined,
    mobilePhone: params.phone || undefined,
    externalReference: params.clientId,
  });
  if (!created.ok) return created;
  return { ok: true, data: { customerId: created.data.id } };
}

type AsaasPixPayment = { id: string; status: string };
type AsaasPaymentSearchResult = { data: AsaasPixPayment[]; totalCount: number };

export type MarketplacePixChargeResult = { providerPaymentId: string; status: string };

// Mesma estratégia de reconciliação de findOrCreateMarketplaceAsaasCustomer
// -- se um POST /payments anterior teve a conexão caída antes de recebermos
// a resposta, um retry NUNCA cria uma segunda cobrança: procura primeiro
// por externalReference (= payments.id interno, nunca a chave Pix/CPF/
// e-mail/telefone/company_id).
export async function createOrReconcileMarketplacePixCharge(params: {
  internalPaymentId: string;
  customerId: string;
  amountCents: number;
}): Promise<AsaasResult<MarketplacePixChargeResult>> {
  const guard = guardMarketplacePixCall();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (guard.mode === "mock") {
    return { ok: true, data: { providerPaymentId: `mock-payment-${params.internalPaymentId}`, status: "PENDING" } };
  }

  const search = await asaasFetch<AsaasPaymentSearchResult>(`/payments?externalReference=${encodeURIComponent(params.internalPaymentId)}`, "GET");
  if (!search.ok) return search;

  if (search.data.totalCount === 1) {
    return { ok: true, data: { providerPaymentId: search.data.data[0].id, status: search.data.data[0].status } };
  }
  if (search.data.totalCount > 1) {
    return { ok: false, error: "AMBIGUOUS_PAYMENT_MATCH" };
  }

  const created = await asaasFetch<AsaasPixPayment>("/payments", "POST", {
    customer: params.customerId,
    billingType: "PIX",
    value: centsToReaisForProvider(params.amountCents),
    dueDate: new Date().toISOString().slice(0, 10),
    externalReference: params.internalPaymentId,
  });
  if (!created.ok) return created;
  return { ok: true, data: { providerPaymentId: created.data.id, status: created.data.status } };
}

export type MarketplacePixQrCode = {
  encodedImage: string; // imagem do QR em base64 -- devolvida ao ToursFlow, nunca persistida no banco (sem necessidade)
  payload: string; // "copia e cola" do Pix
  expirationDate: string | null;
};

// Idempotente/seguro de chamar repetidas vezes (GET puro) -- usado tanto na
// criação quanto num retry que só precisa reexibir o QR de uma cobrança que
// já existe.
export async function getMarketplacePixQrCode(providerPaymentId: string): Promise<AsaasResult<MarketplacePixQrCode>> {
  const guard = guardMarketplacePixCall();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (guard.mode === "mock") {
    return {
      ok: true,
      data: { encodedImage: "mock-encoded-image-base64", payload: `mock-pix-payload-${providerPaymentId}`, expirationDate: null },
    };
  }

  const res = await asaasFetch<{ encodedImage: string; payload: string; expirationDate?: string }>(
    `/payments/${encodeURIComponent(providerPaymentId)}/pixQrCode`,
    "GET"
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: { encodedImage: res.data.encodedImage, payload: res.data.payload, expirationDate: res.data.expirationDate ?? null },
  };
}

// ============================================================================
// CANCELAMENTO DE COBRANÇA PENDING -- fecha o hold expirado sem pagamento.
// Contrato oficial: DELETE /v3/payments/{id}. NUNCA usado como refund --
// só remove uma cobrança que ainda não foi paga. Consulta o status atual
// ANTES de deletar (nunca deleta às cegas) -- só um status "PENDING"
// confirmado é tratado como removível nesta fase; qualquer outra coisa
// (incluindo estados que talvez fossem tecnicamente removíveis, mas cujo
// nome exato não foi confirmado contra a documentação oficial ao vivo nesta
// sessão -- mesma pendência já registrada pros eventos de transfer/pixKey
// PHONE) é tratada como NÃO removível, fail safe: nunca deleta, nunca
// marca como cancelado internamente. Se o DELETE em si falhar por
// qualquer motivo, também nunca assume cancelado -- devolve `cancelled:
// false`, deixa o estado real ser resolvido por uma tentativa futura de
// cleanup ou pelo webhook (que continua sendo a autoridade financeira
// final em qualquer cenário).
// ============================================================================

export type MarketplacePendingPaymentCancelResult = { cancelled: boolean; currentStatus?: string };

export async function cancelMarketplacePendingPayment(providerPaymentId: string): Promise<AsaasResult<MarketplacePendingPaymentCancelResult>> {
  const guard = guardMarketplacePixCall();
  if ("error" in guard) return { ok: false, error: guard.error };

  if (guard.mode === "mock") {
    return { ok: true, data: { cancelled: true } };
  }

  const statusCheck = await asaasFetch<{ status: string }>(`/payments/${encodeURIComponent(providerPaymentId)}`, "GET");
  if (!statusCheck.ok) return statusCheck;

  if (statusCheck.data.status !== "PENDING") {
    // já não está mais num estado removível -- pode já ter sido recebida
    // (ou qualquer outro estado). NUNCA deleta, NUNCA trata como refund --
    // devolve o status real pro chamador decidir (nunca decide sozinho que
    // "não é PENDING, então deve estar pago").
    return { ok: true, data: { cancelled: false, currentStatus: statusCheck.data.status } };
  }

  const deleted = await asaasFetch<{ deleted: boolean }>(`/payments/${encodeURIComponent(providerPaymentId)}`, "DELETE");
  if (!deleted.ok) {
    // qualquer erro aqui -- fail safe, nunca assume cancelado (pode ter
    // sido recebida no instante entre a consulta de status e o DELETE).
    return { ok: true, data: { cancelled: false, currentStatus: statusCheck.data.status } };
  }

  return { ok: true, data: { cancelled: true } };
}
