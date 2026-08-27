"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { requireActiveSubscription } from "@/lib/subscription";

async function companyId() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, id: null as string | null };
  const { data } = await supabase.from("profiles").select("company_id").eq("id", user.id).maybeSingle();
  return { supabase, id: (data?.company_id as string) ?? null };
}

// Cria só o "rascunho" (nome) e manda pra tela de edição preencher o resto -- mesmo
// espírito de outras telas de cadastro do sistema (embarcação, cliente): primeiro
// salva o mínimo, depois edita os detalhes. O índice único parcial da migration
// 0022 (um passeio ativo por nome/empresa) já impede duplicata aqui.
export async function createTourDraft(_prev: unknown, formData: FormData) {
  const profile = await getProfile();
  if (!profile?.company_id) return { error: "Sessão inválida." };

  const subscriptionBlocked = await requireActiveSubscription(profile.company_id);
  if (subscriptionBlocked) return { error: subscriptionBlocked };

  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Informe o nome do passeio." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("tours")
    .insert({ company_id: profile.company_id, name })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Já existe um passeio ativo com este nome." };
    return { error: error.message };
  }

  revalidatePath("/passeios");
  redirect(`/passeios/${data!.id}`);
}

function toNullableInt(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toNullableNumeric(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNullableText(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim();
  return s || null;
}

export async function updateTourFull(_prev: unknown, formData: FormData) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { error: "Sessão inválida ou usuário sem empresa." };

  const id = String(formData.get("id"));
  const { data: existing } = await supabase.from("tours").select("company_id, published_at").eq("id", id).maybeSingle();
  if (!existing || existing.company_id !== company_id) return { error: "Passeio inválido." };

  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Informe o nome do passeio." };

  const priceReais = Number(String(formData.get("base_price_cents") || "0").replace(",", "."));
  if (!Number.isFinite(priceReais) || priceReais < 0) return { error: "Preço-base inválido." };

  const patch: Record<string, unknown> = {
    name,
    short_description: toNullableText(formData.get("short_description")),
    description: toNullableText(formData.get("description")),
    category: toNullableText(formData.get("category")),
    destination: toNullableText(formData.get("destination")),
    duration_minutes: toNullableInt(formData.get("duration_minutes")),
    price_type: String(formData.get("price_type") || "por_pessoa"),
    base_price_cents: Math.round(priceReais * 100),
    itinerary: toNullableText(formData.get("itinerary")),
    included: toNullableText(formData.get("included")),
    not_included: toNullableText(formData.get("not_included")),
    important_information: toNullableText(formData.get("important_information")),
    cancellation_policy: toNullableText(formData.get("cancellation_policy")),
    boarding_name: toNullableText(formData.get("boarding_name")),
    boarding_address: toNullableText(formData.get("boarding_address")),
    boarding_neighborhood: toNullableText(formData.get("boarding_neighborhood")),
    boarding_city: toNullableText(formData.get("boarding_city")),
    boarding_state: toNullableText(formData.get("boarding_state")),
    boarding_zip_code: toNullableText(formData.get("boarding_zip_code")),
    boarding_reference: toNullableText(formData.get("boarding_reference")),
    boarding_instructions: toNullableText(formData.get("boarding_instructions")),
    boarding_latitude: toNullableNumeric(formData.get("boarding_latitude")),
    boarding_longitude: toNullableNumeric(formData.get("boarding_longitude")),
  };

  // slug só é editável enquanto o passeio nunca foi publicado -- depois disso o
  // próprio gatilho no banco (trg_tour_slug, migration 0032) recusa a troca; aqui
  // só evita mandar um valor pra ele nem tentar quando já sabemos que vai falhar
  if (!existing.published_at) {
    const slug = toNullableText(formData.get("slug"));
    if (slug) patch.slug = slug;
  }

  const { error } = await supabase.from("tours").update(patch).eq("id", id).eq("company_id", company_id);
  if (error) {
    if (error.code === "23505") return { error: "Já existe um passeio com este nome ou endereço (slug)." };
    return { error: error.message };
  }

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${id}`);
  return { error: "" };
}

// Campos mínimos pra mandar um passeio pra revisão (item 14 do pedido). Salvar um
// rascunho incompleto nunca é bloqueado -- só o ENVIO pra revisão exige isso.
async function validateReadyForReview(
  supabase: ReturnType<typeof createClient>,
  tourId: string
): Promise<string | null> {
  const { data: tour } = await supabase
    .from("tours")
    .select(
      "name, short_description, description, category, destination, duration_minutes, price_type, boarding_name, boarding_address, boarding_city"
    )
    .eq("id", tourId)
    .maybeSingle();
  if (!tour) return "Passeio não encontrado.";

  const missing: string[] = [];
  if (!tour.name?.trim()) missing.push("nome");
  if (!tour.short_description?.trim()) missing.push("descrição curta");
  if (!tour.description?.trim()) missing.push("descrição");
  if (!tour.destination?.trim()) missing.push("destino");
  if (!tour.category) missing.push("categoria");
  if (!tour.duration_minutes) missing.push("duração");
  if (!tour.price_type) missing.push("tipo de preço");
  if (!tour.boarding_name?.trim() || !tour.boarding_address?.trim() || !tour.boarding_city?.trim())
    missing.push("local de embarque (nome, endereço e cidade)");

  const { count } = await supabase
    .from("tour_photos")
    .select("id", { count: "exact", head: true })
    .eq("tour_id", tourId);
  if (!count || count < 1) missing.push("pelo menos 1 foto");

  if (missing.length > 0) return `Preencha antes de enviar para revisão: ${missing.join(", ")}.`;
  return null;
}

export async function submitTourForReview(tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: tour } = await supabase
    .from("tours")
    .select("company_id, marketplace_status")
    .eq("id", tourId)
    .maybeSingle();
  if (!tour || tour.company_id !== company_id) return { ok: false, message: "Passeio inválido." };
  if (tour.marketplace_status !== "draft" && tour.marketplace_status !== "rejected") {
    return { ok: false, message: "Só é possível enviar para revisão um passeio em rascunho ou recusado." };
  }

  const validationError = await validateReadyForReview(supabase, tourId);
  if (validationError) return { ok: false, message: validationError };

  const { error } = await supabase
    .from("tours")
    .update({ marketplace_status: "review", marketplace_rejection_reason: null })
    .eq("id", tourId)
    .eq("company_id", company_id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Enviado para revisão. Um administrador vai avaliar antes de publicar." };
}

export async function withdrawTourFromReview(tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { error } = await supabase
    .from("tours")
    .update({ marketplace_status: "draft" })
    .eq("id", tourId)
    .eq("company_id", company_id)
    .eq("marketplace_status", "review");
  if (error) return { ok: false, message: error.message };

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Retirado da fila de revisão. Voltou para rascunho." };
}

export async function pauseTour(tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { error } = await supabase
    .from("tours")
    .update({ marketplace_status: "paused" })
    .eq("id", tourId)
    .eq("company_id", company_id)
    .eq("marketplace_status", "published");
  if (error) return { ok: false, message: error.message };

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Passeio pausado. Ele some da vitrine do ToursFlow até ser reativado." };
}

// Reativar um passeio pausado NÃO passa por nova revisão -- o conteúdo já tinha
// sido aprovado antes de ser publicado pela primeira vez. Se o operador editar o
// conteúdo enquanto pausado, hoje isso não força nova revisão automaticamente;
// fica documentado como melhoria futura (ver DOCUMENTACAO.md).
export async function resumeTour(tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { error } = await supabase
    .from("tours")
    .update({ marketplace_status: "published" })
    .eq("id", tourId)
    .eq("company_id", company_id)
    .eq("marketplace_status", "paused");
  if (error) return { ok: false, message: error.message };

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Passeio reativado na vitrine." };
}

// ============================================================================
// FOTOS — o upload do arquivo em si acontece no navegador (Storage RLS, migration
// 0034); estas actions só cuidam do registro em tour_photos.
// ============================================================================

export async function addTourPhoto(tourId: string, storagePath: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: tour } = await supabase.from("tours").select("company_id").eq("id", tourId).maybeSingle();
  if (!tour || tour.company_id !== company_id) return { ok: false, message: "Passeio inválido." };

  const { count } = await supabase
    .from("tour_photos")
    .select("id", { count: "exact", head: true })
    .eq("tour_id", tourId);
  const isFirstPhoto = !count || count === 0;

  const { error } = await supabase.from("tour_photos").insert({
    company_id,
    tour_id: tourId,
    storage_path: storagePath,
    position: count ?? 0,
    is_cover: isFirstPhoto,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Foto adicionada." };
}

export async function setCoverPhoto(photoId: string, tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  await supabase
    .from("tour_photos")
    .update({ is_cover: false })
    .eq("tour_id", tourId)
    .eq("company_id", company_id)
    .eq("is_cover", true);

  const { error } = await supabase
    .from("tour_photos")
    .update({ is_cover: true })
    .eq("id", photoId)
    .eq("company_id", company_id);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Capa definida." };
}

export async function deleteTourPhoto(photoId: string, tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: photo } = await supabase
    .from("tour_photos")
    .select("storage_path, is_cover")
    .eq("id", photoId)
    .eq("company_id", company_id)
    .maybeSingle();
  if (!photo) return { ok: false, message: "Foto não encontrada." };

  await supabase.storage.from("tour-photos").remove([photo.storage_path]);
  const { error } = await supabase.from("tour_photos").delete().eq("id", photoId).eq("company_id", company_id);
  if (error) return { ok: false, message: error.message };

  // se apagou a capa e sobraram fotos, promove a primeira da lista pra evitar um
  // passeio publicado sem nenhuma foto de capa
  if (photo.is_cover) {
    const { data: next } = await supabase
      .from("tour_photos")
      .select("id")
      .eq("tour_id", tourId)
      .eq("company_id", company_id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) await supabase.from("tour_photos").update({ is_cover: true }).eq("id", next.id);
  }

  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Foto removida." };
}

export async function moveTourPhoto(photoId: string, tourId: string, direction: "up" | "down") {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: photos } = await supabase
    .from("tour_photos")
    .select("id, position")
    .eq("tour_id", tourId)
    .eq("company_id", company_id)
    .order("position", { ascending: true });
  if (!photos) return { ok: false, message: "Não foi possível reordenar." };

  const idx = photos.findIndex((p) => p.id === photoId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= photos.length) return { ok: true, message: "" };

  const a = photos[idx];
  const b = photos[swapIdx];
  await supabase.from("tour_photos").update({ position: b.position }).eq("id", a.id);
  await supabase.from("tour_photos").update({ position: a.position }).eq("id", b.id);

  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "" };
}
