import { createClient } from "@/lib/supabase/server";

// usado pelas Server Actions de "criar X" pra bloquear cadastros novos quando a
// assinatura da empresa esta vencida. Edicao, exclusao e visualizacao continuam
// liberadas — so criar coisa nova para.
export async function requireActiveSubscription(companyId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("paid_until")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paidUntil = data?.paid_until ? new Date(data.paid_until) : null;
  if (!paidUntil || paidUntil >= new Date()) return null;

  return "Assinatura vencida. Regularize o pagamento em Configurações para continuar cadastrando.";
}
