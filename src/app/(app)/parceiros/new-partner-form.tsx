"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createPartner } from "./actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar parceiro"}
    </button>
  );
}

export function NewPartnerForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const r = await createPartner(p, f);
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
        + Novo parceiro
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-5">
      <h3 className="mb-3 font-display font-semibold text-heading">Novo parceiro</h3>
      {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Nome</label>
            <input name="name" required className="mt-1" />
          </div>
          <div>
            <label>Tipo</label>
            <select name="type" className="mt-1" defaultValue="agencia">
              <option value="hotel">Hotel</option>
              <option value="pousada">Pousada</option>
              <option value="agencia">Agência</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label>Contato (telefone ou e-mail)</label>
            <input name="contact" className="mt-1" />
          </div>
          <div>
            <label>Comissão (%)</label>
            <input name="commission_rate" className="mt-1" placeholder="10" />
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
