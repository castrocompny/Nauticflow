"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, CalendarRange, ShieldCheck, Plus, RotateCcw } from "lucide-react";
import { SectionHeading } from "./section";
import { Reveal } from "./reveal";
import { OccupancyBar } from "@/components/ui";

// Os dois modelos de reserva que o produto realmente suporta hoje: saidas com
// horario fixo (venda por vaga ate a capacidade) e reserva privativa por periodo
// dentro de uma janela de disponibilidade. A prevencao de conflito de embarcacao
// e garantida no banco (gatilho de sobreposicao, migration 0074) -- por isso a
// frase "evita conflitos automaticamente" pode ser dita no presente.
//
// Os dois modelos viraram abas (padrao ARIA tabs: role/aria-selected/
// aria-controls + setas do teclado). O conteudo de cada aba e exatamente o que
// os dois cartoes lado-a-lado mostravam antes -- so o formato mudou.
//
// HONESTIDADE VERIFICADA (nao presumida): `src/app/api/public/tours/route.ts`
// filtra `.neq("booking_model", "flexible_private")`, ou seja, o ToursFlow NAO
// publica/vende passeio privativo flexivel hoje -- so saida com horario fixo.
// A aba do privativo diz isso com todas as letras; se esse filtro mudar no
// futuro, a frase aqui precisa ser reconferida antes de ser alterada.

const HORARIOS = ["10:00", "14:00", "16:00"];

// Frota ilustrativa -- numeros de demonstracao, nunca dado real. As tres linhas
// somam exatamente a capacidade/reservados do painel de totais logo acima
// (90 e 68): se um leitor somar, tem que fechar.
const FROTA_BASE = [
  { name: "Escuna Amigos", capacity: 48, booked: 36 },
  { name: "Catamarã Sol", capacity: 30, booked: 23 },
  { name: "Lancha Azul", capacity: 12, booked: 9 },
];

const PESSOAS_NA_RESERVA = 2;
const CAPACIDADE_RESET_MS = 5000;

const TABS = [
  { id: "fixo", label: "Horários fixos", sub: "Venda por vaga", icon: Clock3 },
  { id: "flexivel", label: "Privativo flexível", sub: "Reserva por período", icon: CalendarRange },
] as const;

function PainelHorariosFixos() {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
      <div>
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
        <p className="mt-3 text-sm leading-relaxed text-muted">
          É este o modelo que o ToursFlow publica hoje: as saídas com horário fixo aparecem no site
          com a disponibilidade ao vivo.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Saídas do dia</p>
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
  );
}

function PainelPrivativoFlexivel() {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
      <div>
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
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Este modelo é operado dentro do NauticFlow — agenda, conflito de embarcação e ocupação.
          A venda pelo ToursFlow hoje cobre apenas as saídas com horário fixo.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Disponível</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-display text-sm font-semibold text-heading">08:00</span>
            <span className="h-2 flex-1 rounded-full bg-surfaceHover" />
            <span className="font-display text-sm font-semibold text-heading">19:00</span>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-purpleflow">Reserva</p>
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
  );
}

