import { createClient } from "@/lib/supabase/server";

// busca status da assinatura + suspensao manual + limites do plano numa so leva de
// queries (paralelas). Usado direto por Server Actions que precisam checar "pode
// criar coisa nova" — evita rodar isso tudo em sequencia toda vez.
export async function getSubscriptionStatus(companyId: string): Promise<{
  blocked: string | null;
  maxVessels: number | null;
  maxUsers: number | null;
}> {
  const supabase = createClient();
  const [{ data }, { data: company }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("paid_until, plans(max_vessels, max_users)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("companies").select("suspended_at, suspended_reason").eq("id", companyId).maybeSingle(),
  ]);

  const paidUntil = data?.paid_until ? new Date(data.paid_until) : null;
  let blocked: string | null = null;
  if (company?.suspended_at) {
    blocked = `Conta suspensa pelo administrador.${company.suspended_reason ? ` Motivo: ${company.suspended_reason}` : ""} Entre em contato com o suporte.`;
  } else if (!paidUntil || paidUntil < new Date()) {
    blocked = "Assinatura vencida. Regularize o pagamento em Configurações para continuar cadastrando.";
  }

  const plan = (data as any)?.plans;
  return {
    blocked,
    maxVessels: plan?.max_vessels ?? null,
    maxUsers: plan?.max_users ?? null,
  };
}

// usado pelas Server Actions de "criar X" pra bloquear cadastros novos quando a
// assinatura da empresa esta vencida. Edicao, exclusao e visualizacao continuam
// liberadas — so criar coisa nova para.
export async function requireActiveSubscription(companyId: string): Promise<string | null> {
  return (await getSubscriptionStatus(companyId)).blocked;
}
