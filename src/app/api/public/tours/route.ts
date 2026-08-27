import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isValidCategory,
  parsePagination,
  PHOTO_SIGNED_URL_TTL_SECONDS,
  type PublicTourListItemDTO,
} from "@/lib/public-api";

export const dynamic = "force-dynamic";

// GET /api/public/tours?destination=buzios&category=por_do_sol&page=1&limit=20
//
// Vitrine de passeios PUBLICADOS. Nunca confia em nada vindo do ToursFlow pra
// decidir o que é público -- o filtro marketplace_status='published' é sempre
// aplicado aqui, no servidor (item 21 do pedido).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const destination = searchParams.get("destination")?.trim().toLowerCase() || undefined;
  const category = searchParams.get("category")?.trim() || undefined;

  if (category && !isValidCategory(category)) {
    return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
  }

  const { page, limit, from, to } = parsePagination(searchParams);
  const admin = createAdminClient();

  let query = admin
    .from("tours")
    .select(
      "id, slug, name, short_description, destination, category, duration_minutes, price_type, base_price_cents, companies(name, city)",
      { count: "exact" }
    )
    .eq("marketplace_status", "published")
    .order("published_at", { ascending: false })
    .range(from, to);

  // filtra por índice (destination_slug, coluna gerada -- migration 0032), nunca
  // carregando tudo pra comparar em JavaScript
  if (destination) query = query.eq("destination_slug", destination);
  if (category) query = query.eq("category", category);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao consultar passeios." }, { status: 500 });
  }

  const tours = data ?? [];
  const tourIds = tours.map((t) => t.id);
  const coverByTour = new Map<string, string>();

  if (tourIds.length > 0) {
    const { data: covers } = await admin
      .from("tour_photos")
      .select("tour_id, storage_path")
      .in("tour_id", tourIds)
      .eq("is_cover", true);
    for (const c of covers ?? []) {
      const { data: signed } = await admin.storage
        .from("tour-photos")
        .createSignedUrl(c.storage_path, PHOTO_SIGNED_URL_TTL_SECONDS);
      if (signed?.signedUrl) coverByTour.set(c.tour_id as string, signed.signedUrl);
    }

    // fallback (mesma regra do detalhe, GET /api/public/tours/[slug]): passeio
    // com foto mas sem nenhuma marcada como capa (não deveria acontecer -- o app
    // sempre mantém uma capa quando há foto -- mas não custa manter as duas
    // rotas consistentes) usa a primeira foto por posição.
    const uncoveredIds = tourIds.filter((id) => !coverByTour.has(id as string));
    if (uncoveredIds.length > 0) {
      const { data: fallbackRows } = await admin
        .from("tour_photos")
        .select("tour_id, storage_path")
        .in("tour_id", uncoveredIds)
        .order("position", { ascending: true });
      const firstPathByTour = new Map<string, string>();
      for (const p of fallbackRows ?? []) {
        const tid = p.tour_id as string;
        if (!firstPathByTour.has(tid)) firstPathByTour.set(tid, p.storage_path as string);
      }
      for (const [tid, path] of firstPathByTour) {
        const { data: signed } = await admin.storage.from("tour-photos").createSignedUrl(path, PHOTO_SIGNED_URL_TTL_SECONDS);
        if (signed?.signedUrl) coverByTour.set(tid, signed.signedUrl);
      }
    }
  }

  const items: PublicTourListItemDTO[] = tours.map((t) => {
    const company = (Array.isArray(t.companies) ? t.companies[0] : t.companies) as
      | { name: string; city: string | null }
      | null
      | undefined;
    return {
      slug: t.slug as string,
      name: t.name as string,
      shortDescription: (t.short_description as string | null) ?? null,
      destination: (t.destination as string | null) ?? null,
      category: (t.category as string | null) ?? null,
      durationMinutes: (t.duration_minutes as number | null) ?? null,
      priceType: t.price_type as string,
      basePriceCents: t.base_price_cents as number,
      coverPhotoUrl: coverByTour.get(t.id as string) ?? null,
      company: { name: company?.name ?? "", city: company?.city ?? null },
    };
  });

  const total = count ?? items.length;
  return NextResponse.json({
    data: items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}
