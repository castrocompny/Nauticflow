// Cliente HTTP mínimo pra API do Asaas. So roda no servidor (a chave nunca chega no navegador).

const BASE_URL = process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3";

type AsaasResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function asaasFetch<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<AsaasResult<T>> {
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
    return { ok: false, error: message };
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
}): Promise<AsaasResult<AsaasSubscription>> {
  return asaasFetch<AsaasSubscription>("/subscriptions", "POST", {
    customer: params.customerId,
    billingType: "UNDEFINED", // deixa o pagador escolher Pix, boleto ou cartão na fatura
    value: params.valueCents / 100,
    nextDueDate: new Date().toISOString().slice(0, 10),
    cycle: "MONTHLY",
    description: `NauticFlow — Plano ${params.planName}`,
    externalReference: params.companyId,
  });
}

type AsaasPaymentsList = { data: { invoiceUrl: string }[] };

export async function getFirstInvoiceUrl(subscriptionId: string): Promise<AsaasResult<string>> {
  const res = await asaasFetch<AsaasPaymentsList>(`/subscriptions/${subscriptionId}/payments`, "GET");
  if (!res.ok) return res;
  const url = res.data.data?.[0]?.invoiceUrl;
  if (!url) return { ok: false, error: "Cobrança criada, mas sem link de pagamento disponível ainda." };
  return { ok: true, data: url };
}
