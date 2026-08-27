"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveTour, rejectTour } from "../actions";

export function ModerationControls({ tourId }: { tourId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    startTransition(async () => {
      const res = await approveTour(tourId);
      setMessage(res.message);
      if (res.ok) router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectTour(tourId, reason);
      setMessage(res.message);
      if (res.ok) {
        setRejecting(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {message && <p className="text-xs text-danger">{message}</p>}
      {!rejecting ? (
        <div className="flex gap-2">
          <button
            disabled={pending}
            onClick={approve}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Aprovar
          </button>
          <button
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-danger hover:bg-red-50 disabled:opacity-60"
          >
            Recusar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo da recusa"
            className="text-xs"
          />
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={reject}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              Confirmar
            </button>
            <button onClick={() => setRejecting(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-body">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
