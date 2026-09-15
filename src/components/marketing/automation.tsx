import { Settings2, CalendarCheck, Inbox, Ship, ArrowRight, Check, Repeat } from "lucide-react";
import { SectionHeading, WindowChrome } from "./section";

// Etapas do ciclo que o operador configura UMA vez e o sistema repete sozinho.
// Tudo aqui descreve comportamento que ja existe em Producao (agenda recorrente
// com horizonte auto-estendido -- migrations 0063-0068 + cron de extensao).
const STEPS = [
  {
    icon: Settings2,
    label: "Configuração",
    desc: "Passeio, embarcação, dias da semana, horários, capacidade e preço.",
  },
  {
    icon: CalendarCheck,
    label: "Agenda automática",
    desc: "O sistema gera as saídas futuras e mantém o horizonte sempre à frente.",
  },
  {
    icon: Inbox,
    label: "Reservas",
    desc: "Cada reserva entra na saída certa e desconta a vaga na hora.",
  },
  {
    icon: Ship,
    label: "Operação organizada",
    desc: "Ocupação, frota e agenda do dia prontas, sem ninguém montar nada.",
  },
];

const AGENDA_BULLETS = [
  "Programação recorrente por dia da semana e horário",
  "Vários horários no mesmo dia, por embarcação",
  "Saídas futuras geradas automaticamente",
  "Horizonte que se estende sozinho, sem você lembrar",
  "Saída avulsa quando a operação pedir uma exceção",
  "Mudou a regra? As saídas futuras se reorganizam junto",
];

// Mockup da configuracao recorrente -> saidas geradas. Dados ilustrativos.
const DIAS = ["S", "T", "Q", "Q", "S", "S", "D"];
const DIAS_ATIVOS = [0, 2, 4, 5];
// Só o dia da semana, sem data numérica: a regra recorrente é o que está sendo
// demonstrado, e um par "Seg 16/09" fixo passa a mentir assim que o calendário
// vira o ano (16/09 deixa de cair numa segunda).
const GERADAS = [
  "Segunda · 09:00",
  "Segunda · 14:00",
  "Quarta · 09:00",
  "Sexta · 09:00",
  "Sábado · 14:00",
];

export function Automation() {
  return (
    <section id="automacao" className="scroll-mt-20 bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Automação"
          title="Configure uma vez. O NauticFlow cuida do restante."
          subtitle="Você cadastra o passeio, a embarcação, os dias, os horários, a capacidade e o preço uma única vez. A partir daí o sistema gera as saídas, mantém a agenda futura em pé, controla as vagas, acompanha a ocupação e evita conflito de embarcação — sozinho."
        />

        {/* fluxo: configuracao -> agenda -> reservas -> operacao */}
        <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.label} className="relative">
              {/* seta de ligacao, so no desktop (no mobile os cards empilham) */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-brand/50 lg:block"
                >
                  <ArrowRight size={18} />
                </span>
              )}
              <div className="flex h-full flex-col rounded-card border border-line bg-app p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <step.icon size={18} />
                  </span>
                  <span className="font-display text-[11px] font-semibold uppercase tracking-wide text-brand">
                    {step.label}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-body">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* agenda automatica: texto + mockup da regra recorrente */}
        <div className="mt-16 grid items-center gap-10 lg:mt-20 lg:grid-cols-2 lg:gap-14">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand">
              <Repeat size={16} />
              Agenda automática
            </span>
            <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
              Agenda que se organiza sozinha
            </h3>
            <p className="mt-3 text-[17px] leading-relaxed text-body">
              Defina sua programação uma vez e pare de criar saída por saída. O NauticFlow monta a
              agenda futura a partir da sua regra e vai empurrando o horizonte pra frente conforme o
              tempo passa.
            </p>
            <ul className="mt-6 space-y-2.5">
              {AGENDA_BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-[15px] leading-relaxed">
                  <Check size={17} className="mt-0.5 shrink-0 text-brand" />
                  <span className="text-body">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            aria-hidden="true"
            className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20"
          >
            <WindowChrome label="nauticflow.com.br/passeios · agenda recorrente" />
            <div className="p-4">
              <p className="text-[11px] font-semibold text-white">Programação recorrente</p>
              <p className="text-[10px] text-slate-500">Passeio Ilha Feia · Catamarã Sol</p>

              <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="mb-2 text-[9px] uppercase tracking-wide text-slate-500">
                  Dias da semana
                </p>
                <div className="flex gap-1.5">
                  {DIAS.map((d, i) => (
                    <span
                      key={i}
                      className={`flex h-6 flex-1 items-center justify-center rounded-md text-[10px] font-semibold ${
                        DIAS_ATIVOS.includes(i)
                          ? "bg-brand text-white"
                          : "bg-white/5 text-slate-600"
                      }`}
                    >
                      {d}
                    </span>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <span className="rounded-md bg-black/25 px-2 py-1.5 text-[10px] text-slate-300">
                    <span className="block text-[9px] text-slate-500">Horários</span>
                    09:00 · 14:00
                  </span>
                  <span className="rounded-md bg-black/25 px-2 py-1.5 text-[10px] text-slate-300">
                    <span className="block text-[9px] text-slate-500">Horizonte</span>
                    60 dias
                  </span>
                </div>
              </div>

              <div className="my-2.5 flex items-center justify-center gap-2 text-[9px] font-semibold uppercase tracking-wide text-brand-light">
                <span className="h-px flex-1 bg-white/10" />
                gera automaticamente
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="mb-2 text-[9px] uppercase tracking-wide text-slate-500">
                  Saídas criadas
                </p>
                <ul className="space-y-1">
                  {GERADAS.map((g) => (
                    <li key={g} className="flex items-center gap-2 text-[10px] text-slate-300">
                      <Check size={11} className="shrink-0 text-emerald-400" />
                      {g}
                    </li>
                  ))}
                  <li className="pl-[19px] text-[10px] text-slate-500">
                    + 34 saídas nos próximos 60 dias
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
