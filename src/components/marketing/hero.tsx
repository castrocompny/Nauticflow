import { ArrowRight, ExternalLink } from "lucide-react";
import { DashboardMockup } from "./dashboard-mockup";
import { MKT_LINKS } from "./plans";

const MICROCOPY = ["Sem cartão de crédito", "Configuração rápida", "Comece em poucos minutos"];

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden bg-navy text-white">
      {/* fundo decorativo */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 right-[-10%] h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute bottom-[-20%] left-[-10%] h-96 w-96 rounded-full bg-brand-light/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(45,156,255,0.12),transparent_55%)]" />
      </div>

      {/* padding-top maior que o bottom: o header e "fixed" e nao reserva espaco
          no fluxo, entao o conteudo precisa compensar a altura dele (h-16). */}
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-32 sm:px-6 sm:pb-20 sm:pt-36 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:px-8 lg:pb-28 lg:pt-44">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-light sm:text-xs">
            Sistema automatizado para turismo náutico
          </span>

          <h1 className="mt-5 font-display text-[2.1rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Sua operação náutica{" "}
            <span className="text-brand-light">no automático</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Reservas, saídas, disponibilidade, embarcações e clientes organizados em tempo real, num
            só lugar. Sem planilha, sem agenda montada à mão, sem contar vaga no papel.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={MKT_LINKS.signup}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              Começar grátis
              <ArrowRight size={20} />
            </a>
            <a
              href="#automacao"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 py-3.5 text-base font-semibold text-white transition hover:border-brand-light/50"
            >
              Ver como funciona
            </a>
          </div>

          <p className="mt-6 text-sm text-slate-400">
            {MICROCOPY.map((item, i) => (
              <span key={item}>
                {i > 0 && <span className="px-2 text-slate-600">•</span>}
                {item}
              </span>
            ))}
          </p>

          {/* CTA secundario para o marketplace oficial. Mantem o NauticFlow como
              foco principal do hero e abre o ToursFlow em uma nova aba. */}
          <a
            href={MKT_LINKS.toursflow}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex items-center gap-2 rounded-lg border border-brand-light/40 bg-brand-light/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-brand-light/70 hover:bg-brand-light/15"
          >
            Explorar passeios no ToursFlow
            <ExternalLink size={15} className="text-brand-light" />
          </a>
        </div>

        <div className="lg:pl-4">
          <DashboardMockup />
        </div>
      </div>

      {/* onda de transicao pra proxima secao (usa a cor de fundo do tema) */}
      <div aria-hidden="true" className="relative -mb-px text-app">
        <svg viewBox="0 0 1440 80" className="block w-full fill-current" preserveAspectRatio="none">
          <path d="M0 40c120-30 360-40 720-10s600 20 720-10v70H0V40Z" />
        </svg>
      </div>
    </section>
  );
}
