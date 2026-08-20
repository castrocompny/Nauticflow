"use client";

import { useState, useTransition } from "react";
import { renewSubscription } from "./actions";
import { brl } from "@/lib/format";

type Plan = { code: string; name: string; price_cents: number; price_cents_yearly?: number | null };

export function RenewButton({
  companyId,
  plans,
  defaultCycle = "mensal",
}: {
  companyId: string;
  plans: Plan[];
  defaultCycle?: "mensal" | "anual";
}) {
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? "");
  const [cycle, setCycle] = useState<"mensal" | "anual">(defaultCycle);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  const plan = plans.find((p) => p.code === planCode);
  const price = plan ? (cycle === "anual" ? plan.price_cents_yearly ?? plan.price_cents * 10 : plan.price_cents) : 0;

  function onClick() {
    if (!window.confirm(`Confirma que o pagamento do plano ${plan?.name ?? planCode} (${cycle}, ${brl(price)}) foi recebido e quer renovar a assinatura?`))
      return;
    startTransition(async () => {
      const res = await renewSubscription(companyId, planCode, cycle);
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
          className="rounded-lg border border-line px-2 py-1.5 text-xs"
        >
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={cycle}
          onChange={(e) => setCycle(e.target.value as "mensal" | "anual")}
          className="rounded-lg border border-line px-2 py-1.5 text-xs"
        >
          <option value="mensal">Mensal</option>
          <option value="anual">Anual</option>
        </select>
        <button
          onClick={onClick}
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Renovando..." : `Renovar (${brl(price)})`}
        </button>
      </div>
      {msg && <span className="text-[11px] text-muted">{msg}</span>}
    </div>
  );
}
