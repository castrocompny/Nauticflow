"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { requireActiveSubscription } from "@/lib/subscription";
import { saoPauloToUTC } from "@/lib/format";

// normaliza nome de passeio pra comparar sem diferenciar maiúscula/minúscula nem acento
// (ex: "Geribá", "geriba" e "GERIBA" viram a mesma coisa) -- evita passeios duplicados
function normalizeTourName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export async function createDeparture(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };
  const company_id = profile.company_id;

  const subscriptionBlocked = await requireActiveSubscription(company_id);
  if (subscriptionBlocked) return { error: subscriptionBlocked };

  const supabase = createClient();

  const vessel_id = String(formData.get("vessel_id"));
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));
  if (!vessel_id || !date || !time) return { error: "Preencha embarcação, data e hora." };
  if (time < "08:00" || time > "19:00") return { error: "O horário de saída deve ser entre 08:00 e 19:00." };
  if (new Date(saoPauloToUTC(date, time)) < new Date()) return { error: "Não é possível criar uma saída em um horário que já passou." };

  // confere que a embarcacao escolhida e da propria empresa -- sem isso, um usuario
  // autenticado de qualquer empresa poderia criar uma saida apontando pra uma
  // embarcacao de OUTRA empresa (o dropdown do formulario nao e a unica forma de
  // submeter esse campo). mesmo padrao ja usado em reservas/actions.ts.
  const { data: vessel } = await supabase.from("vessels").select("company_id").eq("id", vessel_id).maybeSingle();
  if (!vessel || vessel.company_id !== company_id) {
    return { error: "Embarcação inválida." };
  }

  // resolve o passeio: existente ou novo
  let tour_id = String(formData.get("tour_id") || "");
  const newTour = String(formData.get("new_tour") || "").trim();
  let tourJustCreated = false;
  if (!tour_id && newTour) {
    // evita duplicata: se ja existe um passeio ativo com o mesmo nome (ignorando
    // maiuscula/acento), reaproveita ele em vez de criar outro igual
    const target = normalizeTourName(newTour);
    const { data: existingTours } = await supabase
      .from("tours")
      .select("id, name")
      .eq("company_id", company_id)
      .eq("active", true);
    const match = (existingTours ?? []).find((t) => normalizeTourName(t.name) === target);

    if (match) {
      tour_id = match.id;
    } else {
      const { data, error } = await supabase
        .from("tours")
        .insert({ company_id, name: newTour })
        .select("id")
        .single();
      if (error) {
        console.error("createDeparture new_tour:", error);
        return { error: "Não foi possível criar o passeio. Tente novamente." };
      }
      tour_id = data!.id;
      tourJustCreated = true;
    }
  }
  if (!tour_id) return { error: "Selecione ou crie um passeio." };
  if (!tourJustCreated) {
    // so precisa validar dono quando o passeio veio do dropdown (existente) -- quando
    // acabou de ser criado acima, ja nasce com o company_id certo
    const { data: tour } = await supabase.from("tours").select("company_id").eq("id", tour_id).maybeSingle();
    if (!tour || tour.company_id !== company_id) {
      return { error: "Passeio inválido." };
    }
  }

  const departs_at = saoPauloToUTC(date, time);
  const capRaw = formData.get("capacity");
  const capacity = capRaw ? Number(capRaw) : null;
  const priceRaw = String(formData.get("price_cents") || "").trim();
  const priceReais = priceRaw ? Number(priceRaw.replace(",", ".")) : null;
  if (priceRaw && (!Number.isFinite(priceReais) || (priceReais as number) < 0)) {
    return { error: "Preço da saída inválido." };
  }

  const { error } = await supabase.from("departures").insert({
    company_id,
    vessel_id,
    tour_id,
    departs_at,
    ...(capacity ? { capacity } : {}),
    price_cents: priceReais != null ? Math.round(priceReais * 100) : null,
  });

  if (error) {
    if (error.code === "23505")
      return { error: "Já existe uma saída desta embarcação neste horário." };
    if (error.message.includes("capacidade comercial"))
      return { error: error.message };
    console.error("createDeparture:", error);
    return { error: "Não foi possível criar a saída. Tente novamente." };
  }
  revalidatePath("/saidas");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
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
  if (time < "08:00" || time > "19:00") return { error: "O horário de saída deve ser entre 08:00 e 19:00." };

  // mesma checagem de dono do createDeparture -- editar tambem aceitava trocar pra uma
  // embarcacao/passeio de outra empresa sem validacao
  const [{ data: vessel }, { data: tour }] = await Promise.all([
    supabase.from("vessels").select("company_id").eq("id", vessel_id).maybeSingle(),
    supabase.from("tours").select("company_id").eq("id", tour_id).maybeSingle(),
  ]);
  if (!vessel || vessel.company_id !== company_id) return { error: "Embarcação inválida." };
  if (!tour || tour.company_id !== company_id) return { error: "Passeio inválido." };

  const departs_at = saoPauloToUTC(date, time);
  const capRaw = formData.get("capacity");
  const capacity = capRaw ? Number(capRaw) : null;
  const priceRaw = String(formData.get("price_cents") || "").trim();
  const priceReais = priceRaw ? Number(priceRaw.replace(",", ".")) : null;
  if (priceRaw && (!Number.isFinite(priceReais) || (priceReais as number) < 0)) {
    return { error: "Preço da saída inválido." };
  }

  const { error } = await supabase
    .from("departures")
    .update({
      vessel_id,
      tour_id,
      departs_at,
      ...(capacity ? { capacity } : {}),
      price_cents: priceReais != null ? Math.round(priceReais * 100) : null,
    })
    .eq("id", id)
    .eq("company_id", company_id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma saída desta embarcação neste horário." };
    console.error("updateDeparture:", error);
    return { error: "Não foi possível salvar a saída. Tente novamente." };
  }
  revalidatePath("/saidas");
  revalidatePath(`/saidas/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
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
  if (error) {
    console.error("setDepartureStatus:", error);
    return { ok: false, message: "Não foi possível atualizar a saída. Tente novamente." };
  }
  revalidatePath("/saidas");
  revalidatePath(`/saidas/${id}`);
  revalidatePath("/reservas");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
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
  revalidatePath("/agenda");
  return { error: "" };
}

// Exclui um passeio da lista. Se ele já foi usado em alguma saída, não dá pra apagar
// de vez (a FK departures.tour_id é "on delete restrict" e apagaria/quebraria o
// histórico), então nesse caso ele é só DESATIVADO (active=false): some do dropdown e
// deste painel, mas as saídas antigas continuam intactas. Sem nenhuma saída, apaga mesmo.
export async function deleteTour(formData: FormData) {
  const id = String(formData.get("id"));
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { error: "Sessão inválida ou usuário sem empresa." };

  const { data: tour } = await supabase.from("tours").select("company_id").eq("id", id).maybeSingle();
  if (!tour || tour.company_id !== company_id) return { error: "Passeio inválido." };

  const { count } = await supabase
    .from("departures")
    .select("id", { count: "exact", head: true })
    .eq("tour_id", id)
    .eq("company_id", company_id);

  if (count && count > 0) {
    // tem histórico -> desativa em vez de apagar (preserva as saídas)
    const { error } = await supabase
      .from("tours")
      .update({ active: false })
      .eq("id", id)
      .eq("company_id", company_id);
    if (error) {
      console.error("deleteTour deactivate:", error);
      return { error: "Não foi possível atualizar o passeio. Tente novamente." };
    }
  } else {
    const { error } = await supabase.from("tours").delete().eq("id", id).eq("company_id", company_id);
    if (error) {
      console.error("deleteTour delete:", error);
      return { error: "Não foi possível excluir o passeio. Tente novamente." };
    }
  }

  revalidatePath("/saidas");
  revalidatePath("/agenda");
  return { error: "" };
}
