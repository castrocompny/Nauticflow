import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_SIGNED_URL_TTL_SECONDS, type PublicTourDetailDTO } from "@/lib/public-api";

export const dynamic = "force-dynamic";

// GET /api/public/tours/[slug] -- detalhe completo de UM passeio publicado.
// 404 (não 500) para slug inexistente OU não publicado -- de propósito: um
// visitante anônimo nunca deve conseguir diferenciar "esse passeio não existe" de
// "existe mas está em rascunho/pausado/recusado" (mesma lógica de "not found" que
// RLS já aplica pra tabelas internas).
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!slug) return NextResponse.json({ error: "Passeio não encontrado." }, { status: 404 });

  const admin = createAdminClient();
  // Regra de visibilidade completa (ver /api/public/tours): active, não
  // suspenso administrativamente, e empresa dona não suspensa.
  // "companies!inner" pra o filtro em companies.suspended_at excluir a LINHA
  // do tour, não só o objeto aninhado.
  const { data: tour, error } = await admin
    .from("tours")
    .select("*, companies!inner(name, city, suspended_at)")
    .eq("slug", slug)
    .eq("marketplace_status", "published")
    .eq("active", true)
    .is("marketplace_suspended_at", null)
    .is("companies.suspended_at", null)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Erro ao consultar o passeio." }, { status: 500 });
  if (!tour) return NextResponse.json({ error: "Passeio não encontrado." }, { status: 404 });

  // só fotos aprovadas (approved/legacy_approved -- migration 0044) podem sair
  // na API pública; pending/rejected/moderation_unavailable nunca
  const { data: photoRows } = await admin
    .from("tour_photos")
    .select("storage_path, is_cover")
    .eq("tour_id", tour.id)
    .in("moderation_status", ["approved", "legacy_approved", "manual_approved"])
    .order("position", { ascending: true });

  // mesma regra da listagem (GET /api/public/tours): a capa é a foto marcada
  // com is_cover=true, não a primeira por posição -- "photos[0]" aqui era o bug
  // (achado na verificação do contrato da API). Fallback pra primeira só se,
  // por algum motivo, nenhuma foto estiver marcada como capa; null se não
  // houver foto nenhuma.
  const photos: string[] = [];
  let coverPhotoUrl: string | null = null;
  for (const p of photoRows ?? []) {
    const { data: signed } = await admin.storage
      .from("tour-photos")
      .createSignedUrl(p.storage_path, PHOTO_SIGNED_URL_TTL_SECONDS);
    if (!signed?.signedUrl) continue;
    photos.push(signed.signedUrl);
    if (p.is_cover) coverPhotoUrl = signed.signedUrl;
  }
  if (!coverPhotoUrl) coverPhotoUrl = photos[0] ?? null;

  const company = tour.companies as { name: string; city: string | null } | null;

  // montado campo a campo -- nunca `...tour` -- pra nunca vazar company_id,
  // marketplace_rejection_reason ou qualquer coluna interna futura sem decisão
  // explícita aqui
  const dto: PublicTourDetailDTO = {
    slug: tour.slug,
    name: tour.name,
    shortDescription: tour.short_description,
    destination: tour.destination,
    category: tour.category,
    durationMinutes: tour.duration_minutes,
    priceType: tour.price_type,
    basePriceCents: tour.base_price_cents,
    coverPhotoUrl,
    company: { name: company?.name ?? "", city: company?.city ?? null },
    description: tour.description,
    itinerary: tour.itinerary,
    included: tour.included,
    notIncluded: tour.not_included,
    importantInformation: tour.important_information,
    cancellationPolicy: tour.cancellation_policy,
    boarding: {
      name: tour.boarding_name,
      address: tour.boarding_address,
      neighborhood: tour.boarding_neighborhood,
      city: tour.boarding_city,
      state: tour.boarding_state,
      zipCode: tour.boarding_zip_code,
      reference: tour.boarding_reference,
      instructions: tour.boarding_instructions,
      latitude: tour.boarding_latitude,
      longitude: tour.boarding_longitude,
    },
    photos,
  };

  return NextResponse.json({ data: dto });
}
