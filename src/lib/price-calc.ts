// Cálculo de total a partir de price_type -- extraído de marketplace-api.ts
// (que reexporta tudo daqui, nenhum importador existente precisou mudar)
// pra ser importável tanto por código server-only (rotas do marketplace)
// quanto por um Client Component (o formulário de Reserva de balcão, ver
// src/app/(app)/reservas/new-reservation-form.tsx) sem puxar nada Node-only
// -- marketplace-api.ts importa "crypto" no topo, o que quebraria (ou
// inflaria com polyfill) um bundle de cliente se importado direto de lá.

// price_type efetivamente vendável nesta primeira versão -- 'a_partir_de'
// existe no catálogo (migration 0039) mas não tem regra de cálculo de total
// definida, então nunca é aceito na criação de reserva do marketplace
// (decisão aprovada, não inventada aqui).
export const SELLABLE_PRICE_TYPES = ["por_pessoa", "por_grupo"] as const;
export type SellablePriceType = (typeof SELLABLE_PRICE_TYPES)[number];

export function isSellablePriceType(value: string | null | undefined): value is SellablePriceType {
  return !!value && (SELLABLE_PRICE_TYPES as readonly string[]).includes(value);
}

// cálculo com inteiros (centavos) -- nunca float para dinheiro.
export function calculateTotalCents(priceType: SellablePriceType, priceCents: number, quantity: number): number {
  if (priceType === "por_grupo") return priceCents;
  return priceCents * quantity;
}
