"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { deleteMyAccount } from "./actions";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={disabled || pending}
      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Excluindo..." : "Excluir definitivamente"}
    </button>
  );
}

export function DeleteAccountForm({ isCompanyAdmin, companyName }: { isCompanyAdmin: boolean; companyName: string }) {
  const [state, formAction] = useActionState(deleteMyAccount, { error: "" });
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  // por padrao so o botao vermelho aparece (identifica que é perigoso sem ocupar a
  // tela); só ao clicar nele é que aparece o aviso + formulario com senha+confirmacao
  const [open, setOpen] = useState(false);

  const expected = isCompanyAdmin ? companyName : "EXCLUIR";
  const canSubmit = confirmText === expected && password.length > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
      >
        <AlertTriangle size={14} />
        Excluir {isCompanyAdmin ? "empresa e conta" : "minha conta"}
      </button>
    );
  }

  return (
    <div className="rounded-card border border-red-200 bg-red-50/50 p-5">
      <div className="mb-2 flex items-center gap-2 text-red-700">
        <AlertTriangle size={16} />
        <h2 className="font-display font-semibold">Zona de perigo</h2>
      </div>
      <p className="mb-3 text-sm text-red-700/90">
        {isCompanyAdmin
          ? "Excluir sua conta apaga permanentemente a empresa: todos os usuários, embarcações, passeios, clientes, reservas e notas fiscais. Não tem como desfazer."
          : "Excluir sua conta remove seu acesso permanentemente. Não tem como desfazer."}
      </p>

      <form action={formAction} className="space-y-3">
        {state?.error && <p className="text-xs text-red-700">{state.error}</p>}

        <div>
          <label className="mb-1 block text-sm text-red-700/90">Digite sua senha pra confirmar:</label>
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full max-w-sm border-red-300"
            autoComplete="current-password"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-red-700/90">
            E digite <span className="font-mono font-semibold">{expected}</span> abaixo:
          </label>
          <input
            name="confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full max-w-sm border-red-300"
            autoComplete="off"
          />
        </div>

        <div className="flex gap-2">
          <Submit disabled={!canSubmit} />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmText("");
              setPassword("");
            }}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-heading transition hover:bg-surface"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
