"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { Badge } from "@/components/ui";
import { deletePartner, cancelPartnership, reactivatePartner } from "./actions";

const PartnerEditForm = dynamic(
  () => import("./partner-edit-form").then((m) => m.PartnerEditForm),
  { ssr: false, loading: () => <p className="text-sm text-muted">Carregando formulário...</p> }
);

type Partner = {
  id: string;
  name: string;
  type: string;
  contact: string | null;
  commission_rate: number;
  active: boolean;
};

const typeLabel: Record<string, string> = {
  hotel: "Hotel",
  pousada: "Pousada",
  agencia: "Agência",
  outro: "Outro",
};

export function PartnerRow({ p }: { p: Partner }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function run(fn: (id: string) => Promise<{ ok: boolean; message: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const res = await fn(p.id);
      if (!res.ok) {
        setMsg(res.message);
        setTimeout(() => setMsg(""), 4000);
      }
    });
  }

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3 font-medium text-heading">{p.name}</td>
        <td className="px-4 py-3 text-body">{typeLabel[p.type] ?? p.type}</td>
        <td className="px-4 py-3 text-body">{p.contact ?? "-"}</td>
        <td className="px-4 py-3 text-center">{Number(p.commission_rate)}%</td>
        <td className="px-4 py-3 text-center">
          <Badge tone={p.active ? "green" : "slate"}>{p.active ? "ativo" : "inativo"}</Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/parceiros/${p.id}`}
              title="Histórico do parceiro"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <History size={16} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title="Editar parceiro"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <Pencil size={16} />
            </button>
            {p.active ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(cancelPartnership, "Cancelar esta parceria?")}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-danger transition hover:bg-red-50 disabled:opacity-50"
              >
                Cancelar parceria
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(reactivatePartner)}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ok transition hover:bg-green-50 disabled:opacity-50"
              >
                Reativar
              </button>
            )}
            <DeleteButton action={deletePartner} id={p.id} confirmText="Excluir este parceiro?" />
          </div>
        </td>
      </tr>
      {msg && (
        <tr>
          <td colSpan={6} className="px-4 pb-2 text-right text-xs text-danger">
            {msg}
          </td>
        </tr>
      )}
      {editing && (
        <tr className="border-b border-line bg-surfaceHover/60 last:border-0">
          <td colSpan={6} className="px-4 py-4">
            <PartnerEditForm p={p} onClose={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}
