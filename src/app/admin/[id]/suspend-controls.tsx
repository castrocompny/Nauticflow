"use client";

import { useState, useTransition } from "react";
import { suspendCompany, unsuspendCompany } from "../actions";

export function SuspendControls({
  companyId,
  suspended,
  reason,
}: {
  companyId: string;
  suspended: boolean;
  reason: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [reasonInput, setReasonInput] = useState("");
  const [msg, setMsg] = useState("");

  function onSuspend() {
    if (!window.confirm("Suspender esta empresa? Ela não vai conseguir cadastrar nada novo até você reativar."))
      return;
    startTransition(async () => {
      const res = await suspendCompany(companyId, reasonInput);
      setMsg(res.message);
    });
  }

  function onUnsuspend() {
    startTransition(async () => {
      const res = await unsuspendCompany(companyId);
      setMsg(res.message);
    });
  }

  if (suspended) {
    return (
      <div className="space-y-2">
        {reason && <p className="text-xs text-muted">Motivo: {reason}</p>}
        <button
          onClick={onUnsuspend}
          disabled={pending}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-body transition hover:bg-surfaceHover disabled:opacity-60"
        >
          {pending ? "Reativando..." : "Reativar empresa"}
        </button>
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        value={reasonInput}
        onChange={(e) => setReasonInput(e.target.value)}
        placeholder="Motivo da suspensão (opcional)"
        className="w-full rounded-lg border border-line px-3 py-1.5 text-xs"
      />
      <button
        onClick={onSuspend}
        disabled={pending}
        className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Suspendendo..." : "Suspender empresa"}
      </button>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
