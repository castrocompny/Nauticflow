"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { getSubscriptionStatus } from "@/lib/subscription";
import { SITE_URL } from "@/lib/site-url";
import { buildInviteEmailHtml } from "@/lib/team-invite-email";

// Monta e manda o e-mail de convite pela nossa propria infraestrutura (Resend, via
// Edge Function send-email) em vez de deixar o Supabase Auth mandar o dele.
//
// Motivo: o e-mail de convite padrao do Supabase usa {{ .ConfirmationURL }}, que
// aponta pro endpoint hospedado do proprio Supabase (/auth/v1/verify). Esse endpoint
// verifica o token no SERVIDOR DELE e redireciona pro nosso site com a sessao
// grudada no fragmento da URL (#access_token=...) -- fragmento nunca chega no
// servidor (o navegador nao manda), entao nosso /auth/callback nunca ve a sessao e a
// pessoa cai em "link invalido ou expirado" mesmo com o link genuino e recem-criado.
// Customizar o template de e-mail no painel do Supabase pra usar {{ .TokenHash }}
// direto resolveria em teoria, mas na pratica a mudanca nao "pegava" de forma
// confiavel (testado e confirmado nao funcionar em produção).
//
// generateLink() cria o usuario/token igual o inviteUserByEmail, mas NAO manda
// e-mail nenhum -- so devolve o hashed_token pra gente montar o link do jeito que
// quiser, direto pro nosso /auth/callback (mesmo mecanismo que ja funciona pro
// "Esqueci minha senha", via verifyOtp).
async function sendInviteEmail(
  admin: ReturnType<typeof createAdminClient>,
  params: { email: string; name: string; companyId: string; companyName: string }
): Promise<{ error: string } | { error: "" }> {
  const { email, name, companyId, companyName } = params;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { name, role: "staff", invited_to_company_id: companyId },
      redirectTo: `${SITE_URL}/auth/callback?next=/redefinir-senha`,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already been registered")) {
      return { error: "already_registered" };
    }
    console.error("sendInviteEmail generateLink:", error);
    return { error: "Não foi possível gerar o convite. Tente novamente." };
  }

  const link = `${SITE_URL}/auth/callback?token_hash=${data.properties.hashed_token}&type=invite&next=/redefinir-senha`;
  const html = buildInviteEmailHtml({ inviteeName: name, companyName, link });

  const { data: sendResult, error: sendErr } = await admin.functions.invoke("send-email", {
    headers: { "x-mailer-secret": process.env.MAILER_SECRET ?? "" },
    body: { to: email, subject: "Você foi convidado para o NauticFlow", html },
  });

  if (sendErr || (sendResult as { sent?: boolean } | null)?.sent === false) {
    return { error: "Convite criado, mas não foi possível enviar o e-mail. Tente reenviar em instantes." };
  }

  return { error: "" };
}

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

  const companyName = profile.companies?.name ?? "sua empresa";
  const result = await sendInviteEmail(admin, { email, name, companyId: profile.company_id, companyName });
  if (result.error === "already_registered") return { error: "Já existe uma conta com esse e-mail." };
  if (result.error) return { error: result.error };

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
  const companyName = profile.companies?.name ?? "sua empresa";
  const result = await sendInviteEmail(admin, {
    email: target.email,
    name: target.name ?? target.email,
    companyId: target.company_id,
    companyName,
  });

  if (result.error === "already_registered") {
    return { ok: false, message: `${target.name ?? "Esse usuário"} já confirmou o acesso — não precisa reenviar.` };
  }
  if (result.error) return { ok: false, message: result.error };

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
  if (error) {
    console.error("removeTeamMember:", error);
    return { ok: false, message: "Não foi possível remover o usuário. Tente novamente." };
  }

  revalidatePath("/equipe");
  return { ok: true, message: `${target.name ?? "Usuário"} removido.` };
}
