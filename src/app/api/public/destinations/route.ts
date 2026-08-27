import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/public/destinations -- lista os destinos que têm ao menos um passeio
// publicado (pra alimentar /destinos/[slug] e filtros no ToursFlow). Projeta só 2
// colunas estreitas (não é "carregar tudo e filtrar em JS" -- é a única forma de
// obter distinct sem uma função de banco dedicada, aceitável no volume atual de
// passeios publicados; ver DOCUMENTACAO.md).
export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tours")
    .select("destination, destination_slug")
    .eq("marketplace_status", "published")
    .not("destination", "is", null);

  if (error) return NextResponse.json({ error: "Erro ao consultar destinos." }, { status: 500 });

  const bySlug = new Map<string, string>();
  for (const row of data ?? []) {
    const slug = row.destination_slug as string | null;
    const name = row.destination as string | null;
    if (slug && name && !bySlug.has(slug)) bySlug.set(slug, name);
  }

  const items = Array.from(bySlug, ([slug, name]) => ({ slug, name })).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );

  return NextResponse.json({ data: items });
}
