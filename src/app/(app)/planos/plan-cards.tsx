"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui";
import { brl, fmtDate } from "@/lib/format";
import { PayPlanButton } from "../pay-plan-button";

const commonFeatures = [
  "Dashboard com indicadores do dia",
  "Reservas com controle de vagas em tempo real",
  "Agenda e saídas programadas",
  "Cadastro de clientes e parceiros",
  "Financeiro e relatórios",
  "Manifesto de passageiros e voucher automático por e-mail",
];

const planExtras: Record<string, string[]> = {
  start: [],
  profissional: ["Suporte prioritário"],
  premium: ["Suporte prioritário"],
};

type Plan = {
  code: string;
  name: string;
  price_cents: number;
  price_cents_yearly: number | null;
  max_vessels: number | null;
  max_users: number | null;
};

export function PlanCards({
  plans,
  currentPlanCode,
  currentBillingCycle,
  preselected,
  initialCycle,
  precisaRenovarLogo,
  paidUntilISO,
}: {
  plans: Plan[];
  currentPlanCode?: string;
  currentBillingCycle: "mensal" | "anual";
  preselected?: string;
  initialCycle: "mensal" | "anual";
  precisaRenovarLogo: boolean;
  paidUntilISO: string | null;
}) {
  const [cycle, setCycle] = useState<"mensal" | "anual">(initialCycle);
  const isAnual = cycle === "anual";

  return (
    <>
      {/* toggle Mensal / Anual */}
      <div className="mb-5 flex items-center justify-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(["mensal", "anual"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                cycle === c ? "bg-brand text-white" : "text-muted hover:text-heading"
              }`}
            >
              {c === "mensal" ? "Mensal" : "Anual"}
            </button>
          ))}
        </div>
        <span className="rounded-full bg-ok/10 px-2.5 py-1 text-xs font-semibold text-ok">
          2 meses grátis no anual
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.code === currentPlanCode;
          const isPreselected = !isCurrent && p.code === preselected;
          const yearly = p.price_cents_yearly ?? p.price_cents * 10;
          const price = isAnual ? yearly : p.price_cents;
          return (
            <Card
              key={p.code}
              className={isCurrent || isPreselected ? "border-brand ring-2 ring-brand/25" : ""}
            >
              {isCurrent && (
                <p className="mb-1 text-xs font-semibold text-brand">
                  SEU PLANO ATUAL · {currentBillingCycle === "anual" ? "ANUAL" : "MENSAL"}
                </p>
              )}
              {isPreselected && (
                <p className="mb-1 text-xs font-semibold text-brand">PLANO ESCOLHIDO NO SITE</p>
              )}
              <p className="font-display text-lg font-semibold text-heading">{p.name}</p>
              <p className="mt-1 font-display text-3xl font-semibold text-brand">
                {brl(price)}
                <span className="text-sm font-normal text-muted">{isAnual ? "/ano" : "/mês"}</span>
              </p>
              {isAnual && (
                <p className="mt-1 text-xs text-muted">
                  equivale a {brl(Math.round(yearly / 12))}/mês · economize {brl(p.price_cents * 12 - yearly)}
                </p>
              )}

              <ul className="mt-4 space-y-2 text-sm text-body">
                <li className="flex items-center gap-2">
                  <Check size={16} className="shrink-0 text-ok" />
                  {p.max_vessels != null ? `até ${p.max_vessels} embarcação(ões)` : "embarcações ilimitadas"}
                </li>
                <li className="flex items-center gap-2">
                  <Check size={16} className="shrink-0 text-ok" />
                  {p.max_users != null ? `até ${p.max_users} usuário(s)` : "usuários ilimitados"}
                </li>
                {commonFeatures.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check size={16} className="shrink-0 text-ok" />
                    {f}
                  </li>
                ))}
                {(planExtras[p.code] ?? []).map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check size={16} className="shrink-0 text-ok" />
                    {f}
                  </li>
                ))}
              </ul>

              {isCurrent && !precisaRenovarLogo ? (
                <p className="mt-3 text-center text-xs text-muted">
                  Ativo até{" "}
                  <span className="font-medium text-heading">{fmtDate(paidUntilISO!)}</span>
                </p>
              ) : (
                <PayPlanButton
                  planCode={p.code}
                  billingCycle={cycle}
                  label={isCurrent ? "Renovar plano" : undefined}
                />
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
