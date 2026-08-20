import { ArrowRight, Check } from "lucide-react";
import { MKT_LINKS } from "./plans";

export function FinalCta() {
  return (
    <section className="bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-navy px-6 py-14 text-center sm:px-12 sm:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand/30 blur-3xl" />
            <div className="absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-brand-light/20 blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Comece hoje a organizar sua empresa de passeio de barco
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Teste o NauticFlow grátis por 7 dias. Sem cartão de crédito, sem compromisso — cancele
              quando quiser.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={MKT_LINKS.signup}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-7 py-3.5 text-base font-semibold text-white transition hover:bg-brand-dark"
              >
                Teste grátis por 7 dias
                <ArrowRight size={20} />
              </a>
              <a
                href={MKT_LINKS.login}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-7 py-3.5 text-base font-semibold text-white transition hover:border-brand-light/50"
              >
                Já tenho conta
              </a>
            </div>

            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-300">
              {["7 dias grátis", "Sem cartão de crédito", "Cancele quando quiser"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check size={16} className="text-brand-light" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
