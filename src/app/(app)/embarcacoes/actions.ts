"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createVessel(_prev: unknown, formData: FormData) {
  const supabase = createClient();

  // 1) confirma o usuario logado direto no Supabase Auth
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "Sessão inválida. Faça login novamente." };
  }

  // 2) busca a empresa vinculada ao usuario (no NauticFlow o vinculo fica em profiles.company_id)
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.company_id) {
    return {
      error:
        "Seu usuário não está vinculado a uma empresa. Saia, crie a conta novamente (isso roda o bootstrap_company) e tente de novo.",
    };
  }

  // 3) insere a embarcacao com o company_id do usuario logado
  // a capacidade comercial e preenchida automaticamente pelo trigger no banco
  const { error } = await supabase.from("vessels").insert({
    company_id: profile.company_id,
    name: String(formData.get("name")),
    type: String(formData.get("type")),
    official_capacity: Number(formData.get("official_capacity")),
    default_crew: Number(formData.get("default_crew")),
    gross_tonnage: formData.get("gross_tonnage")
      ? Number(formData.get("gross_tonnage"))
      : null,
    registration: String(formData.get("registration") || ""),
  });
  if (error) return { error: error.message };

  revalidatePath("/embarcacoes");
  return { error: "" };
}

export async function updateVessel(_prev: unknown, formData: FormData) {
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

  const id = String(formData.get("id"));
  const { error } = await supabase
    .from("vessels")
    .update({
      name: String(formData.get("name")),
      type: String(formData.get("type")),
      official_capacity: Number(formData.get("official_capacity")),
      default_crew: Number(formData.get("default_crew")),
      gross_tonnage: formData.get("gross_tonnage") ? Number(formData.get("gross_tonnage")) : null,
      registration: String(formData.get("registration") || ""),
    })
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/embarcacoes");
  revalidatePath(`/embarcacoes/${id}`);
  return { error: "" };
}

export async function deleteVessel(formData: FormData) {
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

  // bloqueia se houver saidas vinculadas a esta embarcacao
  const { count } = await supabase
    .from("departures")
    .select("id", { count: "exact", head: true })
    .eq("vessel_id", id)
    .eq("company_id", profile.company_id);
  if (count && count > 0) {
    return {
      error:
        "Esta embarcação possui saídas vinculadas. Exclua as saídas antes de remover a embarcação.",
    };
  }

  const { error } = await supabase
    .from("vessels")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) return { error: "Não é possível excluir porque existem registros vinculados." };
  revalidatePath("/embarcacoes");
  return { error: "" };
}
