"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

export async function renewSubscription(companyId: string, planCode: string, cycle?: "mensal" | "anual") {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  const { data: plan } = await supabase.from("plans").select("id, name").eq("code", planCode).maybeSingle();
  if (!plan) return { ok: false, message: "Plano inválido." };

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, paid_until, billing_cycle")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return { ok: false, message: "Assinatura não encontrada pra esta empresa." };

  // ciclo escolhido no admin tem prioridade; sem escolha, mantém o ciclo que a
  // assinatura já tinha (renovação sem trocar de mensal pra anual nem vice-versa)
  const isAnual = cycle ? cycle === "anual" : sub.billing_cycle === "anual";
  const days = isAnual ? 365 : 30;
  const base = sub.paid_until && new Date(sub.paid_until) > new Date() ? new Date(sub.paid_until) : new Date();
  base.setDate(base.getDate() + days);

  const { error } = await supabase
    .from("subscriptions")
    .update({ paid_until: base.toISOString(), status: "ativa", plan_id: plan.id, billing_cycle: isAnual ? "anual" : "mensal" })
    .eq("id", sub.id);
  if (error) {
    console.error("renewSubscription:", error);
    return { ok: false, message: "Não foi possível renovar a assinatura. Tente novamente." };
  }

  await logAction(supabase, adminId, adminName, "renovar_assinatura", companyId, {
    plano: plan.name,
    ciclo: isAnual ? "anual" : "mensal",
    novo_vencimento: base.toISOString(),
  });
  revalidateAffectedCompany(companyId);
  return {
    ok: true,
    message: `Renovado por mais ${isAnual ? "1 ano" : "30 dias"} no plano ${plan.name}.`,
  };
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
  if (error) {
    console.error("changePlan:", error);
    return { ok: false, message: "Não foi possível trocar o plano. Tente novamente." };
  }

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
  if (error) {
    console.error("suspendCompany:", error);
    return { ok: false, message: "Não foi possível suspender a empresa. Tente novamente." };
  }

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
  if (error) {
    console.error("unsuspendCompany:", error);
    return { ok: false, message: "Não foi possível remover a suspensão. Tente novamente." };
  }

  await logAction(supabase, adminId, adminName, "reativar_empresa", companyId);
  revalidateAffectedCompany(companyId);
  return { ok: true, message: "Suspensão removida." };
}

// Cancelamento definitivo -- diferente de suspender (reversível), isso apaga a empresa
// e TUDO que depende dela (assinatura, embarcações, reservas, clientes, notas fiscais
// etc., via "on delete cascade" no banco) e apaga os usuários dela também. Não tem
// desfazer. Exige digitar o nome exato da empresa como segunda confirmação, além do
// aal2 já exigido por requireSuperAdmin.
export async function deleteCompanyPermanently(companyId: string, confirmName: string) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  if (!company) return { ok: false, message: "Empresa não encontrada." };
  // .trim() nos dois lados: o nome no banco pode ter espaço sobrando no fim (dado
  // de cadastro antigo), invisivel no <strong> da tela -- sem isso, o admin nunca
  // consegue confirmar porque o texto digitado (sem o espaço, que ele nao ve) nunca
  // bate com o valor cru do banco.
  if (confirmName.trim() !== company.name.trim()) {
    return { ok: false, message: `Digite "${company.name.trim()}" exatamente para confirmar.` };
  }

  // registra ANTES de apagar -- depois que a empresa some, o vínculo no audit log fica
  // nulo (on delete set null), então o nome só sobrevive dentro de "details"
  await logAction(supabase, adminId, adminName, "excluir_empresa_definitivamente", companyId, { nome: company.name });

  // precisa do client de service_role: apagar os usuários da empresa (auth.admin.deleteUser)
  // e a própria empresa exigem privilégio que a sessão normal (RLS) não tem -- mesmo padrão
  // já usado na autoexclusão de conta em configuracoes/actions.ts
  const admin = createAdminClient();
  const { data: members } = await admin.from("profiles").select("id").eq("company_id", companyId);
  for (const m of members ?? []) {
    await admin.auth.admin.deleteUser(m.id);
  }

  const { error } = await admin.from("companies").delete().eq("id", companyId);
  if (error) {
    console.error("deleteCompanyPermanently:", error);
    return { ok: false, message: "Não foi possível excluir a empresa. Tente novamente." };
  }

  revalidatePath("/admin");
  return { ok: true, message: "Empresa excluída definitivamente." };
}

