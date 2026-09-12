"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { requireActiveSubscription } from "@/lib/subscription";
import { saoPauloHHMM } from "@/lib/format";

// Reserva de balcão (RPC create_counter_reservation, migration 0072) --
// substitui o antigo INSERT direto: agora cliente existente OU criação
// rápida de cliente + reserva confirmada acontecem na MESMA transação
// atômica no banco (nunca deixa cliente órfão se a capacidade falhar). A
// janela comercial (08:00-19:00) é regra de UI/operação, não de estoque --
// continua reforçada aqui, já que a RPC não a conhece (só valida
// propriedade/capacidade/estoque, que é o que realmente protege dados).
export async function createCounterReservation(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const subscriptionBlocked = await requireActiveSubscription(profile.company_id);
  if (subscriptionBlocked) return { error: subscriptionBlocked };

  const supabase = createClient();

  const departureId = String(formData.get("departure_id") || "");
  const peopleCount = Number(formData.get("people_count"));
  const valueReais = Number(String(formData.get("value") || "0").replace(",", "."));
  const clientMode = String(formData.get("client_mode") || "existing");
  const clientId = String(formData.get("client_id") || "");
  const clientName = String(formData.get("client_name") || "").trim();
  const clientPhone = String(formData.get("client_phone") || "").trim();
  const originName = String(formData.get("origin_name") || "").trim();

  if (!departureId) return { error: "Selecione uma saída." };
  if (!Number.isInteger(peopleCount) || peopleCount < 1) {
    return { error: "Número de passageiros inválido." };
  }
  if (!Number.isFinite(valueReais) || valueReais < 0) {
    return { error: "Valor da reserva inválido." };
  }
  if (clientMode === "existing" && !clientId) return { error: "Selecione um cliente." };
  if (clientMode === "quick" && !clientName) return { error: "Informe o nome do cliente." };

  const { data: departure } = await supabase
    .from("departures")
    .select("departs_at")
    .eq("id", departureId)
    .maybeSingle();
  if (!departure) return { error: "Saída inválida." };
  const hhmm = saoPauloHHMM(departure.departs_at);
  if (hhmm < "08:00" || hhmm > "19:00")
    return { error: "Esta saída está fora do horário permitido para reservas (08:00–19:00)." };

  const { data, error } = await supabase.rpc("create_counter_reservation", {
    p_departure_id: departureId,
    p_people_count: peopleCount,
    p_total_cents: Math.round(valueReais * 100),
    p_client_id: clientMode === "existing" ? clientId : null,
    p_client_name: clientMode === "quick" ? clientName : null,
    p_client_phone: clientMode === "quick" ? clientPhone || null : null,
    p_origin_name: originName || null,
  });

  const row = data?.[0];
  if (error || !row) {
    if (error?.message.includes("Capacidade excedida")) {
      return { error: "Não há mais vagas suficientes nesta saída." };
    }
    if (error?.message.includes("DEPARTURE_NOT_BOOKABLE")) {
      return { error: "Esta saída não está mais disponível para reserva." };
    }
    if (error?.message.includes("DEPARTURE_NOT_FOUND")) return { error: "Saída inválida." };
    if (error?.message.includes("CLIENT_NOT_FOUND")) return { error: "Cliente inválido." };
    if (error?.message.includes("CLIENT_NAME_REQUIRED")) return { error: "Informe o nome do cliente." };
    console.error("createCounterReservation:", error);
    return { error: "Não foi possível criar a reserva. Tente novamente." };
  }

  // tenta enviar o voucher por e-mail, mas NUNCA desfaz a reserva se falhar --
  // e ausência de e-mail (cliente rápido sem e-mail cadastrado) nunca é
  // tratada como erro, só não há o que enviar.
  let info = "Reserva criada com sucesso.";
  try {
    const { data: fn, error: fnErr } = await supabase.functions.invoke("send-reservation-voucher", {
      body: { reservation_id: row.reservation_id },
    });
    if (!fnErr && fn && (fn as any).sent) {
      info = "Reserva criada e voucher enviado por e-mail.";
    }
  } catch {
    // silencioso -- mensagem padrão "Reserva criada com sucesso." já cobre este caso
  }

  revalidatePath("/reservas");
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  return { error: "", info };
}

// Combobox de cliente existente (Etapa "Reserva de balcão") -- busca por
// nome, escopada pela MESMA RLS que já protege toda leitura de `clients`
// ("clientes da empresa", migration 0000): nunca precisa filtrar company_id
// explicitamente aqui, o Postgres já recusa ver linha de outra empresa.
export async function searchClients(query: string): Promise<{ id: string; name: string; phone: string | null }[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, phone")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(20);
  return (data ?? []) as { id: string; name: string; phone: string | null }[];
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
