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
  const admin = createAdminClient();

  const [{ blocked, maxUsers }, { count: usedCount }, { data: existingProfile }] = await Promise.all([
    getSubscriptionStatus(profile.company_id),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id),
    // se o e-mail ja tem QUALQUER conta (de outra empresa, ou uma criada via
    // "Criar conta" e nunca confirmada), o convite do Supabase so reaproveita
    // a conta existente por baixo dos panos -- e como isso e um UPDATE em
    // auth.users, nao um INSERT, o gatilho que vincula "convidado" a empresa de
    // quem convidou nao roda de novo. A pessoa confirma a senha, mas continua
    // dona da empresa/papel que ja tinha antes, sem aparecer na Equipe de quem
    // convidou. Bloquear aqui evita esse estado quebrado e silencioso.
    // Usa o client admin (service_role) de proposito: RLS de "profiles" so deixa
    // ver colegas da MESMA empresa (migration 0013) -- com o client normal, um
    // e-mail cadastrado em OUTRA empresa (o caso real que causou o bug) passaria
    // batido pelo check.
    admin.from("profiles").select("id").eq("email", email).maybeSingle(),
  ]);
  if (blocked) return { error: blocked };

  if (maxUsers != null && (usedCount ?? 0) >= maxUsers) {
    return {
      error: `Seu plano permite até ${maxUsers} usuário(s). Faça upgrade do plano em Planos para convidar mais gente.`,
    };
  }

  if (existingProfile) {
    return { error: "Já existe uma conta cadastrada com esse e-mail no sistema." };
  }

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

export async function resendInvite(memberId: string) {
  const profile = await getProfile();
  if (!profile?.company_id) return { ok: false, message: "Sessão inválida." };

  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return { ok: false, message: "Só o administrador da empresa pode reenviar convites." };
  }

  const supabase = createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, company_id, role, name, email")
    .eq("id", memberId)
    .maybeSingle();

  if (!target || target.company_id !== profile.company_id) {
    return { ok: false, message: "Usuário não encontrado nesta empresa." };
  }
  if (!target.email) {
    return { ok: false, message: "Esse usuário não tem e-mail cadastrado." };
  }
  if (target.role === "company_admin" || target.role === "super_admin") {
    return { ok: false, message: "Não é possível reenviar convite pra um administrador." };
  }

  const admin = createAdminClient();

  // reenviar pro mesmo e-mail de um convite ainda nao confirmado gera um link novo
  // (o antigo, de uso unico, vira invalido) -- e o motivo mais comum do link "expirado"
  // reportado por quem recebe: o anterior ja tinha sido clicado/gasto ou passou de 1h.
  const { error } = await admin.auth.admin.inviteUserByEmail(target.email, {
    data: {
      name: target.name,
      role: "staff",
      invited_to_company_id: target.company_id,
    },
    redirectTo: `${SITE_URL}/auth/callback?next=/redefinir-senha`,
  });

  if (error) {
    if (error.message.toLowerCase().includes("already been registered")) {
      return { ok: false, message: `${target.name ?? "Esse usuário"} já confirmou o acesso — não precisa reenviar.` };
    }
    return { ok: false, message: "Não foi possível reenviar: " + error.message };
  }

  return { ok: true, message: `Convite reenviado para ${target.email}.` };
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
