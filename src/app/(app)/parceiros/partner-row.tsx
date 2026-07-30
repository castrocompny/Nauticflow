"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { Badge } from "@/components/ui";
import { deletePartner, updatePartner, cancelPartnership, reactivatePartner } from "./actions";

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

export function PartnerRow({ p }: { p: Partner }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const [state, action] = useFormState(
    async (prev: unknown, f: FormData) => {
      const res = await updatePartner(prev, f);
      if (!res.error) setEditing(false);
      return res;
    },
    { error: "" }
  );

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
      <tr className="border-b border-slate-50 last:border-0">
        <td className="px-4 py-3 font-medium text-navy">{p.name}</td>
        <td className="px-4 py-3 text-slate-600">{typeLabel[p.type] ?? p.type}</td>
        <td className="px-4 py-3 text-slate-600">{p.contact ?? "-"}</td>
        <td className="px-4 py-3 text-center">{Number(p.commission_rate)}%</td>
        <td className="px-4 py-3 text-center">
          <Badge tone={p.active ? "green" : "slate"}>{p.active ? "ativo" : "inativo"}</Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/parceiros/${p.id}`}
              title="Histórico do parceiro"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-navy"
            >
              <History size={16} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title="Editar parceiro"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-navy"
            >
              <Pencil size={16} />
            </button>
            {p.active ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(cancelPartnership, "Cancelar esta parceria?")}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-danger transition hover:bg-red-50 disabled:opacity-50"
              >
                Cancelar parceria
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(reactivatePartner)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-ok transition hover:bg-green-50 disabled:opacity-50"
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
        <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0">
          <td colSpan={6} className="px-4 py-4">
            {state.error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
            )}
            <form action={action} className="space-y-3">
              <input type="hidden" name="id" value={p.id} />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div>
                  <label>Nome</label>
                  <input name="name" required defaultValue={p.name} className="mt-1" />
                </div>
                <div>
                  <label>Tipo</label>
                  <select name="type" className="mt-1" defaultValue={p.type}>
                    <option value="hotel">Hotel</option>
                    <option value="pousada">Pousada</option>
                    <option value="agencia">Agência</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label>Contato</label>
                  <input name="contact" defaultValue={p.contact ?? ""} className="mt-1" />
                </div>
                <div>
                  <label>Comissão (%)</label>
                  <input name="commission_rate" defaultValue={String(p.commission_rate)} className="mt-1" />
                </div>
              </div>
              <div className="flex gap-2">
                <Save />
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
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
