// Utilitários compartilhados pelas rotas GET /api/public/* (vitrine somente-leitura
// pro futuro ToursFlow). Nenhuma dessas rotas usa RLS/anon: elas rodam com o client
// de service_role (createAdminClient) e filtram "marketplace_status = 'published'"
// explicitamente em código -- o "anon" do Supabase continua sem nenhum acesso direto
// às tabelas reais (companies, tours, departures, reservations...), e o payload
// devolvido é sempre montado campo a campo (nunca um `select("*")` espalhado direto
// na resposta), então nenhuma coluna nova adicionada a estas tabelas no futuro vaza
// pra fora sem alguém decidir isso aqui explicitamente.

export const PUBLIC_PAGE_SIZE_DEFAULT = 20;
export const PUBLIC_PAGE_SIZE_MAX = 50;

export const TOUR_CATEGORIES = [
  { value: "passeio_privativo", label: "Passeio privativo" },
  { value: "por_do_sol", label: "Pôr do sol" },
  { value: "praias", label: "Praias" },
  { value: "ilhas", label: "Ilhas" },
  { value: "passeio_compartilhado", label: "Passeio compartilhado" },
  { value: "outro", label: "Outro" },
] as const;

const VALID_CATEGORY_VALUES = new Set(TOUR_CATEGORIES.map((c) => c.value));

export function isValidCategory(value: string): boolean {
  return VALID_CATEGORY_VALUES.has(value as (typeof TOUR_CATEGORIES)[number]["value"]);
}

export function parsePagination(searchParams: URLSearchParams): {
  page: number;
  limit: number;
  from: number;
  to: number;
} {
  const pageRaw = Number(searchParams.get("page"));
  const limitRaw = Number(searchParams.get("limit"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, PUBLIC_PAGE_SIZE_MAX) : PUBLIC_PAGE_SIZE_DEFAULT;
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
}

export type PublicCompanyDTO = { name: string; city: string | null };

export type PublicTourListItemDTO = {
  slug: string;
  name: string;
  shortDescription: string | null;
  destination: string | null;
  category: string | null;
  durationMinutes: number | null;
  priceType: string;
  basePriceCents: number;
  coverPhotoUrl: string | null;
  company: PublicCompanyDTO;
};

export type PublicTourDetailDTO = PublicTourListItemDTO & {
  description: string | null;
  itinerary: string | null;
  included: string | null;
  notIncluded: string | null;
  importantInformation: string | null;
  cancellationPolicy: string | null;
  boarding: {
    name: string | null;
    address: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    reference: string | null;
    instructions: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  photos: string[];
};

export type PublicDepartureDTO = {
  id: string;
  departsAt: string;
  priceCents: number;
  priceType: string;
  soldOut: boolean;
};

// 1h -- curto o bastante pra não incomodar se o bucket precisar virar privado de
// verdade um dia, longo o bastante pra não expirar no meio de uma navegação normal.
// Ver DOCUMENTACAO.md sobre por que isto é uma decisão v1, não definitiva.
export const PHOTO_SIGNED_URL_TTL_SECONDS = 3600;
