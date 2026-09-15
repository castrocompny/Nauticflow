"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowDown,
  Bell,
  Volume2,
  MonitorSmartphone,
  Zap,
  Users,
  Play,
  RotateCcw,
  Check,
  CalendarClock,
} from "lucide-react";
import { SectionHeading, WindowChrome } from "./section";
import { Reveal } from "./reveal";
import { playDemoChime } from "./demo-chime";

// Fluxo venda -> operacao. TUDO representado aqui e o laco que ja funciona hoje:
// reserva feita no ToursFlow entra no NauticFlow (source='marketplace'), aparece
// no painel do operador e dispara o alerta de nova reserva (toast + som +
// notificacao do navegador, via Realtime -- ver src/components/reservation-notifier.tsx).
// O card do ToursFlow mostra escolha de data/horario/passageiros e o botao de
// reservar -- NUNCA um checkout/pagamento, que ainda nao existe no fluxo publico.
//
// Esta secao e interativa: o stepper de 4 etapas troca o estado dos DOIS mockups
// (nenhuma navegacao, nenhum request -- so estado local de React). O layout
// lado-a-lado original foi preservado de proposito; o que mudou e que os cartoes
// agora contam a etapa selecionada em vez de mostrarem sempre o estado final.

const CANAIS = [
  {
    icon: Bell,
    title: "Toast na tela",
    desc: "O aviso aparece por cima de qualquer tela do sistema, sem atrapalhar o que você está fazendo.",
  },
  {
    icon: Volume2,
    title: "Alerta sonoro",
    desc: "Um som curto avisa a equipe mesmo quando ninguém está olhando para o monitor.",
  },
  {
    icon: MonitorSmartphone,
    title: "Notificação do navegador",
    desc: "Com a permissão concedida, o aviso chega mesmo com o NauticFlow em outra aba.",
  },
];

const STEPS = [
  {
    id: "toursflow",
    label: "ToursFlow",
    caption: "O cliente escolhe o passeio, a data, o horário e quantas pessoas vão.",
  },
  {
    id: "reserva",
    label: "Reserva",
    caption: "Ele envia a reserva pelo site. Nenhum pagamento online acontece nesta etapa.",
  },
  {
    id: "nauticflow",
    label: "NauticFlow",
    caption: "A reserva chega na operação na hora — com toast, som e notificação do navegador.",
  },
  {
    id: "operacao",
    label: "Operação",
    caption: "Ela entra na agenda da saída certa e a vaga é descontada nos dois lados.",
  },
] as const;

const CAPACIDADE_DEMO = 8;
const PESSOAS_DEMO = 2;
const AUTO_RESET_MS = 7000;

