"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { findOrCreateCustomer, createSubscription, getFirstInvoiceUrl, cancelSubscription } from "@/lib/asaas";
import { fmtDate } from "@/lib/format";

export async function startAsaasCheckout(planCode: string, billingCycle: string = "mensal") {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  // só aceita ciclos válidos; qualquer outra coisa vira mensal
  const cycle = billingCycle === "anual" ? "anual" : "mensal";

  const supabase = createClient();

  const [{ data: company }, { data: plan }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, cnpj, phone, asaas_customer_id")
      .eq("id", profile.company_id)
      .maybeSingle(),
    supabase
      .from("plans")
      .select("code, name, price_cents, price_cents_yearly")
      .eq("code", planCode)
      .maybeSingle(),
  ]);
  if (!company) return { error: "Empresa não encontrada." };
  if (!company.cnpj) {
    return {
      error: "Preencha o CNPJ ou CPF da empresa em Configurações antes de assinar um plano.",
    };
  }
  if (!plan) return { error: "Plano inválido." };

  // preço e ciclo do Asaas conforme mensal/anual (anual = 10x o mensal, "2 meses grátis")
  const valueCents =
    cycle === "anual" ? (plan.price_cents_yearly ?? plan.price_cents * 10) : plan.price_cents;

  const customerRes = await findOrCreateCustomer({
    existingCustomerId: company.asaas_customer_id,
    name: company.name,
    cpfCnpj: company.cnpj,
    // e-mail de login do administrador -- a empresa não tem mais um e-mail próprio
    // separado, já que na prática é sempre o mesmo usado pra entrar no sistema
    email: profile.email,
    phone: company.phone,
    companyId: company.id,
  });
  if (!customerRes.ok) return { error: customerRes.error };

  const subRes = await createSubscription({
    customerId: customerRes.data,
    valueCents,
    planName: plan.name,
    companyId: company.id,
    cycle: cycle === "anual" ? "YEARLY" : "MONTHLY",
  });
  if (!subRes.ok) return { error: subRes.error };

  const { error: linkError } = await supabase.rpc("link_asaas_subscription", {
    p_customer_id: customerRes.data,
    p_subscription_id: subRes.data.id,
    p_plan_code: plan.code,
    p_billing_cycle: cycle,
  });
  if (linkError) return { error: "Cobrança criada, mas houve um erro ao vincular: " + linkError.message };

  const invoiceRes = await getFirstInvoiceUrl(subRes.data.id);
  if (!invoiceRes.ok) return { error: invoiceRes.error };

  redirect(invoiceRes.data);
}

// Cancela a assinatura no Asaas -- pra quem não quer mais usar o NauticFlow e não quer
// continuar sendo cobrado. Não apaga nada nem suspende a empresa na hora: a assinatura
// já paga continua valendo até "paid_until" (a empresa não perde o que já pagou), só não
// renova mais sozinha depois disso, porque não sobra assinatura ativa no Asaas pra gerar
// cobrança nova. Só quem administra a empresa pode cancelar -- mesma regra de quem pode
// excluir a conta (ver configuracoes/actions.ts).
export async function cancelAsaasSubscription() {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { error: "Só o administrador da empresa pode cancelar a assinatura." };
  }

  const supabase = createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, status, paid_until, asaas_subscription_id")
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) return { error: "Nenhuma assinatura encontrada." };
  if (!sub.asaas_subscription_id) return { error: "Você está no período de teste — não há cobrança recorrente pra cancelar." };
  if (sub.status === "cancelada") return { error: "Essa assinatura já está cancelada." };

  const cancelRes = await cancelSubscription(sub.asaas_subscription_id);
  if (!cancelRes.ok) return { error: cancelRes.error };

  // update via client admin (service_role): RLS só deixa super_admin escrever em
  // subscriptions (ver migration 0007), então a sessão normal do cliente não conseguiria
  const admin = createAdminClient();
  const { error } = await admin.from("subscriptions").update({ status: "cancelada" }).eq("id", sub.id);
  if (error) return { error: error.message };

  revalidatePath("/planos");
  revalidatePath("/dashboard", "layout");

  const ateQuando = sub.paid_until ? ` Você continua com acesso normal até ${fmtDate(sub.paid_until)}.` : "";
  return { ok: true, message: `Assinatura cancelada. Não haverá mais cobranças.${ateQuando}` };
}
