"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function renewSubscription(companyId: string, planCode: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sessão inválida." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") return { ok: false, message: "Sem permissão." };

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

  revalidatePath("/admin");
  return { ok: true, message: `Renovado por mais 30 dias no plano ${plan.name}.` };
}
