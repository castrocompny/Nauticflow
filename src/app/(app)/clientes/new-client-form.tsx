"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createClientRecord } from "./actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar cliente"}
    </button>
  );
}

export function NewClientForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const r = await createClientRecord(p, f);
      if (!r.error) setOpen(false);
      return r;
    },
    { error: "" }
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
      >
        + Novo cliente
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-5">
      <h3 className="mb-3 font-display font-semibold text-heading">Novo cliente</h3>
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Nome</label>
            <input name="name" required className="mt-1" />
          </div>
          <div>
            <label>CPF</label>
            <input name="cpf" className="mt-1" />
          </div>
          <div>
            <label>Telefone</label>
            <input name="phone" className="mt-1" />
          </div>
          <div>
            <label>Email</label>
            <input name="email" type="email" className="mt-1" />
          </div>
          <div>
            <label>Cidade</label>
            <input name="city" className="mt-1" />
          </div>
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
