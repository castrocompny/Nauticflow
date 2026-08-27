import { NextResponse } from "next/server";
import { TOUR_CATEGORIES } from "@/lib/public-api";

export const dynamic = "force-dynamic";

// GET /api/public/categories -- lista fixa (é a mesma lista da constraint
// tours_category_check, migration 0032). Categoria de EXPERIÊNCIA, não de
// embarcação (vessels.type continua sendo outra coisa, interna ao NauticFlow).
export async function GET() {
  return NextResponse.json({ data: TOUR_CATEGORIES });
}
