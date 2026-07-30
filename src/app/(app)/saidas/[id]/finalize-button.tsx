"use client";

import { useState, useTransition } from "react";
import { FlagTriangleRight } from "lucide-react";
import { finalizeDeparture } from "../actions";

export function FinalizeButton({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const disabled = status === "encerrada" || status === "cancelada";

  function onClick() {
    if (!window.confirm("Finalizar este passeio? A saída será marcada como encerrada.")) return;
    startTransition(async () => {
      const res = await finalizeDeparture(id);
      if (!res.ok) {
        setMsg(res.message);
        setTimeout(() => setMsg(""), 4000);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={disabled || pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-navy transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FlagTriangleRight size={16} /> {disabled ? "Passeio finalizado" : "Finalizar passeio"}
      </button>
      {msg && <span className="text-xs text-danger">{msg}</span>}
    </div>
  );
}
