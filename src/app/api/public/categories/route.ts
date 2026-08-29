import { NextResponse } from "next/server";
import { checkPublicApiRateLimit, TOUR_CATEGORIES } from "@/lib/public-api";

export const dynamic = "force-dynamic";

// GET /api/public/categories -- lista fixa (é a mesma lista da constraint
// tours_category_check, migration 0032). Categoria de EXPERIÊNCIA, não de
// embarcação (vessels.type continua sendo outra coisa, interna ao NauticFlow).
export async function GET() {
  if (!(await checkPublicApiRateLimit())) {
    return NextResponse.json({ error: "Muitas requisições. Tente novamente em instantes." }, { status: 429 });
  }
  return NextResponse.json({ data: TOUR_CATEGORIES });
}
