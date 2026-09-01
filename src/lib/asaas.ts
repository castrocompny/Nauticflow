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
