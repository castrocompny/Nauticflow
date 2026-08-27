import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicDepartureDTO } from "@/lib/public-api";

export const dynamic = "force-dynamic";

const MAX_DEPARTURES = 100;

// GET /api/public/tours/[slug]/departures -- saídas futuras, não canceladas e já
// precificadas de um passeio PUBLICADO. Nunca expõe a capacidade real da
// embarcação (dado interno) -- só um booleano "soldOut" calculado no servidor.
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!slug) return NextResponse.json({ error: "Passeio não encontrado." }, { status: 404 });

  const admin = createAdminClient();
  const { data: tour, error: tourError } = await admin
    .from("tours")
    .select("id, price_type")
    .eq("slug", slug)
    .eq("marketplace_status", "published")
    .maybeSingle();

  if (tourError) return NextResponse.json({ error: "Erro ao consultar o passeio." }, { status: 500 });
  if (!tour) return NextResponse.json({ error: "Passeio não encontrado." }, { status: 404 });

  const { data: departures, error } = await admin
    .from("departures")
    .select("id, departs_at, capacity, price_cents, price_type")
    .eq("tour_id", tour.id)
    .neq("status", "cancelada")
    .gte("departs_at", new Date().toISOString())
    // saída sem preço definido ainda não está pronta pra venda no marketplace
    .not("price_cents", "is", null)
    .order("departs_at", { ascending: true })
    .limit(MAX_DEPARTURES);

  if (error) return NextResponse.json({ error: "Erro ao consultar saídas." }, { status: 500 });

  const rows = departures ?? [];
  const depIds = rows.map((d) => d.id);
  const bookedByDeparture = new Map<string, number>();

  if (depIds.length > 0) {
    // conta como ocupação: reservas confirmadas + reservas pendentes com hold
    // ainda válido (migration 0042) -- um hold vencido para de contar sozinho,
    // sem depender de nenhuma rotina de limpeza rodar antes desta consulta.
    const nowIso = new Date().toISOString();
    const { data: reservations } = await admin
      .from("reservations")
      .select("departure_id, people_count")
      .in("departure_id", depIds)
      .or(`status.eq.confirmada,and(status.eq.pendente,hold_expires_at.gt.${nowIso})`);
    for (const r of reservations ?? []) {
      const dep = r.departure_id as string;
      bookedByDeparture.set(dep, (bookedByDeparture.get(dep) ?? 0) + (r.people_count as number));
    }
  }

  const items: PublicDepartureDTO[] = rows.map((d) => ({
    id: d.id,
    departsAt: d.departs_at,
    priceCents: d.price_cents as number,
    priceType: (d.price_type as string | null) ?? tour.price_type,
    soldOut: (bookedByDeparture.get(d.id) ?? 0) >= d.capacity,
  }));

  return NextResponse.json({ data: items });
}
