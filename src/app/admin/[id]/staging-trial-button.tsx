"use client";

import { useState, useTransition, type FormEvent } from "react";
import { grantStagingTrial } from "../actions";

export function StagingTrialButton({ companyId }: { companyId: string }) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auditReason = reason.trim();
    if (auditReason.length < 3) {
      setMessage("Informe um motivo com pelo menos 3 caracteres.");
      return;
    }
    if (auditReason.length > 200) {
      setMessage("O motivo deve ter no máximo 200 caracteres.");
      return;
    }
    if (!window.confirm("Liberar até 7 dias de acesso de teste neste Staging, sem cobrança e sem Asaas?")) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await grantStagingTrial(companyId, auditReason);
        setMessage(result.message);
        if (result.ok) setReason("");
      } catch {
        setMessage("Não foi possível confirmar a liberação. Confira o estado antes de tentar novamente.");
      }
    });
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">Acesso temporário de teste — somente Staging</p>
      <p className="mt-1">Até 7 dias, sem cobrança e sem Asaas. Não inclua dados pessoais no motivo.</p>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <div>
          <label className="mb-1 block font-medium" htmlFor="staging-trial-reason">
            Motivo obrigatório
          </label>
          <input
            id="staging-trial-reason"
            className="w-full rounded-md border border-amber-400 bg-white px-3 py-2 text-gray-900"
            type="text"
            minLength={3}
            maxLength={200}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: validar fluxo de reservas no Preview"
          />
        </div>
        <button
          className="rounded-md bg-amber-700 px-4 py-2 font-medium text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={pending}
        >
          {pending ? "Liberando…" : "Liberar 7 dias de teste"}
        </button>
      </form>
      {message ? <p className="mt-3" role="status">{message}</p> : null}
    </section>
  );
}
