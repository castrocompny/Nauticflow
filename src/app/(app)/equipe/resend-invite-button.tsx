"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { resendInvite } from "./actions";

export function ResendInviteButton({ memberId }: { memberId: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function onClick() {
    startTransition(async () => {
      const res = await resendInvite(memberId);
      setMsg(res.message);
      setTimeout(() => setMsg(""), 4000);
    });
  }

  return (
    <div className="flex justify-end">
      <button
        onClick={onClick}
        disabled={pending}
        title="Reenviar convite"
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:border-brand/30 hover:bg-brand/5 hover:text-brand disabled:opacity-50"
      >
        <Mail size={16} />
      </button>
      {msg && <p className="mt-1 text-[11px] text-muted">{msg}</p>}
    </div>
  );
}
