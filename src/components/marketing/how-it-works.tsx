import { SectionHeading } from "./section";

const STEPS = [
  {
    n: "1",
    title: "Cadastre seus passeios e embarcações",
    desc: "Registre a frota, a capacidade comercial de cada barco e os passeios que você vende.",
  },
  {
    n: "2",
    title: "Configure dias, horários e disponibilidade",
    desc: "Defina a programação uma vez — recorrente ou por período — e o sistema monta a agenda.",
  },
  {
    n: "3",
    title: "Receba e gerencie reservas",
    desc: "Reservas do balcão, de parceiros ou do ToursFlow entram centralizadas, com a vaga já descontada.",
  },
  {
    n: "4",
    title: "Acompanhe sua operação em tempo real",
    desc: "Agenda do dia, ocupação, alertas de reserva nova e relatórios sempre atualizados.",
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-20 bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Como funciona"
          title="Do cadastro à operação no automático"
          subtitle="Quatro passos para tirar a operação da planilha. A configuração é uma vez só — o resto o sistema repete por você."
        />

        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.n} className="relative">
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-[calc(50%+2rem)] top-6 hidden h-px w-[calc(100%-4rem)] bg-gradient-to-r from-brand/40 to-transparent lg:block"
                />
              )}
              <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand font-display text-lg font-semibold text-white shadow-md shadow-brand/30">
                  {step.n}
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold text-heading">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-body">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
