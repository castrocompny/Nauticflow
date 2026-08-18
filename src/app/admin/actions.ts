"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdminAction as requireSuperAdmin } from "@/lib/admin-auth";

// registra a acao no log de auditoria -- nunca desfaz a acao principal se o log falhar,
// so essa entrada especifica que fica sem rastro
async function logAction(
  supabase: ReturnType<typeof createClient>,
  adminId: string,
  adminName: string,
  action: string,
  targetCompanyId: string,
  details?: Record<string, unknown>
) {
  await supabase.from("admin_audit_log").insert({
    admin_id: adminId,
    admin_name: adminName,
    action,
    target_company_id: targetCompanyId,
    details: details ?? null,
  });
}

// revalida o layout da area logada pra empresa afetada ver a mudanca na proxima
// navegacao dela (sem o "force-dynamic" global, isso nao acontece sozinho), alem
// da propria listagem e pagina de detalhe do admin
function revalidateAffectedCompany(companyId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/${companyId}`);
  revalidatePath("/dashboard", "layout");
  revalidatePath("/configuracoes");
}

export async function renewSubscription(companyId: string, planCode: string) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  const { data: plan } = await supabase.from("plans").select("id, name").eq("code", planCode).maybeSingle();
  if (!plan) return { ok: false, message: "Plano inválido." };

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, paid_until")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return { ok: false, message: "Assinatura não encontrada pra esta empresa." };

  const base = sub.paid_until && new Date(sub.paid_until) > new Date() ? new Date(sub.paid_until) : new Date();
  base.setDate(base.getDate() + 30);

  const { error } = await supabase
    .from("subscriptions")
    .update({ paid_until: base.toISOString(), status: "ativa", plan_id: plan.id })
    .eq("id", sub.id);
  if (error) return { ok: false, message: error.message };

  await logAction(supabase, adminId, adminName, "renovar_assinatura", companyId, {
    plano: plan.name,
    novo_vencimento: base.toISOString(),
  });
  revalidateAffectedCompany(companyId);
  return { ok: true, message: `Renovado por mais 30 dias no plano ${plan.name}.` };
}

// troca o plano sem mexer na data de vencimento -- pra quando so quer mudar o
// tamanho do plano contratado, sem estar renovando pagamento agora
export async function changePlan(companyId: string, planCode: string) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  const { data: plan } = await supabase.from("plans").select("id, name").eq("code", planCode).maybeSingle();
  if (!plan) return { ok: false, message: "Plano inválido." };

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return { ok: false, message: "Assinatura não encontrada pra esta empresa." };

  const { error } = await supabase.from("subscriptions").update({ plan_id: plan.id }).eq("id", sub.id);
  if (error) return { ok: false, message: error.message };

  await logAction(supabase, adminId, adminName, "trocar_plano", companyId, { plano: plan.name });
  revalidateAffectedCompany(companyId);
  return { ok: true, message: `Plano alterado para ${plan.name}.` };
}

export async function suspendCompany(companyId: string, reason: string) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  const { error } = await supabase
    .from("companies")
    .update({ suspended_at: new Date().toISOString(), suspended_reason: reason || null })
    .eq("id", companyId);
  if (error) return { ok: false, message: error.message };

  await logAction(supabase, adminId, adminName, "suspender_empresa", companyId, { motivo: reason || null });
  revalidateAffectedCompany(companyId);
  return { ok: true, message: "Empresa suspensa." };
}

export async function unsuspendCompany(companyId: string) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  const { error } = await supabase
    .from("companies")
    .update({ suspended_at: null, suspended_reason: null })
    .eq("id", companyId);
  if (error) return { ok: false, message: error.message };

  await logAction(supabase, adminId, adminName, "reativar_empresa", companyId);
  revalidateAffectedCompany(companyId);
  return { ok: true, message: "Suspensão removida." };
}

export async function updateCompanyBilling(_prev: unknown, formData: FormData) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { error: auth.message };
  const { supabase, adminId, adminName } = auth;

  const companyId = String(formData.get("company_id"));
  const cnpj = String(formData.get("cnpj") || "") || null;
  const city = String(formData.get("city") || "") || null;

  const { error } = await supabase.from("companies").update({ cnpj, city }).eq("id", companyId);
  if (error) return { error: error.message };

  await logAction(supabase, adminId, adminName, "editar_dados_empresa", companyId, { cnpj, city });
  revalidateAffectedCompany(companyId);
  return { error: "" };
}

// so registra o CONTROLE da nota -- a emissao de verdade (numero, calculo de imposto,
// XML/PDF oficial) e feita por fora, na prefeitura ou no sistema do contador. Sem isso
// nao ha como perder o controle de quais meses ja foram faturados pra cada empresa.
export async function registerInvoice(_prev: unknown, formData: FormData) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { error: auth.message };
  const { supabase, adminId, adminName } = auth;

  const companyId = String(formData.get("company_id"));
  const number = String(formData.get("number") || "") || null;
  const valueReais = Number(String(formData.get("amount") || "0").replace(",", "."));
  const pdfUrl = String(formData.get("pdf_url") || "") || null;
  const issuedAt = String(formData.get("issued_at") || "") || new Date().toISOString().slice(0, 10);
  const notes = String(formData.get("notes") || "") || null;

  const { error } = await supabase.from("invoices").insert({
    company_id: companyId,
    number,
    amount_cents: Math.round(valueReais * 100),
    pdf_url: pdfUrl,
    issued_at: issuedAt,
    notes,
    created_by: adminId,
  });
  if (error) return { error: error.message };

  await logAction(supabase, adminId, adminName, "registrar_nota_fiscal", companyId, { numero: number, valor_cents: Math.round(valueReais * 100) });
  revalidateAffectedCompany(companyId);
  return { error: "" };
}

export async function deleteInvoice(formData: FormData) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { error: auth.message };
  const { supabase, adminId, adminName } = auth;

  const id = String(formData.get("id"));

  // busca o company_id de verdade da nota em vez de confiar no campo escondido do
  // formulario -- assim o log de auditoria e o revalidatePath sempre refletem a
  // empresa certa, mesmo se o campo enviado pelo client estiver errado/adulterado
  const { data: invoice } = await supabase.from("invoices").select("company_id").eq("id", id).maybeSingle();
  if (!invoice) return { error: "Nota fiscal não encontrada." };
  const companyId = invoice.company_id as string;

  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return { error: "Erro ao excluir. " + error.message };

  await logAction(supabase, adminId, adminName, "excluir_nota_fiscal", companyId, { invoice_id: id });
  revalidateAffectedCompany(companyId);
  return { error: "" };
}
