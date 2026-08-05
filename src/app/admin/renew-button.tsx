"use client";

import { useState, useTransition } from "react";
import { renewSubscription } from "./actions";
import { brl } from "@/lib/format";

type Plan = { code: string; name: string; price_cents: number };

export function RenewButton({ companyId, plans }: { companyId: string; plans: Plan[] }) {
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function onClick() {
    const plan = plans.find((p) => p.code === planCode);
    if (!window.confirm(`Confirma que o pagamento do plano ${plan?.name ?? planCode} foi recebido e quer renovar por mais 30 dias?`))
      return;
    startTransition(async () => {
      const res = await renewSubscription(companyId, planCode);
      setMsg(res.message);
      setTimeout(() => setMsg(""), 4000);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <select
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        >
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name} · {brl(p.price_cents)}
            </option>
          ))}
        </select>
        <button
          onClick={onClick}
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Renovando..." : "Renovar +30 dias"}
        </button>
      </div>
      {msg && <span className="text-[11px] text-slate-500">{msg}</span>}
    </div>
  );
}
