"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Step = "loading" | "scan" | "saving" | "error";

export function MfaSetupForm() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>("loading");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      // limpa qualquer fator TOTP não-verificado de uma tentativa anterior (recarregou a
      // página no meio do cadastro, por exemplo) -- evita acumular fatores órfãos
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Super Admin",
      });
      if (enrollError || !data) {
        setError(enrollError?.message || "Não deu pra iniciar o cadastro do segundo fator.");
        setStep("error");
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep("scan");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStep("saving");
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError(challengeError?.message || "Não deu pra gerar o desafio.");
      setStep("scan");
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setError("Código inválido. Confira o horário do celular e tente de novo.");
      setStep("scan");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  if (step === "loading") {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted">
        <Loader2 size={20} className="animate-spin" />
        Preparando o QR code...
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
        <AlertCircle size={14} /> {error}
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-3">
      <p className="text-xs text-muted">
        Escaneie o QR code com um app autenticador (Google Authenticator, Authy, 1Password...) e digite o código de
        6 dígitos gerado.
      </p>
      {qrCode && (
        <div className="flex justify-center rounded-lg border border-line bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="QR code do segundo fator" width={180} height={180} />
        </div>
      )}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Não consigo escanear o QR code</summary>
        <p className="mt-1 break-all rounded bg-surfaceHover p-2 font-mono">{secret}</p>
      </details>

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
        disabled={step === "saving" || code.length !== 6}
        className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {step === "saving" ? "Confirmando..." : "Ativar verificação em duas etapas"}
      </button>
    </form>
  );
}