// Card do ToursFlow (lado da venda). Claro de proposito: e um site publico pro
// turista, nao o painel escuro do operador.
function ToursFlowCard({ enviada, atenuado }: { enviada: boolean; atenuado: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl transition-opacity duration-300 ${
        atenuado ? "opacity-60" : "opacity-100"
      }`}
    >
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-3 truncate text-[11px] font-medium text-slate-400">
          toursflow · passeio
        </span>
      </div>

      <div className="p-4">
        {/* "foto" do passeio desenhada em CSS -- nenhuma imagem pesada na landing */}
        <div className="relative h-20 overflow-hidden rounded-xl bg-gradient-to-br from-sky-400 via-cyan-500 to-blue-600">
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-blue-900/40 to-transparent" />
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-700">
            Passeio de barco
          </span>
        </div>

        <p className="mt-3 font-display text-sm font-semibold text-slate-900">Passeio Ilha Feia</p>
        <p className="text-[11px] text-slate-500">Saída às 10:00 · duração 4h</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <span
            className={`rounded-lg border px-2 py-1.5 text-[10px] text-slate-700 transition-colors duration-300 ${
              enviada ? "border-slate-200" : "border-brand/50 bg-brand/5"
            }`}
          >
            <span className="block text-[9px] text-slate-400">Data</span>
            14/09
          </span>
          <span
            className={`rounded-lg border px-2 py-1.5 text-[10px] text-slate-700 transition-colors duration-300 ${
              enviada ? "border-slate-200" : "border-brand/50 bg-brand/5"
            }`}
          >
            <span className="block text-[9px] text-slate-400">Horário</span>
            10:00
          </span>
        </div>

        <div
          className={`mt-2 flex items-center justify-between rounded-lg border px-2.5 py-2 transition-colors duration-300 ${
            enviada ? "border-slate-200" : "border-brand/50 bg-brand/5"
          }`}
        >
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <Users size={12} />
            Passageiros
          </span>
          <span className="text-[11px] font-semibold text-slate-900">{PESSOAS_DEMO}</span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-emerald-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {enviada ? CAPACIDADE_DEMO - PESSOAS_DEMO : CAPACIDADE_DEMO} vagas disponíveis
        </div>

        <span className="mt-3 block rounded-lg bg-[#0D1B3E] py-2.5 text-center text-[11px] font-semibold text-white">
          Reservar
        </span>

        {/* estado honesto do produto hoje: a reserva e ENVIADA, nunca paga online */}
        <p
          className={`mt-2 flex items-center justify-center gap-1 text-center text-[10px] font-medium text-emerald-600 transition-opacity duration-300 ${
            enviada ? "opacity-100" : "opacity-0"
          }`}
        >
          <Check size={11} />
          Reserva enviada
        </p>
      </div>
    </div>
  );
}

// Lado do NauticFlow: o alerta exatamente como o operador ve dentro do sistema
// (mesmos campos do toast real: passeio, cliente, passageiros, data/hora, origem).
function NauticFlowCard({
  toast,
  agenda,
  atenuado,
  toastKey,
}: {
  toast: boolean;
  agenda: boolean;
  atenuado: boolean;
  toastKey: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20 transition-opacity duration-300 ${
        atenuado ? "opacity-60" : "opacity-100"
      }`}
    >
      <WindowChrome label="nauticflow.com.br/dashboard" live />

      {/* altura casada com a do cartao do ToursFlow ao lado: com o painel curto,
          os dois mockups ficavam desalinhados no desktop (grid items-center) e
          os rotulos de cima nao batiam. */}
      <div className="relative p-4">
        {agenda ? (
          // etapa "Operação": a reserva ja dentro da agenda da saida certa
          <div key="agenda" className="nf-swap space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <CalendarClock size={12} className="text-brand-light" />
              Agenda de hoje
            </p>
            <div className="rounded-lg border border-brand/30 bg-[#111c36] p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-display text-[12px] font-semibold text-white">10:00 · Ilha Feia</p>
                <p className="text-[10px] text-slate-400">Lancha Azul</p>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="h-1.5 flex-1 rounded-full bg-white/10">
                  <span
                    className="nf-bar block h-1.5 rounded-full bg-brand"
                    style={{ width: `${(PESSOAS_DEMO / CAPACIDADE_DEMO) * 100}%` }}
                  />
                </span>
                <span className="text-[10px] font-semibold text-slate-300">
                  {PESSOAS_DEMO}/{CAPACIDADE_DEMO}
                </span>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                Marina Duarte · {PESSOAS_DEMO} passageiros
                <span className="rounded-md bg-brand/20 px-1.5 py-0.5 font-semibold text-brand-light">
                  ToursFlow
                </span>
              </p>
            </div>
            <div className="space-y-2 opacity-40">
              <div className="h-10 rounded-lg bg-white/[0.06]" />
              <div className="h-10 rounded-lg bg-white/[0.06]" />
              <div className="h-10 rounded-lg bg-white/[0.06]" />
            </div>
          </div>
        ) : (
          <>
            {/* fundo "borrado" do painel, so pra dar contexto ao toast */}
            <div className="space-y-2 opacity-40">
              <div className="h-2.5 w-2/5 rounded bg-white/10" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-11 rounded-lg bg-white/[0.06]" />
                <div className="h-11 rounded-lg bg-white/[0.06]" />
              </div>
              <div className="h-2 w-1/3 rounded bg-white/10" />
              <div className="h-12 rounded-lg bg-white/[0.06]" />
              <div className="h-12 rounded-lg bg-white/[0.06]" />
              <div className="h-12 rounded-lg bg-white/[0.06]" />
              <div className="h-12 rounded-lg bg-white/[0.06]" />
            </div>

            {/* toast de nova reserva -- mesmo conteudo do alerta real do app */}
            {toast && (
              <div
                key={toastKey}
                className="nf-toast-in absolute inset-x-4 bottom-4 rounded-lg border border-brand/30 bg-[#111c36] px-3.5 py-3 shadow-xl"
              >
                <p className="flex items-center gap-2 font-display text-[12px] font-semibold text-white">
                  <Bell size={13} className="text-brand-light" />
                  Nova reserva recebida
                </p>
                <p className="mt-1 text-[11px] text-slate-200">Passeio Ilha Feia</p>
                <p className="text-[10px] text-slate-400">Cliente: Marina Duarte</p>
                <p className="text-[10px] text-slate-400">
                  {PESSOAS_DEMO} passageiros · 14/09 às 10:00
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                  Origem:
                  <span className="rounded-md bg-brand/20 px-1.5 py-0.5 font-semibold text-brand-light">
                    ToursFlow
                  </span>
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function SalesFlow() {
  const [step, setStep] = useState(0);
  const [toastKey, setToastKey] = useState(0);
  const resetTimer = useRef<number | null>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const clearTimer = useCallback(() => {
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  // navegacao manual pelo stepper: cancela qualquer auto-reset pendente da
  // simulacao -- a pagina nunca "pula" embaixo de quem esta explorando.
  const goTo = useCallback(
    (i: number) => {
      clearTimer();
      setStep(i);
      if (i === 2) setToastKey((k) => k + 1);
    },
    [clearTimer],
  );

  // Padrao de teclado do stepper: setas movem E ativam (a troca e barata e sem
  // navegacao), Home/End vao para as pontas.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % STEPS.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + STEPS.length) % STEPS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = STEPS.length - 1;
      if (next === null) return;
      e.preventDefault();
      goTo(next);
      btnRefs.current[next]?.focus();
    },
    [goTo],
  );

  // "Simular nova reserva": som SOMENTE aqui, dentro do gesto explicito da
  // pessoa -- nunca ao carregar a pagina, nunca ao rolar.
  const simular = useCallback(() => {
    clearTimer();
    setStep(2);
    setToastKey((k) => k + 1);
    playDemoChime();
    resetTimer.current = window.setTimeout(() => {
      setStep(0);
      resetTimer.current = null;
    }, AUTO_RESET_MS);
  }, [clearTimer]);

  const reiniciar = useCallback(() => {
    clearTimer();
    setStep(0);
  }, [clearTimer]);

  const chegou = step >= 2;
  const vagas = chegou ? CAPACIDADE_DEMO - PESSOAS_DEMO : CAPACIDADE_DEMO;

  return (
    <section id="fluxo" className="scroll-mt-20 bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Do marketplace à marina"
            title="Seu cliente reserva. Sua operação já sabe."
            subtitle="Uma reserva entra pelo ToursFlow e todo o sistema se atualiza: ela aparece no seu painel, entra na agenda da saída certa e a vaga é descontada nos dois lados — na hora, sem ninguém digitar nada."
          />
        </Reveal>

        {/* stepper: 4 etapas clicaveis (clique e toque, nunca hover) */}
        <Reveal className="mt-12">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-muted">
            Da venda à operação
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {STEPS.map((s, i) => {
              const ativo = i === step;
              const concluido = i < step;
              return (
                <span key={s.id} className="flex items-center gap-2 sm:gap-3">
                  {i > 0 && (
                    <ArrowRight
                      size={14}
                      aria-hidden="true"
                      className={concluido || ativo ? "text-brand" : "text-brand/30"}
                    />
                  )}
                  <button
                    type="button"
                    ref={(el) => {
                      btnRefs.current[i] = el;
                    }}
                    onClick={() => goTo(i)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    aria-current={ativo ? "step" : undefined}
                    aria-controls="nf-flow-stage"
                    className={`nf-press rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      ativo
                        ? "border-brand bg-brand text-white shadow-sm"
                        : concluido
                          ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand/20"
                          : "border-line bg-surface text-muted hover:border-brand/40 hover:text-brand"
                    }`}
                  >
                    <span className="mr-1.5 opacity-70">{i + 1}</span>
                    {s.label}
                  </button>
                </span>
              );
            })}
          </div>

          <p
            aria-live="polite"
            className="mx-auto mt-4 max-w-xl text-center text-[15px] leading-relaxed text-body"
          >
            <span key={step} className="nf-swap inline-block">
              {STEPS[step].caption}
            </span>
          </p>
        </Reveal>

        <div
          id="nf-flow-stage"
          className="mt-10 grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-8"
        >
          <div>
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              ToursFlow · o cliente reserva
            </p>
            <ToursFlowCard enviada={step >= 1} atenuado={step >= 2} />
          </div>

          {/* seta: horizontal no desktop, vertical no mobile */}
          <div className="flex items-center justify-center" aria-hidden="true">
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors duration-300 ${
                chegou
                  ? "border-brand bg-brand text-white"
                  : "border-brand/30 bg-brand/10 text-brand"
              }`}
            >
              <ArrowRight size={22} className="hidden lg:block" />
              <ArrowDown size={22} className="lg:hidden" />
            </span>
          </div>

          <div>
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-wider text-brand">
              NauticFlow · a operação é avisada
            </p>
            <NauticFlowCard
              toast={step === 2}
              agenda={step === 3}
              atenuado={step < 2}
              toastKey={toastKey}
            />
          </div>
        </div>

        {/* disponibilidade compartilhada + demonstracao do alerta */}
        <Reveal className="mt-10">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 rounded-card border border-line bg-surface px-6 py-6 text-center">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Zap size={20} />
              </span>
              <div className="flex items-center gap-3">
                <span className="text-center">
                  <span className="block text-[11px] uppercase tracking-wide text-muted">Antes</span>
                  <span className="font-display text-xl font-semibold text-heading">
                    {CAPACIDADE_DEMO} vagas
                  </span>
                </span>
                <ArrowRight size={18} className="shrink-0 text-brand" aria-hidden="true" />
                <span className="text-center">
                  <span className="block text-[11px] uppercase tracking-wide text-muted">Depois</span>
                  <span
                    aria-live="polite"
                    className={`nf-num font-display text-xl font-semibold ${
                      chegou ? "text-brand" : "text-muted"
                    }`}
                  >
                    {vagas} vagas
                  </span>
                </span>
              </div>
              <p className="text-sm leading-relaxed text-body sm:max-w-[13rem] sm:text-left">
                A disponibilidade é a mesma nos dois sistemas — some de um lado, some do outro.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line pt-4">
              <span className="rounded-full border border-amberflow/30 bg-amberflow/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amberflow">
                Demonstração
              </span>
              <button
                type="button"
                onClick={simular}
                className="nf-press inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Play size={15} aria-hidden="true" />
                Simular nova reserva
              </button>
              {step !== 0 && (
                <button
                  type="button"
                  onClick={reiniciar}
                  className="nf-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-app px-3 py-2.5 text-sm font-medium text-body hover:border-brand/40 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Reiniciar
                </button>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Reproduz aqui na página o mesmo aviso que aparece dentro do sistema. Toca um som curto
              — só depois do seu clique.
            </p>
          </div>
        </Reveal>

        {/* alertas em tempo real */}
        <Reveal className="mt-16">
          <div className="rounded-card border border-line bg-surface p-6 sm:p-8">
            <div className="mx-auto max-w-2xl text-center">
              <h3 className="font-display text-2xl font-semibold tracking-tight text-heading">
                Novas reservas chegam. Você fica sabendo na hora.
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-body">
                Quando entra uma reserva de fora — do ToursFlow ou de um parceiro — o NauticFlow
                avisa na mesma hora, sem ninguém precisar atualizar a página.
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {CANAIS.map((c) => (
                <div
                  key={c.title}
                  className="nf-card-hover rounded-xl border border-line bg-app p-5 hover:border-brand/40 hover:shadow-md"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <c.icon size={20} />
                  </span>
                  <p className="mt-4 font-display text-base font-semibold text-heading">{c.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-body">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
