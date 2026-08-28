import type { SupabaseClient } from "@supabase/supabase-js";

// Módulo server-only (nunca importado por um "use client" -- só por Server
// Actions, mesma convenção já usada em src/lib/marketplace-api.ts). Não
// depende do pacote `server-only`: a proteção real já existe no próprio
// Next.js (env sem prefixo NEXT_PUBLIC_ nunca entra no bundle do navegador),
// e o projeto não usa esse pacote em nenhum outro lugar -- adicionar uma
// dependência nova só por reforço simbólico não foi considerado necessário.
//
// Responsabilidade única: dado o storage_path de uma foto (bucket privado
// tour-photos), buscar os bytes (autenticado, respeitando a MESMA RLS de
// Storage que já protege a foto -- nunca gera signed URL, nunca expõe a foto
// por link nenhum), mandar pra moderação da OpenAI, e devolver um resultado
// tipado. Quem chama decide o que fazer com o resultado (ver
// src/app/(app)/passeios/actions.ts).

export type ModerationOutcome = {
  status: "approved" | "rejected" | "moderation_unavailable" | "manual_approved";
  reasonCode: string | null;
};

export type ImageModerationMode = "manual" | "openai";

// Política explícita, NUNCA inferida pela ausência da chave -- decisão de
// produto (ver DOCUMENTACAO.md): lançamento inicial usa moderação manual
// (super_admin monitora via suspensão de passeio, ver
// src/app/admin/passeios), sem depender de crédito/provider pago. Qualquer
// valor diferente de "openai" (incluindo ausente/vazio/typo) cai em "manual"
// de propósito -- é o modo seguro que nunca bloqueia upload nem chama rede
// externa por engano; só liga a chamada real à OpenAI com configuração
// explícita e correta.
export function getImageModerationMode(): ImageModerationMode {
  return process.env.IMAGE_MODERATION_MODE === "openai" ? "openai" : "manual";
}

const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const OPENAI_MODERATION_TIMEOUT_MS = 10_000;

// Categorias que a OpenAI devolve usam "/" e "-" (ex: "sexual/minors",
// "self-harm/intent") -- normaliza pro formato usado no resto do projeto
// (snake_case simples, ver migration 0044). "other_policy" cobre o caso raro
// de flagged=true sem nenhuma categoria específica marcada true.
function normalizeCategoryCode(rawCategory: string): string {
  return rawCategory.replace(/[/-]/g, "_");
}

// Função PURA (nenhum I/O) -- só interpreta a resposta já recebida. Existe
// separada de propósito: é o que os testes (scratchpad, sem chamar a OpenAI
// de verdade) exercitam direto, com JSON de exemplo.
export function interpretOpenAiModerationResponse(json: unknown): ModerationOutcome {
  if (!json || typeof json !== "object") return { status: "moderation_unavailable", reasonCode: null };

  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) {
    return { status: "moderation_unavailable", reasonCode: null };
  }

  const result = results[0] as { flagged?: unknown; categories?: unknown };
  if (typeof result.flagged !== "boolean") {
    return { status: "moderation_unavailable", reasonCode: null };
  }
  if (!result.flagged) {
    return { status: "approved", reasonCode: null };
  }

  const categories = result.categories && typeof result.categories === "object" ? (result.categories as Record<string, unknown>) : {};
  const flaggedCategory = Object.entries(categories).find(([, isFlagged]) => isFlagged === true)?.[0];
  return { status: "rejected", reasonCode: flaggedCategory ? normalizeCategoryCode(flaggedCategory) : "other_policy" };
}

// Chamada de rede propriamente dita -- NUNCA aprova por fallback. Sem
// OPENAI_API_KEY configurada (dev local, ambiente sem o provider ligado ainda),
// timeout, 429/5xx, erro de rede, ou JSON que não bate com o formato esperado:
// tudo vira 'moderation_unavailable', nunca 'approved'.
// Exportada (não só de uso interno) pra poder ser testada isoladamente
// mockando `fetch` global -- ver testes em DOCUMENTACAO.md -- sem precisar de
// client de Supabase nenhum (só esta função depende de rede).
export async function callOpenAiModeration(imageDataUri: string): Promise<ModerationOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: "moderation_unavailable", reasonCode: null };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_MODERATION_TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_MODERATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODERATION_MODEL,
        input: [{ type: "image_url", image_url: { url: imageDataUri } }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 429/5xx/401/etc -- nunca aprova, nunca expõe detalhe da resposta (log
      // só o status, nunca o corpo, que pode conter texto de erro da OpenAI)
      return { status: "moderation_unavailable", reasonCode: null };
    }

    const json = await res.json().catch(() => null);
    return interpretOpenAiModerationResponse(json);
  } catch {
    // timeout (AbortError) ou qualquer erro de rede
    return { status: "moderation_unavailable", reasonCode: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Orquestra o fluxo completo: baixa os bytes (autenticado, RLS aplicada pelo
// client de sessão passado), chama a OpenAI, grava o resultado em
// tour_photos. Nunca lança -- sempre termina gravando um status final
// (inclusive em caso de falha de download, que também vira
// moderation_unavailable, nunca deixa a foto presa em 'pending' pra sempre
// sem nenhum registro do que aconteceu).
//
// Defesa em profundidade: mesmo que algum chamador esqueça de checar o modo
// antes de invocar esta função, ela mesma nunca chama a rede da OpenAI fora
// do modo "openai" -- evita gasto/chamada inesperada por engano de código
// futuro, sem duplicar a decisão de política em cada callsite.
export async function runPhotoModeration(supabase: SupabaseClient, photoId: string, storagePath: string): Promise<void> {
  if (getImageModerationMode() !== "openai") {
    await supabase
      .from("tour_photos")
      .update({
        moderation_status: "manual_approved",
        moderation_provider: "manual",
        moderation_checked_at: new Date().toISOString(),
        moderation_reason_code: null,
      })
      .eq("id", photoId);
    return;
  }

  let outcome: ModerationOutcome;

  const { data: file, error: downloadError } = await supabase.storage.from("tour-photos").download(storagePath);
  if (downloadError || !file) {
    outcome = { status: "moderation_unavailable", reasonCode: null };
  } else {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mime = file.type || "image/jpeg";
    outcome = await callOpenAiModeration(`data:${mime};base64,${base64}`);
  }

  await supabase
    .from("tour_photos")
    .update({
      moderation_status: outcome.status,
      moderation_provider: "openai",
      moderation_checked_at: new Date().toISOString(),
      moderation_reason_code: outcome.reasonCode,
    })
    .eq("id", photoId);
}
