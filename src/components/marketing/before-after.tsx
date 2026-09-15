import { Check, X } from "lucide-react";
import { SectionHeading } from "./section";

const ANTES = [
  "Planilha que só uma pessoa sabe mexer",
  "Reserva combinada no WhatsApp e anotada depois",
  "Agenda montada saída por saída, na mão",
  "Horários espalhados entre caderno, print e memória",
  "Contagem de vagas manual — e o risco de vender a mais",
  "Informação desencontrada entre escritório, píer e tripulação",
];

const DEPOIS = [
  "Agenda gerada automaticamente a partir da sua programação",
  "Reservas centralizadas, de todos os canais, num lugar só",
  "Vagas atualizadas a cada reserva, sem ninguém recalcular",
  "Alertas em tempo real quando entra reserva nova",
  "Frota, capacidade e status de cada embarcação organizados",
  "Relatórios de reservas, receita, passageiros e ocupação",
];

export function BeforeAfter() {
  return (
    <section className="bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Antes e depois"
          title={
            <>
              Menos trabalho manual.
              <br className="hidden sm:block" /> Mais controle da operação.
            </>
          }
          subtitle="A maior parte do tempo de uma operação náutica some em tarefa repetitiva. O NauticFlow tira isso do seu dia."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          {/* antes */}
          <div className="rounded-card border border-line bg-surface p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500 dark:bg-red-500/15">
                <X size={20} />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Hoje</p>
                <h3 className="font-display text-lg font-semibold text-heading">
                  Operação no improviso
                </h3>
              </div>
            </div>
            <ul className="mt-6 space-y-3.5">
              {ANTES.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] leading-relaxed">
                  <X size={17} className="mt-0.5 shrink-0 text-red-500/80" />
                  <span className="text-muted">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* depois */}
          <div className="rounded-card border border-brand/30 bg-surface p-6 shadow-lg shadow-brand/5 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Check size={20} />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                  Com o NauticFlow
                </p>
                <h3 className="font-display text-lg font-semibold text-heading">
                  Operação no automático
                </h3>
              </div>
            </div>
            <ul className="mt-6 space-y-3.5">
              {DEPOIS.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] leading-relaxed">
                  <Check size={17} className="mt-0.5 shrink-0 text-brand" />
                  <span className="text-body">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
