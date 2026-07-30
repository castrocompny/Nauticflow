"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";

export async function createClientRecord(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const supabase = createClient();
  const { error } = await supabase.from("clients").insert({
    company_id: profile.company_id,
    name: String(formData.get("name")),
    cpf: String(formData.get("cpf") || "") || null,
    phone: String(formData.get("phone") || "") || null,
    email: String(formData.get("email") || "") || null,
    city: String(formData.get("city") || "") || null,
  });
  if (error) {
    if (error.code === "23505") return { error: "Já existe um cliente com este CPF." };
    return { error: error.message };
  }
  revalidatePath("/clientes");
  return { error: "" };
}

export async function updateClient(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const supabase = createClient();
  const id = String(formData.get("id"));
  const { error } = await supabase
    .from("clients")
    .update({
      name: String(formData.get("name")),
      cpf: String(formData.get("cpf") || "") || null,
      phone: String(formData.get("phone") || "") || null,
      email: String(formData.get("email") || "") || null,
      city: String(formData.get("city") || "") || null,
    })
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) {
    if (error.code === "23505") return { error: "Já existe um cliente com este CPF." };
    return { error: error.message };
  }
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${id}`);
  return { error: "" };
}

export async function deleteClient(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão inválida. Faça login novamente." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.company_id) return { error: "Usuário sem empresa vinculada." };

  // bloqueia se o cliente tiver reservas vinculadas
  const { count } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", id)
    .eq("company_id", profile.company_id);
  if (count && count > 0) {
    return {
      error:
        "Este cliente possui reservas vinculadas. Exclua ou cancele as reservas antes de remover o cliente.",
    };
  }

  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) return { error: "Não é possível excluir porque existem registros vinculados." };
  revalidatePath("/clientes");
  return { error: "" };
}
