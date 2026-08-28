"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { requireActiveSubscription } from "@/lib/subscription";
import { validateTourForPublishing, friendlyContentErrorMessage } from "@/lib/tour-publishing";
import { runPhotoModeration, getImageModerationMode } from "@/lib/image-moderation";

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
    // passeio JÁ publicado tem o conteúdo protegido no banco
    // (trg_tour_content_while_published, migration 0044) -- acontece só quando
    // o passeio já está no ar e a edição introduziria contato externo/link
    // proibido; o erro chega como o código cru (ex: "PHONE_IN_DESCRIPTION"),
    // traduz pra mensagem legível.
    return { error: friendlyContentErrorMessage(error.message) };
  }

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${id}`);
  return { error: "" };
}

// Validação de publicação: a REGRA em si mora só no banco (função
// validate_tour_for_publishing, migration 0044) -- aqui só chama e devolve
// pra UI, nunca reimplementa nenhuma regra em TypeScript (fonte única de
// verdade, ver DOCUMENTACAO.md). Chamado tanto pelo checklist visual quanto
// por publishTour antes de tentar publicar -- e mesmo que este código seja
// pulado por completo, o gatilho check_tour_marketplace_transition chama a
// MESMA função de dentro do banco, então não existe caminho pra publicar um
// passeio que reprove nela.
export async function getPublicationChecklist(tourId: string) {
  const { supabase } = await companyId();
  return validateTourForPublishing(supabase, tourId);
}

// Publicação autônoma: o operador decide quando publicar, sem aprovação do
// super admin (decisão de produto -- ver DOCUMENTACAO.md).
export async function publishTour(tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: tour } = await supabase
    .from("tours")
    .select("company_id, marketplace_status")
    .eq("id", tourId)
    .maybeSingle();
  if (!tour || tour.company_id !== company_id) return { ok: false, message: "Passeio inválido." };
  if (tour.marketplace_status === "published") return { ok: true, message: "Este passeio já está publicado." };

  const validation = await validateTourForPublishing(supabase, tourId);
  if (!validation.canPublish) {
    return {
      ok: false,
      message: "Não foi possível publicar este passeio.",
      errors: validation.errors,
    };
  }

  const { error } = await supabase
    .from("tours")
    .update({ marketplace_status: "published" })
    .eq("id", tourId)
    .eq("company_id", company_id);
  if (error) {
    // defesa em profundidade: se o gatilho do banco recusar por um motivo que
    // a checagem acima não pegou (corrida, dado mudou entre as duas chamadas),
    // devolve mensagem legível em vez do erro cru
    if (error.message === "PUBLISH_VALIDATION_FAILED") {
      return { ok: false, message: "Não foi possível publicar este passeio. Tente novamente." };
    }
    return { ok: false, message: error.message };
  }

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Passeio publicado no ToursFlow." };
}

export async function unpublishTour(tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { error } = await supabase
    .from("tours")
    .update({ marketplace_status: "draft" })
    .eq("id", tourId)
    .eq("company_id", company_id)
    .eq("marketplace_status", "published");
  if (error) return { ok: false, message: error.message };

  revalidatePath("/passeios");
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Passeio despublicado. Ele some da vitrine do ToursFlow até ser publicado de novo." };
}

// ============================================================================
// FOTOS — o upload do arquivo em si acontece no navegador (Storage RLS, migration
// 0034); estas actions só cuidam do registro em tour_photos.
// ============================================================================

// manual_approved: liberada sem passar por provider algum, enquanto
// IMAGE_MODERATION_MODE=manual for a política ativa (ver src/lib/image-moderation.ts
// e DOCUMENTACAO.md) -- conta em tudo igual approved/legacy_approved. Trocar
// o modo pra "openai" no futuro NÃO reprocessa fotos manual_approved
// existentes automaticamente (decisão de produto explícita).
const APPROVED_STATUSES = ["approved", "legacy_approved", "manual_approved"];

export async function addTourPhoto(
  tourId: string,
  storagePath: string,
  width: number | null = null,
  height: number | null = null
) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: tour } = await supabase.from("tours").select("company_id").eq("id", tourId).maybeSingle();
  if (!tour || tour.company_id !== company_id) return { ok: false, message: "Passeio inválido." };

  const { count } = await supabase
    .from("tour_photos")
    .select("id", { count: "exact", head: true })
    .eq("tour_id", tourId);
  const isFirstPhoto = !count || count === 0;

  // Política de moderação é explícita (IMAGE_MODERATION_MODE, ver
  // src/lib/image-moderation.ts), nunca inferida pela ausência de chave.
  // Enquanto o modo for "manual" (padrão do lançamento inicial -- sem
  // provider pago ligado ainda), a foto nasce já liberada
  // (manual_approved), pra nunca bloquear publicação por falta de
  // crédito/API. is_cover pode nascer true mesmo em modo "openai"/pending
  // (é só o "slot" pretendido) -- quem decide se ela conta pra valer como
  // capa pública é sempre moderation_status, checado em
  // validate_tour_for_publishing e nas rotas públicas, nunca aqui.
  const mode = getImageModerationMode();
  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("tour_photos")
    .insert({
      company_id,
      tour_id: tourId,
      storage_path: storagePath,
      position: count ?? 0,
      is_cover: isFirstPhoto,
      moderation_status: mode === "openai" ? "pending" : "manual_approved",
      moderation_provider: mode === "openai" ? null : "manual",
      moderation_checked_at: mode === "openai" ? null : nowIso,
      width,
      height,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  // moderação roda aqui mesmo, aguardada -- nada de fila/job separado (a API
  // da OpenAI responde em segundos, não precisa de infraestrutura extra pra
  // isso). Quando a Server Action retorna, o operador já vê o resultado real
  // (approved/rejected/moderation_unavailable), não um "pending" parado. Em
  // modo "manual" a foto já saiu do insert liberada -- não há nada a chamar.
  if (mode === "openai") {
    await runPhotoModeration(supabase, inserted.id, storagePath);
  }

  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: mode === "openai" ? "Foto enviada e verificada." : "Foto enviada." };
}

// Reprocessa uma foto que ficou 'pending' (raro -- addTourPhoto já aguarda o
// resultado) ou 'moderation_unavailable' (falha técnica -- vale tentar de
// novo). NUNCA aceita reprocessar 'rejected' -- decisão de produto explícita:
// o operador não pode forçar rejected -> approved, só remover/substituir a
// foto (deleteTourPhoto + novo upload).
export async function retryPhotoModeration(photoId: string, tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: photo } = await supabase
    .from("tour_photos")
    .select("storage_path, moderation_status")
    .eq("id", photoId)
    .eq("company_id", company_id)
    .eq("tour_id", tourId)
    .maybeSingle();
  if (!photo) return { ok: false, message: "Foto não encontrada." };

  if (APPROVED_STATUSES.includes(photo.moderation_status)) {
    return { ok: true, message: "Esta imagem já está aprovada." };
  }
  if (photo.moderation_status === "rejected") {
    return { ok: false, message: "Esta imagem não atende às regras de publicação. Remova ou substitua a imagem para continuar." };
  }

  // Foto ficou pending/moderation_unavailable de um momento em que o modo
  // era "openai" (ou de uma falha técnica) e agora a política ativa é
  // "manual" -- libera direto, sem chamar rede nenhuma. Mesma regra central
  // de runPhotoModeration, aplicada aqui pra não precisar de um round-trip
  // via storage/OpenAI só pra decidir o que ela mesma decidiria de qualquer
  // forma.
  if (getImageModerationMode() !== "openai") {
    const { error } = await supabase
      .from("tour_photos")
      .update({
        moderation_status: "manual_approved",
        moderation_provider: "manual",
        moderation_checked_at: new Date().toISOString(),
        moderation_reason_code: null,
      })
      .eq("id", photoId)
      .eq("company_id", company_id);
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/passeios/${tourId}`);
    return { ok: true, message: "Foto liberada." };
  }

  // guarda simples contra duas moderações simultâneas da mesma foto: só
  // "reivindica" o reprocessamento se ninguém tocou moderation_checked_at nos
  // últimos 30s -- UPDATE condicional é atômico no Postgres, não precisa de
  // fila/lock separado pra isto.
  const claimCutoff = new Date(Date.now() - 30_000).toISOString();
  const { data: claimed } = await supabase
    .from("tour_photos")
    .update({ moderation_checked_at: new Date().toISOString() })
    .eq("id", photoId)
    .eq("company_id", company_id)
    .in("moderation_status", ["pending", "moderation_unavailable"])
    .or(`moderation_checked_at.is.null,moderation_checked_at.lt.${claimCutoff}`)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    return { ok: true, message: "Esta imagem já está sendo verificada." };
  }

  await runPhotoModeration(supabase, photoId, photo.storage_path);
  revalidatePath(`/passeios/${tourId}`);
  return { ok: true, message: "Verificação concluída." };
}

export async function setCoverPhoto(photoId: string, tourId: string) {
  const { supabase, id: company_id } = await companyId();
  if (!company_id) return { ok: false, message: "Sessão inválida ou usuário sem empresa." };

  const { data: photo } = await supabase
    .from("tour_photos")
    .select("moderation_status")
    .eq("id", photoId)
    .eq("company_id", company_id)
    .maybeSingle();
  if (!photo) return { ok: false, message: "Foto não encontrada." };
  if (!APPROVED_STATUSES.includes(photo.moderation_status)) {
    return { ok: false, message: "Só uma imagem aprovada pode ser definida como capa." };
  }

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

  // se apagou a capa e sobraram fotos, promove a próxima APROVADA (nunca uma
  // pending/rejected/moderation_unavailable -- evita deixar um passeio
  // publicado com is_cover apontando pra uma foto que a API pública não
  // devolve, ver DOCUMENTACAO.md)
  if (photo.is_cover) {
    const { data: next } = await supabase
      .from("tour_photos")
      .select("id")
      .eq("tour_id", tourId)
      .eq("company_id", company_id)
      .in("moderation_status", APPROVED_STATUSES)
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
