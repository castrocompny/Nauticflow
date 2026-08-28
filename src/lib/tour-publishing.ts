import type { SupabaseClient } from "@supabase/supabase-js";

// Compartilhado entre a Server Action de publicar (checklist antes de tentar)
// e a Server Action de editar (tradução do erro quando o gatilho de conteúdo
// do banco recusa salvar um passeio já publicado). A REGRA em si mora só no
// banco (validate_tour_for_publishing + check_tour_public_content_violation,
// migration 0044) -- isto aqui nunca reimplementa a lógica, só chama a RPC e
// traduz code -> texto amigável pra UI. Ver DOCUMENTACAO.md.

export type PublicationIssue = {
  code: string;
  field: string | null;
  message: string;
  severity: "error" | "warning";
};

export type PublicationValidation = {
  canPublish: boolean;
  errors: PublicationIssue[];
  warnings: PublicationIssue[];
};

export async function validateTourForPublishing(
  supabase: SupabaseClient,
  tourId: string
): Promise<PublicationValidation> {
  const { data, error } = await supabase.rpc("validate_tour_for_publishing", { p_tour_id: tourId });
  if (error) {
    // erro de infraestrutura (não uma regra de negócio) -- trata como "não dá
    // pra confirmar agora", nunca deixa passar silenciosamente
    return {
      canPublish: false,
      errors: [{ code: "VALIDATION_UNAVAILABLE", field: null, message: "Não foi possível validar o passeio agora. Tente novamente.", severity: "error" }],
      warnings: [],
    };
  }
  const rows = (data ?? []) as PublicationIssue[];
  const errors = rows.filter((r) => r.severity === "error");
  const warnings = rows.filter((r) => r.severity === "warning");
  return { canPublish: errors.length === 0, errors, warnings };
}

// Mesmos códigos que check_tour_public_content_violation (SQL) pode levantar
// como exceção quando o operador tenta SALVAR (não publicar) um passeio que
// já está publicado -- ver trg_tour_content_while_published. Texto idêntico
// ao que validate_tour_for_publishing já devolve pra esses mesmos códigos,
// só duplicado aqui porque uma exceção de trigger chega como string crua
// (sqlerrm), não como linha estruturada de RPC.
export const CONTENT_VIOLATION_MESSAGES: Record<string, string> = {
  EXTERNAL_CONTACT_IN_TITLE: "Remova informações de contato ou links externos do título.",
  EXTERNAL_LINK_IN_DESCRIPTION: "Remova links externos da descrição.",
  EMAIL_IN_DESCRIPTION: "Remova o e-mail da descrição.",
  WHATSAPP_IN_DESCRIPTION: "Remova menções a WhatsApp da descrição.",
  SOCIAL_MEDIA_IN_DESCRIPTION: "Remova menções a redes sociais externas da descrição.",
  PIX_IN_DESCRIPTION: "Remova menções a PIX da descrição.",
  DIRECT_BOOKING_BYPASS: "Remova convites para reservar fora do ToursFlow.",
  PHONE_IN_DESCRIPTION: "Remova telefones da descrição.",
};

// Passeio publicado tem o conteúdo protegido pelo banco (trg_tour_content_while_
// published) -- uma tentativa de salvar chega aqui como Postgres error genérico
// (message = o code cru, ex: "EXTERNAL_LINK_IN_DESCRIPTION"). Traduz pro texto
// amigável quando reconhece o código; senão devolve a mensagem original.
export function friendlyContentErrorMessage(rawMessage: string): string {
  return CONTENT_VIOLATION_MESSAGES[rawMessage] ?? rawMessage;
}
