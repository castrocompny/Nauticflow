"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
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
  // duas etapas antes do formulario de verdade: "expanded" so mostra a caixa vermelha
  // (o resto da tela fica normal ate alguem clicar de proposito), "open" ai sim mostra
  // o formulario com senha + confirmacao -- reduz o quanto essa area chama atencao e
  // adiciona fricção contra clique acidental
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);

  const expected = isCompanyAdmin ? companyName : "EXCLUIR";
  const canSubmit = confirmText === expected && password.length > 0;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between rounded-lg border border-line px-4 py-2.5 text-sm text-muted transition hover:bg-surfaceHover"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle size={14} />
          Zona de perigo — excluir {isCompanyAdmin ? "empresa e conta" : "minha conta"}
        </span>
        <ChevronRight size={16} />
      </button>
    );
  }

  return (
    <div className="rounded-card border border-red-200 bg-red-50/50 p-5">
      <div className="mb-2 flex items-center gap-2 text-red-700">
        <AlertTriangle size={16} />
        <h2 className="font-display font-semibold">Zona de perigo</h2>
      </div>

      {!open ? (
        <>
          <p className="mb-3 text-sm text-red-700/90">
            {isCompanyAdmin
              ? "Excluir sua conta apaga permanentemente a empresa: todos os usuários, embarcações, passeios, clientes, reservas e notas fiscais. Não tem como desfazer."
              : "Excluir sua conta remove seu acesso permanentemente. Não tem como desfazer."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
            >
              {isCompanyAdmin ? "Excluir empresa e conta" : "Excluir minha conta"}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:bg-surface"
            >
              Fechar
            </button>
          </div>
        </>
      ) : (
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
                setExpanded(false);
                setConfirmText("");
                setPassword("");
              }}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-heading transition hover:bg-surface"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
