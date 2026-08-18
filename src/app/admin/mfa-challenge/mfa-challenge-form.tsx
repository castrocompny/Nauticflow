"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function MfaChallengeForm({ factorId }: { factorId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError(challengeError?.message || "Não deu pra gerar o desafio.");
      setPending(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setError("Código inválido.");
      setPending(false);
      setCode("");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      <div>
        <label>Código de 6 dígitos</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          className="mt-1 tracking-[0.3em]"
          placeholder="000000"
        />
      </div>
      <button
        disabled={pending || code.length !== 6}
        className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Verificando..." : "Confirmar"}
      </button>
    </form>
  );
}
