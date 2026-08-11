"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { removeTeamMember } from "./actions";

export function RemoveButton({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function onClick() {
    if (!window.confirm(`Remover ${memberName}? A pessoa perde o acesso imediatamente.`)) return;
    startTransition(async () => {
      const res = await removeTeamMember(memberId);
      if (!res.ok) {
        setMsg(res.message);
        setTimeout(() => setMsg(""), 4000);
      }
    });
  }

  return (
    <div className="flex justify-end">
      <button
        onClick={onClick}
        disabled={pending}
        title="Remover colaborador"
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:border-red-200 hover:bg-red-50 hover:text-danger disabled:opacity-50"
      >
        <X size={16} />
      </button>
      {msg && <p className="mt-1 text-[11px] text-danger">{msg}</p>}
    </div>
  );
}
