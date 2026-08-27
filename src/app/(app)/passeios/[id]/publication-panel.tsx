"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { pauseTour, resumeTour, submitTourForReview, withdrawTourFromReview } from "../actions";
import type { Tour, TourMarketplaceStatus } from "@/lib/types";

const statusInfo: Record<TourMarketplaceStatus, { label: string; tone: "green" | "amber" | "red" | "slate"; hint: string }> = {
  draft: { label: "Rascunho", tone: "slate", hint: "Só você vê. Preencha os dados e envie para revisão quando estiver pronto." },
  review: { label: "Em revisão", tone: "amber", hint: "Um administrador do NauticFlow vai avaliar antes de publicar no ToursFlow." },
  published: { label: "Publicado", tone: "green", hint: "Pronto para aparecer no ToursFlow (quando a integração for ligada)." },
  paused: { label: "Pausado", tone: "amber", hint: "Não aparece na vitrine até você reativar." },
  rejected: { label: "Recusado", tone: "red", hint: "Ajuste conforme o motivo abaixo e envie para revisão novamente." },
};

export function PublicationPanel({ tour, photoCount }: { tour: Tour; photoCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const info = statusInfo[tour.marketplace_status];

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await action();
      setMessage(res.message);
      router.refresh();
    });
  }

  return (
    <Card>
      <h3 className="mb-2 font-display text-sm font-semibold text-heading">Publicação</h3>
      <Badge tone={info.tone}>{info.label}</Badge>
      <p className="mt-2 text-xs text-muted">{info.hint}</p>

      {tour.marketplace_status === "rejected" && tour.marketplace_rejection_reason && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Motivo: {tour.marketplace_rejection_reason}
        </p>
      )}

      {tour.published_at && (
        <p className="mt-2 text-xs text-muted">Publicado pela primeira vez em {fmtDate(tour.published_at)}.</p>
      )}

      <p className="mt-3 text-xs text-muted">{photoCount} foto(s) cadastrada(s).</p>

      {message && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-brand-dark">{message}</p>}

      <div className="mt-4 space-y-2">
        {(tour.marketplace_status === "draft" || tour.marketplace_status === "rejected") && (
          <button
            disabled={pending}
            onClick={() => run(() => submitTourForReview(tour.id))}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            Enviar para revisão
          </button>
        )}
        {tour.marketplace_status === "review" && (
          <button
            disabled={pending}
            onClick={() => run(() => withdrawTourFromReview(tour.id))}
            className="w-full rounded-lg border border-line px-4 py-2 text-sm text-body hover:bg-surfaceHover disabled:opacity-60"
          >
            Retirar da revisão
          </button>
        )}
        {tour.marketplace_status === "published" && (
          <button
            disabled={pending}
            onClick={() => run(() => pauseTour(tour.id))}
            className="w-full rounded-lg border border-line px-4 py-2 text-sm text-body hover:bg-surfaceHover disabled:opacity-60"
          >
            Pausar na vitrine
          </button>
        )}
        {tour.marketplace_status === "paused" && (
          <button
            disabled={pending}
            onClick={() => run(() => resumeTour(tour.id))}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            Reativar na vitrine
          </button>
        )}
      </div>
    </Card>
  );
}
