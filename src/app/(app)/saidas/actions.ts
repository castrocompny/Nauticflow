"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";

export async function createDeparture(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  const company_id = profile.company_id;
  const supabase = createClient();

  const vessel_id = String(formData.get("vessel_id"));
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));
  if (!vessel_id || !date || !time) return { error: "Preencha embarcação, data e hora." };

  // resolve o passeio: existente ou novo
  let tour_id = String(formData.get("tour_id") || "");
  const newTour = String(formData.get("new_tour") || "").trim();
  if (!tour_id && newTour) {
    const { data, error } = await supabase
      .from("tours")
      .insert({ company_id, name: newTour })
      .select("id")
      .single();
    if (error) return { error: error.message };
    tour_id = data!.id;
  }
  if (!tour_id) return { error: "Selecione ou crie um passeio." };

  const departs_at = new Date(`${date}T${time}`).toISOString();
  const capRaw = formData.get("capacity");
  const capacity = capRaw ? Number(capRaw) : null;

  const { error } = await supabase.from("departures").insert({
    company_id,
    vessel_id,
    tour_id,
    departs_at,
    ...(capacity ? { capacity } : {}),
  });

  if (error) {
    if (error.code === "23505")
      return { error: "Já existe uma saída desta embarcação neste horário." };
    if (error.message.includes("capacidade comercial"))
      return { error: error.message };
    return { error: error.message };
  }
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "" };
}

async function companyId() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, id: null as string | null };
  const { data } = await supabase.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
  return { supabase, id: (data?.company_id as string) ?? null };
}

export async function updateDeparture(_prev: unknown, formData: FormData) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { error: "Sessão inválida ou usuário sem empresa." };

  const id = String(formData.get("id"));
  const vessel_id = String(formData.get("vessel_id"));
  const tour_id = String(formData.get("tour_id"));
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));
  if (!vessel_id || !tour_id || !date || !time) return { error: "Preencha embarcação, passeio, data e hora." };

  const departs_at = new Date(`${date}T${time}`).toISOString();
  const capRaw = formData.get("capacity");
  const capacity = capRaw ? Number(capRaw) : null;

  const { error } = await supabase
    .from("departures")
    .update({
      vessel_id,
      tour_id,
      departs_at,
      ...(capacity ? { capacity } : {}),
    })
    .eq("id", id)
    .eq("company_id", company_id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma saída desta embarcação neste horário." };
    return { error: error.message };
  }
  revalidatePath("/saidas");
  revalidatePath(`/saidas/${id}`);
  revalidatePath("/dashboard");
  return { error: "" };
}

async function setDepartureStatus(id: string, status: "em_andamento" | "cancelada" | "encerrada") {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };
  const { error } = await supabase
    .from("departures")
    .update({ status })
    .eq("id", id)
    .eq("company_id", company_id);
  if (error) return { ok: false, message: "Não foi possível atualizar a saída. " + error.message };
  revalidatePath("/saidas");
  revalidatePath(`/saidas/${id}`);
  revalidatePath("/reservas");
  revalidatePath("/dashboard");
  return { ok: true, message: "Saída atualizada." };
}

export async function confirmDeparture(id: string) {
  return setDepartureStatus(id, "em_andamento");
}

export async function cancelDeparture(id: string) {
  return setDepartureStatus(id, "cancelada");
}

export async function finalizeDeparture(id: string) {
  return setDepartureStatus(id, "encerrada");
}

export async function deleteDeparture(formData: FormData) {
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

  // bloqueia se houver reservas vinculadas a esta saida
  const { count } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("departure_id", id)
    .eq("company_id", profile.company_id);
  if (count && count > 0) {
    return {
      error:
        "Esta saída possui reservas vinculadas. Exclua ou cancele as reservas antes de remover a saída.",
    };
  }

  // sem reservas: remove o manifesto tecnico/vazio desta saida, se existir
  await supabase.from("manifests").delete().eq("departure_id", id).eq("company_id", profile.company_id);

  const { error } = await supabase
    .from("departures")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) return { error: "Não é possível excluir porque existem registros vinculados." };
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  return { error: "" };
}
