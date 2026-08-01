"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { signIn, signUp } from "./actions";
import { Logo } from "@/components/logo";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Aguarde..." : label}
    </button>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const action = mode === "in" ? signIn : signUp;
  const [state, formAction] = useFormState(action, { error: "" } as { error: string; info?: string });

  return (
    <div className="grid min-h-screen place-items-center bg-page p-6">
      <div className="w-full max-w-sm rounded-card border border-slate-200 bg-white p-6">
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-navy px-3 py-2">
            <Logo />
          </div>
          <p className="text-sm text-slate-500">
            {mode === "in" ? "Acesse sua conta" : "Crie sua empresa"}
          </p>
        </div>

        {state?.error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle size={14} /> {state.error}
          </div>
        )}
        {state?.info && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <AlertCircle size={14} /> {state.info}
          </div>
        )}

        <form action={formAction} className="space-y-3">
          {mode === "up" && (
            <>
              <div>
                <label>Seu nome</label>
                <input name="name" required className="mt-1" />
              </div>
              <div>
                <label>Nome da empresa</label>
                <input name="company" required className="mt-1" />
              </div>
            </>
          )}
          <div>
            <label>Email</label>
            <input name="email" type="email" required className="mt-1" placeholder="voce@empresa.com" />
          </div>
          <div>
            <label>Senha</label>
            <input name="password" type="password" required className="mt-1" placeholder="••••••••" />
          </div>
          <Submit label={mode === "in" ? "Entrar" : "Criar conta"} />
        </form>

        <button
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-4 w-full text-center text-sm text-brand"
        >
          {mode === "in" ? "Criar conta" : "Já tenho conta, entrar"}
        </button>
      </div>
    </div>
  );
}
