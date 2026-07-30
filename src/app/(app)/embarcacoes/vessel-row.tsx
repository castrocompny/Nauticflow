"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { Badge } from "@/components/ui";
import { deleteVessel, updateVessel } from "./actions";
import type { Vessel } from "@/lib/types";

const typeLabel: Record<string, string> = {
  escuna: "Escuna",
  lancha: "Lancha",
  jet_ski: "Jet ski",
  catamara: "Catamarã",
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

export function VesselRow({ v }: { v: Vessel }) {
  const [editing, setEditing] = useState(false);
  const [official, setOfficial] = useState(v.official_capacity);
  const [crew, setCrew] = useState(v.default_crew);
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const res = await updateVessel(p, f);
      if (!res.error) setEditing(false);
      return res;
    },
    { error: "" }
  );
  const commercial = Math.max(official - crew, 0);

  return (
    <>
      <tr className="border-b border-slate-50 last:border-0">
        <td className="px-4 py-3 font-medium text-navy">{v.name}</td>
        <td className="px-4 py-3 text-slate-600">{typeLabel[v.type]}</td>
        <td className="px-4 py-3 text-center">{v.official_capacity}</td>
        <td className="px-4 py-3 text-center font-medium">{v.commercial_capacity}</td>
        <td className="px-4 py-3 text-right">
          <Badge tone={v.status === "ativa" ? "green" : "slate"}>{v.status}</Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/embarcacoes/${v.id}`}
              title="Histórico da embarcação"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-navy"
            >
              <History size={16} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title="Editar embarcação"
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-navy"
            >
              <Pencil size={16} />
            </button>
            <DeleteButton action={deleteVessel} id={v.id} confirmText="Excluir esta embarcação?" />
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0">
          <td colSpan={6} className="px-4 py-4">
            {state.error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
            )}
            <form action={action} className="space-y-3">
              <input type="hidden" name="id" value={v.id} />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <div>
                  <label>Nome</label>
                  <input name="name" required defaultValue={v.name} className="mt-1" />
                </div>
                <div>
                  <label>Tipo</label>
                  <select name="type" className="mt-1" defaultValue={v.type}>
                    <option value="escuna">Escuna</option>
                    <option value="lancha">Lancha</option>
                    <option value="jet_ski">Jet ski</option>
                    <option value="catamara">Catamarã</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label>Capacidade oficial</label>
                  <input
                    name="official_capacity"
                    type="number"
                    min={1}
                    value={official}
                    onChange={(e) => setOfficial(Number(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label>Tripulação padrão</label>
                  <input
                    name="default_crew"
                    type="number"
                    min={0}
                    value={crew}
                    onChange={(e) => setCrew(Number(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label>Arqueação bruta</label>
                  <input name="gross_tonnage" type="number" step="0.01" defaultValue={v.gross_tonnage ?? ""} className="mt-1" />
                </div>
                <div>
                  <label>Registro / TIE</label>
                  <input name="registration" defaultValue={v.registration ?? ""} className="mt-1" />
                </div>
              </div>
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-brand-dark">
                Capacidade comercial: <strong>{commercial}</strong> (oficial menos tripulação)
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
