"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";

export async function addPassenger(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  const reservationId = String(formData.get("reservation_id"));

  const supabase = createClient();

  // confere que a reserva e da propria empresa -- sem isso, um usuario autenticado de
  // qualquer empresa poderia injetar um passageiro numa reserva de OUTRA empresa (o id
  // aparece na URL do voucher, que e enviado por e-mail ao cliente por design). reforcado
  // tambem por gatilho no banco (migration 0015).
  const { data: reservation } = await supabase
    .from("reservations")
    .select("company_id")
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation || reservation.company_id !== profile.company_id) {
    return { error: "Reserva inválida." };
  }

  const { error } = await supabase.from("passengers").insert({
    company_id: profile.company_id,
    reservation_id: reservationId,
    name: String(formData.get("name")),
    document: String(formData.get("document") || "") || null,
    nationality: String(formData.get("nationality") || "") || null,
    birth_date: formData.get("birth_date") ? String(formData.get("birth_date")) : null,
    emergency_contact: String(formData.get("emergency_contact") || "") || null,
  });

  if (error) {
    // o gatilho recusa passageiros acima do people_count da reserva
    if (error.message.includes("Limite de passageiros"))
      return { error: "A reserva não comporta mais passageiros." };
    return { error: error.message };
  }
  revalidatePath(`/reservas/${reservationId}`);
  return { error: "" };
}

export async function setPassengerStatus(formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return;
  const id = String(formData.get("id"));
  const reservationId = String(formData.get("reservation_id"));
  const status = String(formData.get("status"));
  const supabase = createClient();
  // confere que o passageiro e da propria empresa, mesmo padrao do addPassenger acima
  await supabase.from("passengers").update({ status }).eq("id", id).eq("company_id", profile.company_id);
  revalidatePath(`/reservas/${reservationId}`);
}

export async function removePassenger(formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return;
  const id = String(formData.get("id"));
  const reservationId = String(formData.get("reservation_id"));
  const supabase = createClient();
  await supabase.from("passengers").delete().eq("id", id).eq("company_id", profile.company_id);
  revalidatePath(`/reservas/${reservationId}`);
}
