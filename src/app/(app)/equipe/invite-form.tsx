"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { inviteTeamMember } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Convidando..." : "Convidar"}
    </button>
  );
}

export function InviteForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const r = await inviteTeamMember(p, f);
      if (!r.error) setOpen(false);
      return r;
    },
    { error: "" } as { error: string; info?: string }
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
      >
        + Convidar colaborador
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-5">
      <h3 className="mb-3 font-display font-semibold text-heading">Convidar colaborador</h3>

      {state.error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={14} /> {state.error}
        </div>
      )}
      {state.info && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <AlertCircle size={14} /> {state.info}
        </div>
      )}

      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Nome</label>
            <input name="name" required className="mt-1" />
          </div>
          <div>
            <label>E-mail</label>
            <input name="email" type="email" required className="mt-1" placeholder="colega@empresa.com" />
          </div>
        </div>
        <div className="flex gap-2">
          <Submit />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-4 py-2 text-sm text-body">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
