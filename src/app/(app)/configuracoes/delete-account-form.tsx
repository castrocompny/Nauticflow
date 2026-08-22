"use client";

import { useEffect, useState, useActionState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { deleteMyAccount } from "./actions";
import { PasswordInput } from "@/components/password-input";

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
  const [open, setOpen] = useState(false);

  const expected = isCompanyAdmin ? companyName : "EXCLUIR";
  const canSubmit = confirmText === expected && password.length > 0;

  function close() {
    setOpen(false);
    setConfirmText("");
    setPassword("");
  }

  // Esc fecha o modal -- mesmo padrao de teclado que qualquer dialog nativo
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-red-700 transition hover:border-red-300 hover:bg-red-50"
      >
        Excluir {isCompanyAdmin ? "empresa e conta" : "minha conta"}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={close}>
            <div
              className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-heading">
                  Excluir {isCompanyAdmin ? "empresa" : "conta"}
                </h2>
                <button
                  type="button"
                  onClick={close}
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surfaceHover hover:text-heading"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mb-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <p>
                  {isCompanyAdmin
                    ? "Isso apaga permanentemente a empresa: todos os usuários, embarcações, passeios, clientes, reservas e notas fiscais. Não tem como desfazer."
                    : "Isso remove seu acesso permanentemente. Não tem como desfazer."}
                </p>
              </div>

              <form action={formAction} className="space-y-3">
                {state?.error && <p className="text-xs text-danger">{state.error}</p>}

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Senha</label>
                  <PasswordInput
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Digite <span className="font-mono font-semibold text-heading">{expected}</span> pra confirmar
                  </label>
                  <input
                    name="confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-heading transition hover:bg-surfaceHover"
                  >
                    Cancelar
                  </button>
                  <Submit disabled={!canSubmit} />
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
