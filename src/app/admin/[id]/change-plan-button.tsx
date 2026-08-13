"use client";

import { useState, useTransition } from "react";
import { changePlan } from "../actions";

type Plan = { code: string; name: string; price_cents: number };

export function ChangePlanButton({ companyId, plans, currentPlanName }: { companyId: string; plans: Plan[]; currentPlanName: string }) {
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function onClick() {
    const plan = plans.find((p) => p.code === planCode);
    if (!window.confirm(`Trocar o plano de "${currentPlanName}" pra "${plan?.name}"? Isso não mexe na data de vencimento.`))
      return;
    startTransition(async () => {
      const res = await changePlan(companyId, planCode);
      setMsg(res.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-xs">
        {plans.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-body transition hover:bg-surfaceHover disabled:opacity-60"
      >
        {pending ? "Trocando..." : "Trocar plano"}
      </button>
      {msg && <span className="text-[11px] text-muted">{msg}</span>}
    </div>
  );
}
