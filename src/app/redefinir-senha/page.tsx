"use client";

import { useFormState, useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { updatePassword } from "./actions";
import { Logo } from "@/components/logo";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar nova senha"}
    </button>
  );
}

export default function RedefinirSenhaPage() {
  const [state, formAction] = useFormState(updatePassword, { error: "" });

  return (
    <div className="grid min-h-screen place-items-center bg-app p-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6">
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-navy px-3 py-2">
            <Logo />
          </div>
          <p className="text-sm text-muted">Defina sua nova senha</p>
        </div>

        {state?.error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle size={14} /> {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-3">
          <div>
            <label>Nova senha</label>
            <input name="password" type="password" required minLength={8} className="mt-1" placeholder="••••••••" />
            <p className="mt-1 text-[11px] text-muted">
              Mínimo 8 caracteres, com letras e números — nada de sequência (123456) ou só números (data de
              nascimento).
            </p>
          </div>
          <div>
            <label>Confirme a nova senha</label>
            <input name="confirm" type="password" required minLength={8} className="mt-1" placeholder="••••••••" />
          </div>
          <Submit />
        </form>
      </div>
    </div>
  );
}
