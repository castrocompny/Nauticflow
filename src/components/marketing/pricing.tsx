"use client";

import { useCallback, useRef, useState } from "react";
import { Check } from "lucide-react";
import { MKT_PLANS, MKT_LINKS } from "./plans";

// "R$1.470" -> 1470, "R$147" -> 147 (pt-BR: "." e separador de milhar, nunca
// decimal, nos valores de origem em plans.ts -- sempre reais inteiros).
function parseBRL(value: string): number {
  return Number(value.replace("R$", "").replace(/\./g, "").replace(",", "."));
}

// Volta pro mesmo estilo tight ja usado em plans.ts ("R$147", sem espaco) --
// Intl.NumberFormat insere um espaco (na verdade NBSP) entre "R$" e o numero,
// removido aqui pra combinar com o resto da pagina.
function formatBRL(value: number): string {
  const hasCents = value % 1 !== 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/\s/g, "");
}

// Toda a matematica do anual deriva SOMENTE de `price`/`priceYear` (os dois
// valores reais de plans.ts) -- nunca de um campo separado que poderia sair
// de sincronia se algum dia so um dos dois for editado. `economiaYear`
// continua existindo em plans.ts (usado em outro lugar/histórico), mas esta
// seção não depende dele: recalcula do zero e as contas batem sozinhas.
function calcAnual(plan: { price: string; priceYear: string }) {
  const mensal = parseBRL(plan.price);
  const anual = parseBRL(plan.priceYear);
  const totalSePagoMensal = mensal * 12;
  const equivalenteMensal = anual / 12;
  const economia = totalSePagoMensal - anual;
  const percentual = Math.round((economia / totalSePagoMensal) * 100);
  return {
    mensal,
    anual,
    totalSePagoMensal,
    equivalenteMensal,
    economia,
    percentual,
  };
}

const CYCLES = [
  { id: "mensal", label: "Mensal" },
  { id: "anual", label: "Anual" },
] as const;

export function Pricing() {
  const [cycle, setCycle] = useState<"mensal" | "anual">("mensal");
  const isAnual = cycle === "anual";
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onToggleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % CYCLES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + CYCLES.length) % CYCLES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = CYCLES.length - 1;
    if (next === null) return;
    e.preventDefault();
    setCycle(CYCLES[next].id);
    tabRefs.current[next]?.focus();
  }, []);

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
            sem precisar de cartão de crédito.
          </p>
        </div>

        {/* toggle Mensal / Anual -- padrao ARIA tabs (mesmo padrao de
            booking-models.tsx: role/aria-selected + setas do teclado) */}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <div
            role="tablist"
            aria-label="Ciclo de cobrança"
            className="inline-flex rounded-lg border border-line bg-surface p-0.5"
          >
            {CYCLES.map((c, i) => {
              const selecionado = cycle === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  id={`cycle-tab-${c.id}`}
                  aria-selected={selecionado}
                  aria-controls="planos-grid"
                  tabIndex={selecionado ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  onClick={() => setCycle(c.id)}
                  onKeyDown={(e) => onToggleKeyDown(e, i)}
                  className={`nf-press rounded-md px-5 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    selecionado ? "bg-brand text-white" : "text-muted hover:text-heading"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            Anual: 2 meses grátis ({calcAnual(MKT_PLANS[0]).percentual}% de economia)
          </span>
        </div>

        <div id="planos-grid" className="mx-auto mt-12 grid max-w-5xl items-start gap-6 lg:grid-cols-3">
          {MKT_PLANS.map((plan) => {
            const c = calcAnual(plan);
            const href = `${MKT_LINKS.signup}&plan=${plan.id}${isAnual ? "&cycle=anual" : ""}`;
            // CTA sempre mostra o valor REAL cobrado na hora (nunca o
            // equivalente mensal do anual) -- ninguem deve clicar em
            // "assinar" sem saber exatamente quanto vai ser cobrado agora.
            const ctaPrice = isAnual ? `${formatBRL(c.anual)}/ano` : `${plan.price}${plan.period}`;

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

                {isAnual ? (
                  <>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="font-display text-4xl font-semibold text-heading">
                        {formatBRL(c.equivalenteMensal)}
                      </span>
                      <span className="text-muted">/mês</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">no plano anual</p>
                    <p className="mt-2 text-sm font-medium text-body">
                      {formatBRL(c.anual)} cobrados por ano
                    </p>
                    <p className="mt-1 text-xs font-medium text-brand">
                      Economize {formatBRL(c.economia)}/ano · {c.percentual}% de economia
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="font-display text-4xl font-semibold text-heading">{plan.price}</span>
                      <span className="text-muted">{plan.period}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">Cobrado mensalmente · sem compromisso anual</p>
                    <p className="mt-2 text-xs text-muted">
                      No plano anual: {formatBRL(c.equivalenteMensal)}/mês — economize {formatBRL(c.economia)} (
                      {c.percentual}%)
                    </p>
                  </>
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
                  className={`nf-press mt-8 w-full rounded-lg py-3 text-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    plan.featured
                      ? "bg-brand text-white hover:bg-brand-dark"
                      : "border border-line text-heading hover:border-brand/40 hover:text-brand"
                  }`}
                >
                  Assinar por {ctaPrice}
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
            className="nf-press inline-flex shrink-0 items-center justify-center rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Começar teste grátis
          </a>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted">
          Cobrança recorrente (mensal ou anual, cobrada integralmente no início do período). Você
          pode trocar de plano ou cancelar a qualquer momento direto no sistema.
        </p>
      </div>
    </section>
  );
}