export async function updateCompanyBilling(_prev: unknown, formData: FormData) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { error: auth.message };
  const { supabase, adminId, adminName } = auth;

  const companyId = String(formData.get("company_id"));
  const cnpj = String(formData.get("cnpj") || "") || null;
  const city = String(formData.get("city") || "") || null;

  const { error } = await supabase.from("companies").update({ cnpj, city }).eq("id", companyId);
  if (error) {
    console.error("updateCompanyBilling:", error);
    return { error: "Não foi possível salvar os dados. Tente novamente." };
  }

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
  if (error) {
    console.error("registerInvoice:", error);
    return { error: "Não foi possível registrar a nota fiscal. Tente novamente." };
  }

  await logAction(supabase, adminId, adminName, "registrar_nota_fiscal", companyId, { numero: number, valor_cents: Math.round(valueReais * 100) });
  revalidateAffectedCompany(companyId);
  return { error: "" };
}

// Moderação de passeios do marketplace (ToursFlow). Publicação é autônoma --
// o operador publica direto (ver publishTour em src/app/(app)/passeios/
// actions.ts), sem aprovação prévia. O que o super admin controla aqui é
// suspensão administrativa: marketplace_suspended_at (separado de
// marketplace_status de propósito -- ver migration 0044) tira o passeio da
// vitrine sem mexer na "intenção" do operador (que continua marcado como
// published). O gatilho trg_tour_suspension_guard no banco já impede o
// operador de escrever nesses 3 campos mesmo que tente direto pela API --
// esta action não é a única linha de defesa.
export async function suspendTour(tourId: string, reason: string) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  if (!reason.trim()) return { ok: false, message: "Informe o motivo da suspensão." };

  const { data: tour } = await supabase.from("tours").select("company_id, name").eq("id", tourId).maybeSingle();
  if (!tour) return { ok: false, message: "Passeio não encontrado." };

  const { error } = await supabase
    .from("tours")
    .update({
      marketplace_suspended_at: new Date().toISOString(),
      marketplace_suspended_by: adminId,
      marketplace_suspension_reason: reason.trim(),
    })
    .eq("id", tourId);
  if (error) {
    console.error("suspendTour:", error);
    return { ok: false, message: "Não foi possível suspender o passeio. Tente novamente." };
  }

  await logAction(supabase, adminId, adminName, "suspender_passeio", tour.company_id, { passeio: tour.name, motivo: reason.trim() });
  revalidatePath("/admin/passeios");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Passeio suspenso. Ele sai da vitrine imediatamente." };
}

export async function unsuspendTour(tourId: string) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase, adminId, adminName } = auth;

  const { data: tour } = await supabase.from("tours").select("company_id, name").eq("id", tourId).maybeSingle();
  if (!tour) return { ok: false, message: "Passeio não encontrado." };

  const { error } = await supabase
    .from("tours")
    .update({ marketplace_suspended_at: null, marketplace_suspended_by: null, marketplace_suspension_reason: null })
    .eq("id", tourId);
  if (error) {
    console.error("unsuspendTour:", error);
    return { ok: false, message: "Não foi possível remover a suspensão do passeio. Tente novamente." };
  }

  await logAction(supabase, adminId, adminName, "reativar_passeio", tour.company_id, { passeio: tour.name });
  revalidatePath("/admin/passeios");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Suspensão removida. O passeio volta à vitrine se o operador o mantiver publicado." };
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
  if (error) {
    console.error("deleteInvoice:", error);
    return { error: "Não foi possível excluir a nota fiscal. Tente novamente." };
  }

  await logAction(supabase, adminId, adminName, "excluir_nota_fiscal", companyId, { invoice_id: id });
  revalidateAffectedCompany(companyId);
  return { error: "" };
}
