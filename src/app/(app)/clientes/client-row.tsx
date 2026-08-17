"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { deleteClient } from "./actions";
import type { Client } from "@/lib/types";

const ClientEditForm = dynamic(
  () => import("./client-edit-form").then((m) => m.ClientEditForm),
  { ssr: false, loading: () => <p className="text-sm text-muted">Carregando formulário...</p> }
);

export function ClientRow({ c }: { c: Client }) {
  const [editing, setEditing] = useState(false);

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
            <ClientEditForm c={c} onClose={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}
