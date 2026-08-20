"use client";

import { useState, useTransition } from "react";
import { startAsaasCheckout } from "./billing-actions";

export function PayPlanButton({
  planCode,
  label,
  compact,
  billingCycle = "mensal",
}: {
  planCode: string;
  label?: string;
  compact?: boolean;
  billingCycle?: "mensal" | "anual";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function onClick() {
    setError("");
    startTransition(async () => {
      const res = await startAsaasCheckout(planCode, billingCycle);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className={compact ? "" : undefined}>
      <button
        onClick={onClick}
        disabled={pending}
        className={
          compact
            ? "rounded-lg border border-amber-300 bg-surface px-2.5 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
            : "mt-3 w-full rounded-lg bg-brand py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
        }
      >
        {pending ? "Abrindo..." : (label ?? "Pagar este plano")}
      </button>
      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
