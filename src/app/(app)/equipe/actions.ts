"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { getSubscriptionStatus } from "@/lib/subscription";
import { SITE_URL } from "@/lib/site-url";

export async function inviteTeamMember(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { error: "Só o administrador da empresa pode convidar novos usuários." };
  }

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  if (!name || !email) return { error: "Preencha nome e e-mail." };

  const supabase = createClient();

  const [{ blocked, maxUsers }, { count: usedCount }] = await Promise.all([
    getSubscriptionStatus(profile.company_id),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id),
  ]);
  if (blocked) return { error: blocked };

  if (maxUsers != null && (usedCount ?? 0) >= maxUsers) {
    return {
      error: `Seu plano permite até ${maxUsers} usuário(s). Faça upgrade do plano em Planos para convidar mais gente.`,
    };
  }

  const admin = createAdminClient();

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      name,
      role: "staff",
      invited_to_company_id: profile.company_id,
    },
    redirectTo: `${SITE_URL}/auth/callback?next=/redefinir-senha`,
  });

  if (error) {
    if (error.message.toLowerCase().includes("already been registered")) {
      return { error: "Já existe uma conta com esse e-mail." };
    }
    return { error: "Não foi possível convidar: " + error.message };
  }

  revalidatePath("/equipe");
  return { error: "", info: `Convite enviado para ${email}.` };
}

export async function removeTeamMember(memberId: string) {
  const profile = await getProfile();
  if (!profile?.company_id) return { ok: false, message: "Sessão inválida." };

  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { ok: false, message: "Só o administrador da empresa pode remover usuários." };
  }

  if (memberId === profile.id) {
    return { ok: false, message: "Você não pode remover a si mesmo." };
  }

  const supabase = createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, company_id, role, name")
    .eq("id", memberId)
    .maybeSingle();

  if (!target || target.company_id !== profile.company_id) {
    return { ok: false, message: "Usuário não encontrado nesta empresa." };
  }
  if (target.role === "company_admin" || target.role === "super_admin") {
    return { ok: false, message: "Não é possível remover outro administrador." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(memberId);
  if (error) return { ok: false, message: "Não foi possível remover: " + error.message };

  revalidatePath("/equipe");
  return { ok: true, message: `${target.name ?? "Usuário"} removido.` };
}