export function BookingModels() {
  const [tab, setTab] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }, []);

  // --- demonstracao de capacidade -------------------------------------------
  // Estado 100% local: nenhuma chamada de rede, nenhum dado real.
  const [extra, setExtra] = useState(0);
  const capReset = useRef<number | null>(null);

  const clearCapTimer = useCallback(() => {
    if (capReset.current !== null) {
      window.clearTimeout(capReset.current);
      capReset.current = null;
    }
  }, []);

  useEffect(() => clearCapTimer, [clearCapTimer]);

  const adicionarReserva = useCallback(() => {
    clearCapTimer();
    setExtra(PESSOAS_NA_RESERVA);
    capReset.current = window.setTimeout(() => {
      setExtra(0);
      capReset.current = null;
    }, CAPACIDADE_RESET_MS);
  }, [clearCapTimer]);

  const resetarCapacidade = useCallback(() => {
    clearCapTimer();
    setExtra(0);
  }, [clearCapTimer]);

  const capacidade = FROTA_BASE.reduce((a, f) => a + f.capacity, 0);
  const reservadosBase = FROTA_BASE.reduce((a, f) => a + f.booked, 0);
  const reservados = reservadosBase + extra;
  const disponiveis = capacidade - reservados;
  const ocupacao = Math.round((reservados / capacidade) * 100);

  // a reserva simulada entra na primeira embarcacao -- os totais continuam
  // batendo com a soma das linhas.
  const frota = FROTA_BASE.map((f, i) => (i === 0 ? { ...f, booked: f.booked + extra } : f));

  const totais = [
    { label: "Capacidade", value: capacidade, destaque: false },
    { label: "Reservados", value: reservados, destaque: extra > 0 },
    { label: "Disponíveis", value: disponiveis, destaque: extra > 0 },
    { label: "Ocupação", value: `${ocupacao}%`, destaque: extra > 0 },
  ];

  return (
    <section className="bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Modelos de reserva"
            title="Cada operação vende de um jeito. O sistema entende os dois."
            subtitle="Venda por vaga em saídas com horário fixo ou alugue a embarcação inteira por período — na mesma conta, na mesma agenda."
          />
        </Reveal>

        {/* abas dos dois modelos (padrao ARIA tabs) */}
        <Reveal className="mt-12">
          <div
            role="tablist"
            aria-label="Modelos de reserva"
            className="mx-auto flex max-w-md items-center gap-2 rounded-xl border border-line bg-app p-1.5"
          >
            {TABS.map((t, i) => {
              const selecionada = i === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={selecionada}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={selecionada ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  onClick={() => setTab(i)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={`nf-press flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    selecionada
                      ? "bg-surface text-heading shadow-sm"
                      : "text-muted hover:text-heading"
                  }`}
                >
                  <t.icon size={16} aria-hidden="true" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="mt-8 rounded-card border border-line bg-app p-6 sm:p-8">
            {TABS.map((t, i) => (
              <div
                key={t.id}
                role="tabpanel"
                id={`panel-${t.id}`}
                aria-labelledby={`tab-${t.id}`}
                tabIndex={0}
                hidden={i !== tab}
                className="nf-swap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
              >
                {i === 0 ? <PainelHorariosFixos /> : <PainelPrivativoFlexivel />}
              </div>
            ))}
          </div>
        </Reveal>

        {/* callout de conflito de embarcacao */}
        <Reveal className="mt-6">
          <div className="mx-auto flex max-w-3xl items-center gap-4 rounded-card border border-brand/25 bg-brand/5 px-6 py-5">
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
        </Reveal>

        {/* capacidade e vagas -- demonstracao interativa */}
        <Reveal className="mt-16 lg:mt-20">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-brand">
                Capacidade e vagas
              </span>
              <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
                Pare de contar vagas manualmente
              </h3>
              <p className="mt-3 text-[17px] leading-relaxed text-body">
                O NauticFlow controla a ocupação de cada saída e impede reservas acima da capacidade
                da embarcação. A conta é feita sozinha, a cada reserva que entra ou é cancelada.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-amberflow/30 bg-amberflow/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amberflow">
                  Demonstração
                </span>
                <button
                  type="button"
                  onClick={adicionarReserva}
                  className="nf-press inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <Plus size={15} aria-hidden="true" />
                  Adicionar reserva de {PESSOAS_NA_RESERVA} pessoas
                </button>
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={resetarCapacidade}
                    className="nf-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-body hover:border-brand/40 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    Reiniciar
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">
                Os números voltam sozinhos ao estado inicial depois de alguns segundos.
              </p>
            </div>

            <div className="rounded-card border border-line bg-app p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-sm font-semibold text-heading">Ocupação por saída</p>
                <span className="text-[11px] text-muted">Hoje</span>
              </div>

              <div
                aria-live="polite"
                className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-4"
              >
                {totais.map((t) => (
                  <div key={t.label}>
                    <p className="text-[10px] uppercase tracking-wide text-muted">{t.label}</p>
                    <p
                      className={`nf-num font-display text-xl font-semibold ${
                        t.destaque ? "text-brand" : "text-heading"
                      }`}
                    >
                      {t.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                {frota.map((f) => (
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
        </Reveal>
      </div>
    </section>
  );
}
