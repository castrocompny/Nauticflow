import { ArrowRight, Check } from "lucide-react";
import { DashboardMockup } from "./dashboard-mockup";
import { MKT_LINKS } from "./plans";

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden bg-navy text-white">
      {/* fundo decorativo */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 right-[-10%] h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute bottom-[-20%] left-[-10%] h-96 w-96 rounded-full bg-brand-light/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(45,156,255,0.12),transparent_55%)]" />
      </div>

      {/* padding-top 16 unidades (4rem = altura do header, que agora e "fixed" e nao
          reserva espaco no fluxo) a mais que o padding-bottom -- compensa o header
          flutuando por cima, mantendo o conteudo na mesma posicao vertical de antes */}
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-32 sm:px-6 sm:pb-20 sm:pt-36 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:px-8 lg:pb-28 lg:pt-44">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-light">
            Sistema de gestão para turismo náutico
          </span>

          <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Pare de controlar reservas e saídas de barco em{" "}
            <span className="text-brand-light">planilha e WhatsApp</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
            O NauticFlow organiza agenda de saídas, reservas com voucher automático, manifesto de
            embarque e o financeiro da sua empresa de passeio de barco — tudo num só lugar, do celular
            ao computador.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={MKT_LINKS.signup}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              Teste grátis por 7 dias
              <ArrowRight size={20} />
            </a>
            <a
              href="#como-funciona"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 py-3.5 text-base font-semibold text-white transition hover:border-brand-light/50"
            >
              Ver como funciona
            </a>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
            {["Sem precisar de cartão de crédito", "Configuração em minutos", "Cancele quando quiser"].map(
              (item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check size={16} className="text-brand-light" />
                  {item}
                </li>
              )
            )}
          </ul>
        </div>

        <div>
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
