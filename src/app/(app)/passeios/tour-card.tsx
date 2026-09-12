"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { archiveTour } from "./actions";
import type { Tour, TourMarketplaceStatus } from "@/lib/types";

const statusBadge: Record<TourMarketplaceStatus, { label: string; tone: "green" | "amber" | "red" | "slate" }> = {
  draft: { label: "Rascunho", tone: "slate" },
  review: { label: "Em revisão", tone: "amber" },
  published: { label: "Publicado", tone: "green" },
  paused: { label: "Pausado", tone: "amber" },
  rejected: { label: "Recusado", tone: "red" },
};

// A lixeira precisa ficar FORA do <Link> (botão dentro de link aninhado é
// HTML inválido e quebra o clique de um dos dois de forma imprevisível no
// navegador) -- por isso Link e botão são IRMÃOS dentro de um wrapper
// `relative`, com o botão posicionado por cima via `absolute`. Clicar nele
// nunca aciona a navegação do Link porque ele simplesmente não é
// descendente do Link -- não precisa de stopPropagation pra isso funcionar.
export function TourCard({ tour }: { tour: Tour }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const badge = statusBadge[tour.marketplace_status];
  const isPublished = tour.marketplace_status === "published";

  function close() {
    if (pending) return;
    setConfirming(false);
    setError("");
  }

  // Esc fecha o modal -- mesmo padrão já usado em delete-account-form.tsx
  useEffect(() => {
    if (!confirming) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming]);

  function confirmDelete() {
    startTransition(async () => {
      const res = await archiveTour(tour.id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <Link href={`/passeios/${tour.id}`} className="block h-full">
        <Card className="h-full transition hover:border-brand">
          <div className="flex items-start justify-between gap-2 pr-8">
            <p className="font-display font-semibold text-heading">{tour.name}</p>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">{tour.destination || "Destino não informado"}</p>
        </Card>
      </Link>

      <button
        type="button"
        title="Excluir passeio"
        onClick={() => setConfirming(true)}
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-red-50 hover:text-danger"
      >
        <Trash2 size={16} />
      </button>

      {confirming &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={close}>
            <div
              className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-heading">Excluir passeio?</h2>
                <button
                  type="button"
                  onClick={close}
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surfaceHover hover:text-heading"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-sm text-muted">
                {isPublished
                  ? "Este passeio será removido imediatamente do ToursFlow e da sua lista. Reservas e histórico serão preservados."
                  : "Este passeio será removido da sua lista. O histórico será preservado."}
              </p>

              {error && <p className="mt-3 text-xs text-danger">{error}</p>}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-heading transition hover:bg-surfaceHover disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={pending}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
                >
                  {pending ? "Excluindo..." : "Excluir passeio"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
