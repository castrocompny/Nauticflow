"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Pencil, History } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { Badge } from "@/components/ui";
import { deleteVessel } from "./actions";
import type { Vessel } from "@/lib/types";

const VesselEditForm = dynamic(
  () => import("./vessel-edit-form").then((m) => m.VesselEditForm),
  { ssr: false, loading: () => <p className="text-sm text-muted">Carregando formulário...</p> }
);

const typeLabel: Record<string, string> = {
  escuna: "Escuna",
  lancha: "Lancha",
  jet_ski: "Jet ski",
  catamara: "Catamarã",
  taxi_maritimo: "Táxi marítimo",
  outro: "Outro",
};

export function VesselRow({ v }: { v: Vessel }) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3 font-medium text-heading">{v.name}</td>
        <td className="px-4 py-3 text-body">{typeLabel[v.type]}</td>
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
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <History size={16} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              title="Editar embarcação"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover hover:text-heading"
            >
              <Pencil size={16} />
            </button>
            <DeleteButton action={deleteVessel} id={v.id} confirmText="Excluir esta embarcação?" />
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-line bg-surfaceHover/60 last:border-0">
          <td colSpan={6} className="px-4 py-4">
            <VesselEditForm v={v} onClose={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}
