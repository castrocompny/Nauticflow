"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";

export async function updateSettings(_prev: unknown, formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão inválida.", ok: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.company_id) return { error: "Usuário sem empresa vinculada.", ok: false };

  // atualiza dados da empresa (RLS permite a propria empresa)
  const { error: cErr } = await supabase
    .from("companies")
    .update({
      name: String(formData.get("company_name")),
      cnpj: String(formData.get("cnpj") || "") || null,
      city: String(formData.get("city") || "") || null,
      phone: String(formData.get("phone") || "") || null,
      email: String(formData.get("company_email") || "") || null,
    })
    .eq("id", profile.company_id);
  if (cErr) return { error: cErr.message, ok: false };

  // atualiza o nome do administrador (RLS permite o proprio perfil)
  const { error: pErr } = await supabase
    .from("profiles")
    .update({ name: String(formData.get("admin_name")) })
    .eq("id", user.id);
  if (pErr) return { error: pErr.message, ok: false };

  revalidatePath("/configuracoes");
  revalidatePath("/dashboard");
  return { error: "", ok: true };
}

// Exclusao de conta. company_admin apaga a empresa inteira (todo mundo do time
// + todos os dados, via cascade no banco); staff/super_admin apaga so a propria
// conta. Usa o client admin (service_role) porque deletar outros usuarios exige
// privilegio que a sessao normal nao tem.
export async function deleteMyAccount(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile) return { error: "Sessão inválida." };

  const confirmText = String(formData.get("confirm") || "").trim();
  const admin = createAdminClient();

  if (profile.role === "company_admin") {
    const companyName = profile.companies?.name ?? "";
    if (!companyName || confirmText !== companyName) {
      return { error: `Digite "${companyName}" exatamente para confirmar.` };
    }
    if (!profile.company_id) return { error: "Empresa não encontrada." };

    const { data: members } = await admin
      .from("profiles")
      .select("id")
      .eq("company_id", profile.company_id);

    // apaga o proprio admin por ultimo -- os outros membros primeiro
    const ids = (members ?? []).map((m) => m.id).filter((id) => id !== profile.id);
    for (const id of ids) {
      await admin.auth.admin.deleteUser(id);
    }

    // apaga a empresa: cascade no banco cuida de embarcacoes, reservas,
    // clientes, notas fiscais etc. (profiles.company_id é on delete set null,
    // por isso os perfis precisam ser removidos via auth.admin acima)
    const { error: companyErr } = await admin.from("companies").delete().eq("id", profile.company_id);
    if (companyErr) return { error: "Não foi possível excluir a empresa: " + companyErr.message };

    await admin.auth.admin.deleteUser(profile.id);
  } else {
    if (confirmText !== "EXCLUIR") return { error: 'Digite "EXCLUIR" para confirmar.' };
    const { error } = await admin.auth.admin.deleteUser(profile.id);
    if (error) return { error: "Não foi possível excluir a conta: " + error.message };
  }

  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
