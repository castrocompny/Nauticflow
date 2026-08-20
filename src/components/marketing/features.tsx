import {
  CalendarClock,
  Ticket,
  ClipboardList,
  Ship,
  BarChart3,
  Users,
  type LucideIcon,
} from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: CalendarClock,
    title: "Agenda e controle de saídas",
    desc: "Organize as saídas por horário e veja num relance a lotação de cada embarcação no dia.",
  },
  {
    icon: Ticket,
    title: "Reservas com voucher automático",
    desc: "A cada reserva o cliente recebe o voucher por e-mail na hora, sem você digitar nada.",
  },
  {
    icon: ClipboardList,
    title: "Manifesto de embarque",
    desc: "Lista de passageiros pronta por saída — do jeito que a Capitania e a tripulação precisam.",
  },
  {
    icon: Ship,
    title: "Cadastros completos",
    desc: "Embarcações, clientes e parceiros comissionados organizados e sempre à mão.",
  },
  {
    icon: BarChart3,
    title: "Dashboard de desempenho",
    desc: "Acompanhe receita, ocupação e o ranking de parceiros e passeios que mais vendem.",
  },
  {
    icon: Users,
    title: "Vários usuários por empresa",
    desc: "Sua equipe trabalha junto, cada um com o nível de acesso certo para a função.",
  },
];

export function Features() {
  return (
    <section id="funcionalidades" className="scroll-mt-20 bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand">
            Funcionalidades
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-heading sm:text-4xl">
            Tudo o que a sua operação precisa, num sistema só
          </h2>
          <p className="mt-4 text-lg text-body">
            Feito para a rotina de quem vive de passeio de barco — da reserva ao embarque, do caixa
            ao relatório.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="group rounded-card border border-line bg-surface p-6 transition hover:-translate-y-0.5 hover:border-brand/40"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand transition group-hover:bg-brand group-hover:text-white">
                <f.icon size={24} />
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold text-heading">{f.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-body">{f.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
