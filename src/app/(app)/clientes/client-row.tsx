"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { deleteClient, updateClient } from "./actions";
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

export function ClientRow({ c }: { c: Client }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const res = await updateClient(p, f);
      if (!res.error) setEditing(false);
      return res;
    },
    { error: "" }
  );

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3 font-medium text-heading">{c.name}</td>
        <td className="px-4 py-3 text-body">{c.cpf ?? "-"}</td>
        <td className="px-4 py-3 text-body">{c.phone ?? "-"}</td>
        <td className="px-4 py-3 text-body">{c.city ?? "-"}</td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/clientes/${c.id}`}
              title="Histórico do cliente"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <History size={16} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title="Editar cliente"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <Pencil size={16} />
            </button>
            <DeleteButton action={deleteClient} id={c.id} confirmText="Excluir este cliente?" />
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-line bg-surfaceHover/60 last:border-0">
          <td colSpan={5} className="px-4 py-4">
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
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-body"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
