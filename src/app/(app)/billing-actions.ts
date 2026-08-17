"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { findOrCreateCustomer, createSubscription, getFirstInvoiceUrl } from "@/lib/asaas";

export async function startAsaasCheckout(planCode: string) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const supabase = createClient();

  const [{ data: company }, { data: plan }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, cnpj, email, phone, asaas_customer_id")
      .eq("id", profile.company_id)
      .maybeSingle(),
    supabase.from("plans").select("code, name, price_cents").eq("code", planCode).maybeSingle(),
  ]);
  if (!company) return { error: "Empresa não encontrada." };
  if (!company.cnpj) {
    return {
      error: "Preencha o CNPJ ou CPF da empresa em Configurações antes de assinar um plano.",
    };
  }
  if (!plan) return { error: "Plano inválido." };

  const customerRes = await findOrCreateCustomer({
    existingCustomerId: company.asaas_customer_id,
    name: company.name,
    cpfCnpj: company.cnpj,
    email: company.email,
    phone: company.phone,
    companyId: company.id,
  });
  if (!customerRes.ok) return { error: customerRes.error };

  const subRes = await createSubscription({
    customerId: customerRes.data,
    valueCents: plan.price_cents,
    planName: plan.name,
    companyId: company.id,
  });
  if (!subRes.ok) return { error: subRes.error };

  const { error: linkError } = await supabase.rpc("link_asaas_subscription", {
    p_customer_id: customerRes.data,
    p_subscription_id: subRes.data.id,
    p_plan_code: plan.code,
  });
  if (linkError) return { error: "Cobrança criada, mas houve um erro ao vincular: " + linkError.message };

  const invoiceRes = await getFirstInvoiceUrl(subRes.data.id);
  if (!invoiceRes.ok) return { error: invoiceRes.error };

  redirect(invoiceRes.data);
}
