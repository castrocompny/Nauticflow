"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { MKT_PLANS, MKT_LINKS } from "./plans";

export function Pricing() {
  const [cycle, setCycle] = useState<"mensal" | "anual">("mensal");
  const isAnual = cycle === "anual";

  return (
    <section id="planos" className="scroll-mt-20 bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand">
            Planos
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-heading sm:text-4xl">
            Um plano para cada tamanho de operação
          </h2>
          <p className="mt-4 text-lg text-body">
            Todos os planos incluem <strong className="font-semibold text-heading">7 dias de teste grátis</strong>,
            sem precisar de cartão de crédito. Mensal ou anual, cancele quando quiser.
          </p>
        </div>

        {/* toggle Mensal / Anual */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {(["mensal", "anual"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                className={`rounded-md px-5 py-2 text-sm font-semibold transition ${
                  cycle === c ? "bg-brand text-white" : "text-muted hover:text-heading"
                }`}
              >
                {c === "mensal" ? "Mensal" : "Anual"}
              </button>
            ))}
          </div>
          <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            2 meses grátis no anual
          </span>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl items-start gap-6 lg:grid-cols-3">
          {MKT_PLANS.map((plan) => {
            const price = isAnual ? plan.priceYear : plan.price;
            const period = isAnual ? "/ano" : plan.period;
            const href = `${MKT_LINKS.signup}&plan=${plan.id}${isAnual ? "&cycle=anual" : ""}`;
            return (
              <div
                key={plan.id}
                className={`relative flex h-full flex-col rounded-card border bg-surface p-7 transition ${
                  plan.featured ? "border-brand shadow-lg lg:-translate-y-3" : "border-line"
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white shadow-sm">
                    {plan.highlight}
                  </span>
                )}

                <h3 className="font-display text-xl font-semibold text-heading">{plan.name}</h3>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-semibold text-heading">{price}</span>
                  <span className="text-muted">{period}</span>
                </div>
                {isAnual ? (
                  <p className="mt-1 text-xs font-medium text-brand">
                    2 meses grátis · economize {plan.economiaYear}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">ou {plan.priceYear}/ano (2 meses grátis)</p>
                )}

                <div className="mt-4 space-y-1 text-sm font-medium text-body">
                  <p>{plan.boats}</p>
                  <p>{plan.users}</p>
                </div>

                <hr className="my-6 border-line" />

                <ul className="flex-1 space-y-3">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5 text-[15px]">
                      <Check size={16} className="mt-0.5 shrink-0 text-brand" />
                      <span className="text-body">{feat}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={href}
                  className={`mt-8 w-full rounded-lg py-3 text-center text-sm font-semibold transition ${
                    plan.featured
                      ? "bg-brand text-white hover:bg-brand-dark"
                      : "border border-line text-heading hover:border-brand/40 hover:text-brand"
                  }`}
                >
                  Assinar por {price}
                  {period}
                </a>
              </div>
            );
          })}
        </div>

        {/* Teste grátis separado dos cards: uma opção única, válida pra qualquer plano. */}
        <div className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-4 rounded-card border border-line bg-surface p-7 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="font-display text-lg font-semibold text-heading">
              Quer testar antes de assinar?
            </p>
            <p className="mt-1 text-sm text-body">
              7 dias grátis em qualquer plano, sem precisar de cartão de crédito.
            </p>
          </div>
          <a
            href={MKT_LINKS.signup}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            Começar teste grátis
          </a>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted">
          Cobrança recorrente (mensal ou anual). Você pode trocar de plano ou cancelar a qualquer
          momento direto no sistema.
        </p>
      </div>
    </section>
  );
}
