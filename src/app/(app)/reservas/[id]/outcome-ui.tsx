"use client";

import { useState, useTransition } from "react";
import { setReservationOutcome, type ReservationOutcome } from "./outcome-actions";
import { Badge } from "@/components/ui";

const OUTCOME_LABEL: Record<ReservationOutcome, string> = {
  completed: "Concluído",
  no_show: "No-show",
};

export function OutcomeButtons({
  reservationId,
  currentOutcome,
  embarkedCount,
  absentCount,
}: {
  reservationId: string;
  currentOutcome: string | null;
  embarkedCount: number;
  absentCount: number;
}) {
  const [outcome, setOutcome] = useState(currentOutcome);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function set(next: ReservationOutcome) {
    setError("");
    startTransition(async () => {
      const result = await setReservationOutcome(reservationId, next);
      if (result.error) setError(result.error);
      else setOutcome(next);
    });
  }

  return (
    <div className="mb-5 rounded-card border border-line bg-surface p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Resultado do passeio</p>
      <p className="mb-3 text-xs text-muted">
        Evidência de embarque (não decide o resultado sozinha): {embarkedCount} embarcado(s), {absentCount} ausente(s).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {outcome && <Badge tone={outcome === "completed" ? "green" : "amber"}>{OUTCOME_LABEL[outcome as ReservationOutcome]}</Badge>}
        <button
          disabled={isPending}
          onClick={() => set("completed")}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-body transition hover:bg-surfaceHover disabled:opacity-60"
        >
          Marcar concluído
        </button>
        <button
          disabled={isPending}
          onClick={() => set("no_show")}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-body transition hover:bg-surfaceHover disabled:opacity-60"
        >
          Marcar no-show
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-2 text-xs text-muted">
        Só é possível marcar depois do horário da saída. Trocar um resultado já definido exige um administrador do sistema.
      </p>
    </div>
  );
}
