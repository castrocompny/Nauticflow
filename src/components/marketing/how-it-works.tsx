const STEPS = [
  {
    n: "1",
    title: "Cadastre sua empresa",
    desc: "Crie a conta em minutos e comece o teste grátis — sem cartão de crédito.",
  },
  {
    n: "2",
    title: "Cadastre embarcações e passeios",
    desc: "Registre suas escunas, lanchas e catamarãs, com horários e capacidade de cada saída.",
  },
  {
    n: "3",
    title: "Agende as saídas",
    desc: "Monte a agenda por horário e deixe a ocupação de cada barco visível para a equipe.",
  },
  {
    n: "4",
    title: "Receba reservas com voucher",
    desc: "Cada reserva gera o voucher automático por e-mail e entra no seu manifesto de embarque.",
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-20 bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand">
            Como funciona
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-heading sm:text-4xl">
            Do cadastro à primeira reserva
          </h2>
          <p className="mt-4 text-lg text-body">
            Quatro passos simples para tirar a operação da planilha e colocar no piloto automático.
          </p>
        </div>

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
