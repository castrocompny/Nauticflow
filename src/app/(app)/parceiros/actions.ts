"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActiveSubscription } from "@/lib/subscription";

async function companyId() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, id: null as string | null };
  const { data } = await supabase.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
  return { supabase, id: (data?.company_id as string) ?? null };
}

export async function createPartner(_prev: unknown, formData: FormData) {
  const { supabase, id } = await companyId();
  if (!id) return { error: "Sessão inválida ou usuário sem empresa." };

  const subscriptionBlocked = await requireActiveSubscription(id);
  if (subscriptionBlocked) return { error: subscriptionBlocked };

  const { error } = await supabase.from("partners").insert({
    company_id: id,
    name: String(formData.get("name")),
    type: String(formData.get("type")),
    contact: String(formData.get("contact") || "") || null,
    commission_rate: Number(String(formData.get("commission_rate") || "0").replace(",", ".")) || 0,
  });
  if (error) return { error: error.message };
  revalidatePath("/parceiros");
  return { error: "" };
}

export async function updatePartner(_prev: unknown, formData: FormData) {
  const { supabase, id } = await companyId();
  if (!id) return { error: "Sessão inválida ou usuário sem empresa." };
  const pid = String(formData.get("id"));
  const { error } = await supabase
    .from("partners")
    .update({
      name: String(formData.get("name")),
      type: String(formData.get("type")),
      contact: String(formData.get("contact") || "") || null,
      commission_rate: Number(String(formData.get("commission_rate") || "0").replace(",", ".")) || 0,
    })
    .eq("id", pid)
    .eq("company_id", id);
  if (error) return { error: error.message };
  revalidatePath("/parceiros");
  revalidatePath(`/parceiros/${pid}`);
  return { error: "" };
}

export async function cancelPartnership(pid: string) {
  const { supabase, id } = await companyId();
  if (!id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };
  const { error } = await supabase.from("partners").update({ active: false }).eq("id", pid).eq("company_id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/parceiros");
  return { ok: true, message: "Parceria cancelada." };
}

export async function reactivatePartner(pid: string) {
  const { supabase, id } = await companyId();
  if (!id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };
  const { error } = await supabase.from("partners").update({ active: true }).eq("id", pid).eq("company_id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/parceiros");
  return { ok: true, message: "Parceria reativada." };
}

export async function deletePartner(formData: FormData) {
  const { supabase, id } = await companyId();
  if (!id) return { error: "Sessão inválida ou usuário sem empresa." };
  const pid = String(formData.get("id"));

  const { count } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("partner_id", pid)
    .eq("company_id", id);
  if (count && count > 0) {
    return { error: "Este parceiro possui reservas vinculadas. Não é possível excluir." };
  }

  const { error } = await supabase.from("partners").delete().eq("id", pid).eq("company_id", id);
  if (error) return { error: "Não é possível excluir porque existem registros vinculados." };
  revalidatePath("/parceiros");
  return { error: "" };
}
