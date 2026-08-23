"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { deleteCompanyPermanently } from "../actions";

export function DeleteCompanyControls({ companyId, companyName }: { companyId: string; companyName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function onDelete() {
    if (!window.confirm(`Excluir "${companyName}" definitivamente? Isso apaga TODOS os dados dela (embarcações, reservas, clientes, notas fiscais, usuários...) e não tem como desfazer.`))
      return;
    startTransition(async () => {
      const res = await deleteCompanyPermanently(companyId, confirmName);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.push("/admin");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-danger hover:underline">
        Excluir empresa definitivamente
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-danger/30 bg-red-50/50 p-3 dark:bg-red-500/5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
        <AlertTriangle size={14} /> Ação irreversível
      </p>
      <p className="text-xs text-muted">
        Apaga a empresa, assinatura, embarcações, passeios, reservas, clientes, parceiros, notas fiscais e os
        usuários dela. Não tem como desfazer. Digite <strong className="text-heading">{companyName}</strong> pra
        confirmar.
      </p>
      <input
        value={confirmName}
        onChange={(e) => setConfirmName(e.target.value)}
        placeholder={companyName}
        className="w-full rounded-lg border border-line px-3 py-1.5 text-xs"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={onDelete}
          disabled={pending || confirmName.trim() !== companyName.trim()}
          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Excluindo..." : "Excluir definitivamente"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setConfirmName("");
            setError("");
          }}
          disabled={pending}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-body transition hover:bg-surfaceHover"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
