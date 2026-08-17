"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateClient } from "./actions";
import type { Client } from "@/lib/types";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar"}
    </button>
  );
}

export function ClientEditForm({ c, onClose }: { c: Client; onClose: () => void }) {
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const res = await updateClient(p, f);
      if (!res.error) onClose();
      return res;
    },
    { error: "" }
  );

  return (
    <>
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={c.id} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <label>Nome</label>
            <input name="name" required defaultValue={c.name} className="mt-1" />
          </div>
          <div>
            <label>CPF</label>
            <input name="cpf" defaultValue={c.cpf ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Telefone</label>
            <input name="phone" defaultValue={c.phone ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Email</label>
            <input name="email" type="email" defaultValue={c.email ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Cidade</label>
            <input name="city" defaultValue={c.city ?? ""} className="mt-1" />
          </div>
        </div>
        <div className="flex gap-2">
          <Save />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-body"
          >
            Cancelar
          </button>
        </div>
      </form>
    </>
  );
}
