"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2, ArrowUp, ArrowDown, Upload, RotateCw } from "lucide-react";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { addTourPhoto, deleteTourPhoto, moveTourPhoto, setCoverPhoto, retryPhotoModeration } from "../actions";
import type { TourPhoto } from "@/lib/types";

type PhotoWithUrl = TourPhoto & { signedUrl: string | null };

const APPROVED_STATUSES = new Set(["approved", "legacy_approved", "manual_approved"]);

// Rótulo/estilo do estado de moderação -- só apresentação, a REGRA de quem
// conta como aprovada mora inteira no banco (moderation_status +
// validate_tour_for_publishing, migration 0044). manual_approved não ganha
// badge de "aprovada pela IA" nenhum -- de propósito, pra nunca passar a
// impressão de que houve uma análise automática que não aconteceu.
const MODERATION_BADGE: Record<TourPhoto["moderation_status"], { label: string; tone: string } | null> = {
  pending: { label: "Verificando imagem...", tone: "bg-amber-500/90 text-white" },
  approved: null,
  legacy_approved: null,
  manual_approved: null,
  rejected: { label: "Imagem não aprovada", tone: "bg-red-600/90 text-white" },
  moderation_unavailable: { label: "Não foi possível verificar", tone: "bg-slate-500/90 text-white" },
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Lê a resolução real do arquivo NO NAVEGADOR antes do upload -- decisão de
// arquitetura pra validação de publicação (ver DOCUMENTACAO.md): baixar e
// processar cada imagem no servidor toda vez que o passeio for publicado
// custaria caro e escalaria mal; capturar 1 vez aqui, no upload, é grátis
// (o arquivo já está na memória do navegador) e guarda o dado pronto pra
// sempre. Falha silenciosa (null/null) se o navegador não conseguir decodificar
// -- nunca bloqueia o upload em si por causa disso.
function readImageDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    img.src = url;
  });
}

export function PhotoManager({
  tourId,
  companyId,
  photos,
}: {
  tourId: string;
  companyId: string;
  photos: PhotoWithUrl[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setUploading(true);
    const supabase = createClient();
    try {
      for (const file of Array.from(files)) {
        if (!ALLOWED_TYPES.has(file.type)) {
          setError(`Formato não suportado: ${file.name}. Use PNG, JPEG ou WEBP.`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(`${file.name} é maior que 10MB.`);
          continue;
        }
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${companyId}/${tourId}/${crypto.randomUUID()}.${ext}`;
        const [{ error: uploadError }, dimensions] = await Promise.all([
          supabase.storage.from("tour-photos").upload(path, file, { cacheControl: "3600", upsert: false }),
          readImageDimensions(file),
        ]);
        if (uploadError) {
          setError(`Erro ao enviar ${file.name}: ${uploadError.message}`);
          continue;
        }
        const res = await addTourPhoto(tourId, path, dimensions.width, dimensions.height);
        if (!res.ok) setError(res.message);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    }
  }

  return (
    <Card>
      <h3 className="mb-3 font-display text-sm font-semibold text-heading">Fotos</h3>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line py-6 text-sm text-muted hover:bg-surfaceHover">
        <Upload size={16} />
        {uploading ? "Enviando..." : "Clique para enviar fotos (PNG, JPEG ou WEBP, até 10MB cada)"}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleUpload(e.target.files)}
        />
      </label>

      {photos.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => {
            const approved = APPROVED_STATUSES.has(p.moderation_status);
            const badge = MODERATION_BADGE[p.moderation_status];
            const canRetry = p.moderation_status === "pending" || p.moderation_status === "moderation_unavailable";
            return (
              <div key={p.id} className="overflow-hidden rounded-lg border border-line">
                <div className="relative aspect-video bg-surfaceHover">
                  {p.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagem vem de signed URL do Storage, sem domínio fixo pra configurar no next/image
                    <img src={p.signedUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-muted">indisponível</div>
                  )}
                  {p.is_cover && approved && (
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-medium text-white">
                      Capa
                    </span>
                  )}
                  {badge && (
                    <span className={`absolute bottom-1.5 left-1.5 right-1.5 rounded-md px-1.5 py-1 text-center text-[10px] font-medium ${badge.tone}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                {p.moderation_status === "rejected" && (
                  <p className="border-t border-line bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                    Esta imagem não atende às regras de publicação. Remova ou substitua a imagem para continuar.
                  </p>
                )}
                {p.moderation_status === "moderation_unavailable" && (
                  <p className="border-t border-line bg-slate-50 px-2 py-1.5 text-[11px] text-muted">
                    Não foi possível verificar esta imagem agora. Tente novamente em alguns minutos.
                  </p>
                )}
                <div className="flex items-center justify-between gap-1 p-1.5">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      title={approved ? "Definir como capa" : "Só uma imagem aprovada pode ser capa"}
                      disabled={p.is_cover || pending || !approved}
                      onClick={() => startTransition(async () => { await setCoverPhoto(p.id, tourId); router.refresh(); })}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surfaceHover disabled:opacity-30"
                    >
                      <Star size={14} />
                    </button>
                    <button
                      type="button"
                      title="Mover para cima"
                      disabled={i === 0 || pending}
                      onClick={() => startTransition(async () => { await moveTourPhoto(p.id, tourId, "up"); router.refresh(); })}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surfaceHover disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      title="Mover para baixo"
                      disabled={i === photos.length - 1 || pending}
                      onClick={() => startTransition(async () => { await moveTourPhoto(p.id, tourId, "down"); router.refresh(); })}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surfaceHover disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                    {canRetry && (
                      <button
                        type="button"
                        title="Tentar novamente"
                        disabled={pending}
                        onClick={() => startTransition(async () => { await retryPhotoModeration(p.id, tourId); router.refresh(); })}
                        className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surfaceHover disabled:opacity-30"
                      >
                        <RotateCw size={14} />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Excluir"
                    disabled={pending}
                    onClick={() => startTransition(async () => { await deleteTourPhoto(p.id, tourId); router.refresh(); })}
                    className="grid h-7 w-7 place-items-center rounded-md text-danger hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
