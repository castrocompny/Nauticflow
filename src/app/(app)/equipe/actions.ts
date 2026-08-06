"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { requireActiveSubscription } from "@/lib/subscription";

export async function inviteTeamMember(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { error: "Só o administrador da empresa pode convidar novos usuários." };
  }

  const subscriptionBlocked = await requireActiveSubscription(profile.company_id);
  if (subscriptionBlocked) return { error: subscriptionBlocked };

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  if (!name || !email) return { error: "Preencha nome e e-mail." };

  const supabase = createClient();

  const [{ count: usedCount }, { data: sub }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id),
    supabase
      .from("subscriptions")
      .select("plans(max_users)")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const maxUsers = (sub as any)?.plans?.max_users as number | null | undefined;
  if (maxUsers != null && (usedCount ?? 0) >= maxUsers) {
    return {
      error: `Seu plano permite até ${maxUsers} usuário(s). Faça upgrade do plano em Planos para convidar mais gente.`,
    };
  }

  const origin = headers().get("origin") ?? "http://localhost:3000";
  const admin = createAdminClient();

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      name,
      role: "staff",
      invited_to_company_id: profile.company_id,
    },
    redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
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
