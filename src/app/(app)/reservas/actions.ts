"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { requireActiveSubscription } from "@/lib/subscription";
import { saoPauloHHMM } from "@/lib/format";

export async function createReservation(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const subscriptionBlocked = await requireActiveSubscription(profile.company_id);
  if (subscriptionBlocked) return { error: subscriptionBlocked };

  const supabase = createClient();
  const valueReais = Number(String(formData.get("value") || "0").replace(",", "."));
  const peopleCount = Number(formData.get("people_count"));
  const departure_id = String(formData.get("departure_id"));
  const client_id = String(formData.get("client_id"));

  // valor e quantidade vem direto do formulario -- sem essa checagem, uma chamada
  // direta a action (sem passar pela UI) podia gravar receita negativa/inventada ou
  // uma quantidade de passageiros sem sentido. desconto/preco combinado continua
  // livre (nao trava contra o preco base do passeio), so bloqueia valor sem sentido.
  if (!Number.isFinite(valueReais) || valueReais < 0) {
    return { error: "Valor da reserva inválido." };
  }
  if (!Number.isInteger(peopleCount) || peopleCount < 1) {
    return { error: "Número de passageiros inválido." };
  }

  // confere que a saida e o cliente escolhidos sao mesmo da propria empresa -- sem isso,
  // um usuario autenticado de qualquer empresa poderia forjar o POST com o id de uma saida
  // ou cliente de OUTRA empresa (o dropdown do formulario nao e a unica forma de submeter
  // esses campos). reforcado tambem por gatilho no banco (migration 0015).
  const [{ data: departure }, { data: client }] = await Promise.all([
    supabase.from("departures").select("departs_at, company_id").eq("id", departure_id).maybeSingle(),
    supabase.from("clients").select("company_id").eq("id", client_id).maybeSingle(),
  ]);
  if (!departure || departure.company_id !== profile.company_id) {
    return { error: "Saída inválida." };
  }
  if (!client || client.company_id !== profile.company_id) {
    return { error: "Cliente inválido." };
  }
  const hhmm = saoPauloHHMM(departure.departs_at);
  if (hhmm < "08:00" || hhmm > "19:00")
    return { error: "Esta saída está fora do horário permitido para reservas (08:00–19:00)." };

  const { data: inserted, error } = await supabase
    .from("reservations")
    .insert({
      company_id: profile.company_id,
      departure_id,
      client_id,
      people_count: peopleCount,
      total_cents: Math.round(valueReais * 100),
      origin_name: String(formData.get("origin_name") || "") || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    // o gatilho do banco recusa quando excede a capacidade da saida
    if (error.message.includes("Capacidade excedida"))
      return { error: "Sem vagas suficientes nesta saída. " + error.message };
    console.error("createReservation:", error);
    return { error: "Não foi possível criar a reserva. Tente novamente." };
  }

  // tenta enviar o voucher por e-mail, mas NUNCA desfaz a reserva se falhar
  let info = "Reserva criada.";
  try {
    const { data: fn, error: fnErr } = await supabase.functions.invoke("send-reservation-voucher", {
      body: { reservation_id: inserted!.id },
    });
    info = !fnErr && fn && (fn as any).sent
      ? "Reserva criada e voucher enviado por e-mail."
      : "Reserva criada, mas não foi possível enviar o voucher por e-mail.";
  } catch {
    info = "Reserva criada, mas não foi possível enviar o voucher por e-mail.";
  }

  revalidatePath("/reservas");
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  return { error: "", info };
}

export async function resendVoucher(reservationId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sessão inválida." };
  try {
    const { data, error } = await supabase.functions.invoke("send-reservation-voucher", {
      body: { reservation_id: reservationId },
    });
    if (error) return { ok: false, message: "Não foi possível reenviar o voucher." };
    if (data && (data as any).sent === false)
      return { ok: false, message: (data as any).message ?? "Envio de e-mail ainda não configurado." };
    return { ok: true, message: "Voucher reenviado com sucesso." };
  } catch {
    return { ok: false, message: "Não foi possível reenviar o voucher." };
  }
}

export async function updateReservationStatus(id: string, status: "confirmada" | "pendente") {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sessão inválida." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.company_id) return { ok: false, message: "Usuário sem empresa vinculada." };

  const { error } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) {
    console.error("updateReservationStatus:", error);
    return { ok: false, message: "Não foi possível atualizar o status. Tente novamente." };
  }

  revalidatePath("/reservas");
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  return { ok: true, message: "Status atualizado." };
}

export async function updateReservation(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const supabase = createClient();
  const id = String(formData.get("id"));
  const valueReais = Number(String(formData.get("value") || "0").replace(",", "."));
  const peopleCount = Number(formData.get("people_count"));
  const departure_id = String(formData.get("departure_id"));
  const client_id = String(formData.get("client_id"));

  // mesma validacao de valor/quantidade da createReservation
  if (!Number.isFinite(valueReais) || valueReais < 0) {
    return { error: "Valor da reserva inválido." };
  }
  if (!Number.isInteger(peopleCount) || peopleCount < 1) {
    return { error: "Número de passageiros inválido." };
  }

  // mesma checagem de dono da createReservation -- editar tambem aceitava trocar pra uma
  // saida/cliente de outra empresa sem validacao (reforcado tambem via migration 0015)
  const [{ data: departure }, { data: client }] = await Promise.all([
    supabase.from("departures").select("company_id").eq("id", departure_id).maybeSingle(),
    supabase.from("clients").select("company_id").eq("id", client_id).maybeSingle(),
  ]);
  if (!departure || departure.company_id !== profile.company_id) {
    return { error: "Saída inválida." };
  }
  if (!client || client.company_id !== profile.company_id) {
    return { error: "Cliente inválido." };
  }

  const { error } = await supabase
    .from("reservations")
    .update({
      departure_id,
      client_id,
      people_count: peopleCount,
      total_cents: Math.round(valueReais * 100),
      origin_name: String(formData.get("origin_name") || "") || null,
    })
    .eq("id", id)
    .eq("company_id", profile.company_id);

  if (error) {
    if (error.message.includes("Capacidade excedida"))
      return { error: "Sem vagas suficientes nesta saída. " + error.message };
    console.error("updateReservation:", error);
    return { error: "Não foi possível salvar a reserva. Tente novamente." };
  }

  revalidatePath("/reservas");
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  return { error: "" };
}

export async function deleteReservation(formData: FormData) {
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

  // os passageiros vinculados sao removidos em cascata pelo banco
  const { error } = await supabase
    .from("reservations")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) {
    console.error("deleteReservation:", error);
    return { error: "Não foi possível excluir a reserva. Tente novamente." };
  }
  revalidatePath("/reservas");
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  return { error: "" };
}
