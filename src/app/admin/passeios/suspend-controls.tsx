"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { suspendTour, unsuspendTour } from "../actions";

export function SuspendControls({ tourId, suspended }: { tourId: string; suspended: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");

  function unsuspend() {
    startTransition(async () => {
      const res = await unsuspendTour(tourId);
      setMessage(res.message);
      if (res.ok) router.refresh();
    });
  }

  function suspend() {
    startTransition(async () => {
      const res = await suspendTour(tourId, reason);
      setMessage(res.message);
      if (res.ok) {
        setSuspending(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {message && <p className="text-xs text-danger">{message}</p>}
      {suspended ? (
        <button
          disabled={pending}
          onClick={unsuspend}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Remover suspensão
        </button>
      ) : !suspending ? (
        <button
          disabled={pending}
          onClick={() => setSuspending(true)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-danger hover:bg-red-50 disabled:opacity-60"
        >
          Suspender
        </button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo da suspensão"
            className="text-xs"
          />
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={suspend}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              Confirmar
            </button>
            <button onClick={() => setSuspending(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-body">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
