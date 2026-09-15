import { Clock3, CalendarRange, ShieldCheck } from "lucide-react";
import { SectionHeading } from "./section";
import { OccupancyBar } from "@/components/ui";

// Os dois modelos de reserva que o produto realmente suporta hoje: saidas com
// horario fixo (venda por vaga ate a capacidade) e reserva privativa por periodo
// dentro de uma janela de disponibilidade. A prevencao de conflito de embarcacao
// e garantida no banco (gatilho de sobreposicao, migration 0074) -- por isso a
// frase "evita conflitos automaticamente" pode ser dita no presente.

const HORARIOS = ["10:00", "14:00", "16:00"];

// Ocupacao ilustrativa por embarcacao -- numeros de demonstracao, nao dado real.
const FROTA = [
  { name: "Escuna Amigos", capacity: 40, booked: 32 },
  { name: "Catamarã Sol", capacity: 24, booked: 18 },
  { name: "Lancha Azul", capacity: 8, booked: 4 },
];

export function BookingModels() {
  return (
    <section className="bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Modelos de reserva"
          title="Cada operação vende de um jeito. O sistema entende os dois."
          subtitle="Venda por vaga em saídas com horário fixo ou alugue a embarcação inteira por período — na mesma conta, na mesma agenda."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          {/* horarios fixos */}
          <div className="flex flex-col rounded-card border border-line bg-app p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Clock3 size={22} />
              </span>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-brand">
                  Horários fixos
                </span>
                <p className="font-display text-lg font-semibold text-heading">Venda por vaga</p>
              </div>
            </div>

            <p className="mt-5 text-[15px] leading-relaxed text-body">
              Defina saídas com dias e horários fixos e venda vagas até atingir a capacidade da
              embarcação. Ideal para escunas, passeios compartilhados e operação por vaga.
            </p>

            <div className="mt-6 rounded-xl border border-line bg-surface p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Saídas do dia
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {HORARIOS.map((h) => (
                  <span
                    key={h}
                    className="rounded-lg border border-brand/25 bg-brand/5 px-3 py-1.5 font-display text-sm font-semibold text-brand"
                  >
                    {h}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">
                Cada horário tem sua própria lotação e lista de passageiros.
              </p>
            </div>
          </div>

          {/* privativo flexivel */}
          <div className="flex flex-col rounded-card border border-line bg-app p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purpleflow/10 text-purpleflow">
                <CalendarRange size={22} />
              </span>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-purpleflow">
                  Privativo flexível
                </span>
                <p className="font-display text-lg font-semibold text-heading">Reserva por período</p>
              </div>
            </div>

            <p className="mt-5 text-[15px] leading-relaxed text-body">
              Defina uma janela de disponibilidade e permita reservas por período dentro dela. Ideal
              para lanchas, aluguel privativo e experiências exclusivas.
            </p>

            <div className="mt-6 space-y-3 rounded-xl border border-line bg-surface p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Disponível
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-display text-sm font-semibold text-heading">08:00</span>
                  <span className="h-2 flex-1 rounded-full bg-surfaceHover" />
                  <span className="font-display text-sm font-semibold text-heading">19:00</span>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-purpleflow">
                  Reserva
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-display text-sm font-semibold text-heading">10:00</span>
                  <span className="relative h-2 flex-1 rounded-full bg-surfaceHover">
                    <span className="absolute inset-y-0 left-[8%] w-[45%] rounded-full bg-purpleflow" />
                  </span>
                  <span className="font-display text-sm font-semibold text-heading">14:00</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* callout de conflito de embarcacao */}
        <div className="mx-auto mt-6 flex max-w-3xl items-center gap-4 rounded-card border border-brand/25 bg-brand/5 px-6 py-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <ShieldCheck size={20} />
          </span>
          <p className="text-[15px] leading-relaxed text-body">
            <strong className="font-semibold text-heading">
              O NauticFlow evita conflitos de embarcação automaticamente.
            </strong>{" "}
            Nenhum barco fica reservado em dois lugares ao mesmo tempo.
          </p>
        </div>

        {/* capacidade e vagas */}
        <div className="mt-16 grid items-center gap-10 lg:mt-20 lg:grid-cols-2 lg:gap-14">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-brand">
              Capacidade e vagas
            </span>
            <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
              Pare de contar vagas manualmente
            </h3>
            <p className="mt-3 text-[17px] leading-relaxed text-body">
              O NauticFlow controla a ocupação de cada saída e impede reservas acima da capacidade da
              embarcação. A conta é feita sozinha, a cada reserva que entra ou é cancelada.
            </p>
          </div>

          <div className="rounded-card border border-line bg-app p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-sm font-semibold text-heading">Ocupação por saída</p>
              <span className="text-[11px] text-muted">Hoje</span>
            </div>
            <div className="space-y-4">
              {FROTA.map((f) => (
                <div key={f.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-heading">{f.name}</p>
                    <p className="shrink-0 text-xs text-muted">
                      <span className="font-semibold text-heading">{f.booked}</span> reservados ·{" "}
                      {f.capacity - f.booked} disponíveis
                    </p>
                  </div>
                  <div className="mt-2">
                    <OccupancyBar booked={f.booked} capacity={f.capacity} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[11px] text-muted">
              Números ilustrativos para demonstração do sistema.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
