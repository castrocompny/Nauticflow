"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
