"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, AlertTriangle } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { publishTour, unpublishTour } from "../actions";
import type { Tour } from "@/lib/types";
import type { PublicationValidation, PublicationIssue } from "@/lib/tour-publishing";

// Publicação autônoma: o operador publica/despublica diretamente, sem
// aprovação do super admin. 'review'/'rejected' seguem existindo no schema
// só por compatibilidade com passeios antigos -- se um passeio legado ainda
// estiver num desses estados, o painel mostra como "Rascunho" (mesma ação:
// publicar), já que não fazem mais parte do fluxo novo.
function displayStatus(tour: Tour): "published" | "draft" {
  return tour.marketplace_status === "published" ? "published" : "draft";
}

// Checklist "pronto pra publicar?" -- os ITENS aqui são só apresentação; a
// REGRA de cada um vem inteira do banco (validate_tour_for_publishing,
// migration 0044) -- só mostra os problemas que o backend encontrou (nunca
// reimplementa a lista de critérios, pra não correr o risco de a UI "achar"
// que algo passou quando a regra real diz outra coisa).
function IssueRow({ issue }: { issue: PublicationIssue }) {
  const isWarning = issue.severity === "warning";
  return (
    <li className={`flex items-start gap-2 text-xs ${isWarning ? "text-amber-700" : "text-red-700"}`}>
      {isWarning ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <X size={14} className="mt-0.5 shrink-0" />}
      {issue.message}
    </li>
  );
}

export function PublicationPanel({
  tour,
  photoCount,
  checklist,
}: {
  tour: Tour;
  photoCount: number;
  checklist: PublicationValidation;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [publishErrors, setPublishErrors] = useState<PublicationIssue[]>([]);
  const suspended = !!tour.marketplace_suspended_at;
  const status = displayStatus(tour);

  function run(action: () => Promise<{ ok: boolean; message: string; errors?: PublicationIssue[] }>) {
    startTransition(async () => {
      const res = await action();
      setMessage(res.message);
      setPublishErrors(res.errors ?? []);
      router.refresh();
    });
  }

  return (
    <Card>
      <h3 className="mb-2 font-display text-sm font-semibold text-heading">Publicação</h3>

      {suspended ? (
        <Badge tone="red">Publicação suspensa</Badge>
      ) : (
        <Badge tone={status === "published" ? "green" : "slate"}>
          {status === "published" ? "Publicado" : "Rascunho"}
        </Badge>
      )}

      <p className="mt-2 text-xs text-muted">
        {suspended
          ? "Este passeio está temporariamente impedido de ser publicado."
          : status === "published"
            ? "Está aparecendo no ToursFlow (quando a integração for ligada)."
            : "Só você vê. Preencha os dados, adicione fotos e publique quando estiver pronto."}
      </p>

      {suspended && tour.marketplace_suspension_reason && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Motivo: {tour.marketplace_suspension_reason}
        </p>
      )}

      {tour.published_at && (
        <p className="mt-2 text-xs text-muted">Publicado pela primeira vez em {fmtDate(tour.published_at)}.</p>
      )}

      <p className="mt-3 text-xs text-muted">{photoCount} foto(s) cadastrada(s).</p>

      {/* checklist "pronto pra publicar?" -- só faz sentido mostrar enquanto
          ainda não está publicado (depois de publicado, o conteúdo já passou) */}
      {status === "draft" && !suspended && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <p className="mb-2 text-xs font-medium text-heading">Pronto para publicar?</p>
          {checklist.errors.length === 0 && checklist.warnings.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-emerald-700">
              <Check size={14} /> Tudo certo, pronto para publicar.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {checklist.errors.map((issue) => (
                <IssueRow key={issue.code} issue={issue} />
              ))}
              {checklist.warnings.map((issue) => (
                <IssueRow key={issue.code} issue={issue} />
              ))}
            </ul>
          )}
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-brand-dark">
          <p>{message}</p>
          {publishErrors.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {publishErrors.map((issue) => (
                <li key={issue.code}>• {issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* suspenso administrativamente: operador nunca vê botão pra remover a
          suspensão -- só o super admin consegue (ver /admin/passeios) */}
      {!suspended && (
        <div className="mt-4 space-y-2">
          {status === "draft" && (
            <button
              disabled={pending}
              onClick={() => run(() => publishTour(tour.id))}
              className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              Publicar passeio
            </button>
          )}
          {status === "published" && (
            <button
              disabled={pending}
              onClick={() => run(() => unpublishTour(tour.id))}
              className="w-full rounded-lg border border-line px-4 py-2 text-sm text-body hover:bg-surfaceHover disabled:opacity-60"
            >
              Despublicar passeio
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
