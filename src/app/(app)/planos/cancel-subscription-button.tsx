"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui";
import { cancelAsaasSubscription } from "../billing-actions";

export function CancelSubscriptionButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function onClick() {
    if (
      !window.confirm(
        "Cancelar sua assinatura? Você continua com acesso normal até o fim do período já pago, mas não será cobrado de novo depois disso."
      )
    )
      return;
    startTransition(async () => {
      const res = await cancelAsaasSubscription();
      if (res?.error) setResult({ ok: false, text: res.error });
      else if (res?.ok) setResult({ ok: true, text: res.message });
    });
  }

  return (
    <Card className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-heading">Não quer mais usar o NauticFlow?</p>
        <p className="text-xs text-muted">
          Cancele a assinatura pra parar de ser cobrado. Você mantém acesso até o fim do período já pago.
        </p>
      </div>
      <button
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-danger transition hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-500/10"
      >
        <X size={15} />
        {pending ? "Cancelando..." : "Cancelar assinatura"}
      </button>
      {result && (
        <p className={`w-full text-xs ${result.ok ? "text-ok" : "text-danger"}`}>{result.text}</p>
      )}
    </Card>
  );
}
