"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createTourDraft } from "./actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Criando..." : "Criar e editar detalhes"}
    </button>
  );
}

export function NewTourForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createTourDraft, { error: "" });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
      >
        + Novo passeio
      </button>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h3 className="mb-3 font-display font-semibold text-heading">Novo passeio</h3>
      {state?.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label>Nome do passeio</label>
          <input name="name" required autoFocus className="mt-1" placeholder="Ex.: Passeio de lancha pelas ilhas" />
        </div>
        <div className="flex gap-2">
          <Save />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-4 py-2 text-sm text-body">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
