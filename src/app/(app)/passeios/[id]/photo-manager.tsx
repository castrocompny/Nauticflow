"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2, ArrowUp, ArrowDown, Upload } from "lucide-react";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { addTourPhoto, deleteTourPhoto, moveTourPhoto, setCoverPhoto } from "../actions";
import type { TourPhoto } from "@/lib/types";

type PhotoWithUrl = TourPhoto & { signedUrl: string | null };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
        const { error: uploadError } = await supabase.storage.from("tour-photos").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (uploadError) {
          setError(`Erro ao enviar ${file.name}: ${uploadError.message}`);
          continue;
        }
        const res = await addTourPhoto(tourId, path);
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
          {photos.map((p, i) => (
            <div key={p.id} className="overflow-hidden rounded-lg border border-line">
              <div className="relative aspect-video bg-surfaceHover">
                {p.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- imagem vem de signed URL do Storage, sem domínio fixo pra configurar no next/image
                  <img src={p.signedUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-muted">indisponível</div>
                )}
                {p.is_cover && (
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-medium text-white">
                    Capa
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-1.5">
                <div className="flex gap-1">
                  <button
                    type="button"
                    title="Definir como capa"
                    disabled={p.is_cover || pending}
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
          ))}
        </div>
      )}
    </Card>
  );
}
