import { ArrowRight, ArrowDown, Bell, Volume2, MonitorSmartphone, Zap, Users } from "lucide-react";
import { SectionHeading, WindowChrome } from "./section";

// Fluxo venda -> operacao. TUDO representado aqui e o laco que ja funciona hoje:
// reserva feita no ToursFlow entra no NauticFlow (source='marketplace'), aparece
// no painel do operador e dispara o alerta de nova reserva (toast + som +
// notificacao do navegador, via Realtime -- ver src/components/reservation-notifier.tsx).
// O card do ToursFlow mostra escolha de data/horario/passageiros e o botao de
// reservar -- NUNCA um checkout/pagamento, que ainda nao existe no fluxo publico.

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

// Card do ToursFlow (lado da venda). Claro de proposito: e um site publico pro
// turista, nao o painel escuro do operador.
function ToursFlowCard() {
  return (
    <div
      aria-hidden="true"
      className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
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
          <span className="rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] text-slate-700">
            <span className="block text-[9px] text-slate-400">Data</span>
            14/09
          </span>
          <span className="rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] text-slate-700">
            <span className="block text-[9px] text-slate-400">Horário</span>
            10:00
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2">
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <Users size={12} />
            Passageiros
          </span>
          <span className="text-[11px] font-semibold text-slate-900">2</span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-emerald-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />8 vagas
          disponíveis
        </div>

        <span className="mt-3 block rounded-lg bg-[#0D1B3E] py-2.5 text-center text-[11px] font-semibold text-white">
          Reservar
        </span>
        <p className="mt-2 text-center text-[10px] font-medium text-emerald-600">
          ✓ Reserva realizada
        </p>
      </div>
    </div>
  );
}

// Lado do NauticFlow: o alerta exatamente como o operador ve dentro do sistema
// (mesmos campos do toast real: passeio, cliente, passageiros, data/hora, origem).
function NauticFlowAlertCard() {
  return (
    <div
      aria-hidden="true"
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20"
    >
      <WindowChrome label="nauticflow.com.br/dashboard" live />

      {/* altura casada com a do cartao do ToursFlow ao lado: com o painel curto,
          os dois mockups ficavam desalinhados no desktop (grid items-center) e
          os rotulos de cima nao batiam. */}
      <div className="relative p-4">
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

        {/* toast de nova reserva */}
        <div className="absolute inset-x-4 bottom-4 rounded-lg border border-brand/30 bg-[#111c36] px-3.5 py-3 shadow-xl">
          <p className="flex items-center gap-2 font-display text-[12px] font-semibold text-white">
            <Bell size={13} className="text-brand-light" />
            Nova reserva recebida
          </p>
          <p className="mt-1 text-[11px] text-slate-200">Passeio Ilha Feia</p>
          <p className="text-[10px] text-slate-400">Cliente: Marina Duarte</p>
          <p className="text-[10px] text-slate-400">2 passageiros · 14/09 às 10:00</p>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
            Origem:
            <span className="rounded-md bg-brand/20 px-1.5 py-0.5 font-semibold text-brand-light">
              ToursFlow
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export function SalesFlow() {
  return (
    <section id="fluxo" className="scroll-mt-20 bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Do marketplace à marina"
          title="Seu cliente reserva. Sua operação já sabe."
          subtitle="Uma reserva entra pelo ToursFlow e todo o sistema se atualiza: ela aparece no seu painel, entra na agenda da saída certa e a vaga é descontada nos dois lados — na hora, sem ninguém digitar nada."
        />

        <div className="mt-14 grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-8">
          <div>
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              ToursFlow · o cliente reserva
            </p>
            <ToursFlowCard />
          </div>

          {/* seta: horizontal no desktop, vertical no mobile */}
          <div className="flex items-center justify-center" aria-hidden="true">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-brand/30 bg-brand/10 text-brand">
              <ArrowRight size={22} className="hidden lg:block" />
              <ArrowDown size={22} className="lg:hidden" />
            </span>
          </div>

          <div>
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-wider text-brand">
              NauticFlow · a operação é avisada
            </p>
            <NauticFlowAlertCard />
          </div>
        </div>

        {/* disponibilidade compartilhada */}
        <div className="mx-auto mt-10 flex max-w-xl flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-5 text-center sm:flex-row sm:justify-center sm:gap-6 sm:text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Zap size={20} />
          </span>
          <div className="flex items-center gap-3">
            <span className="text-center">
              <span className="block text-[11px] uppercase tracking-wide text-muted">Antes</span>
              <span className="font-display text-xl font-semibold text-heading">8 vagas</span>
            </span>
            <ArrowRight size={18} className="shrink-0 text-brand" />
            <span className="text-center">
              <span className="block text-[11px] uppercase tracking-wide text-muted">Depois</span>
              <span className="font-display text-xl font-semibold text-brand">6 vagas</span>
            </span>
          </div>
          <p className="text-sm leading-relaxed text-body sm:max-w-[13rem]">
            A disponibilidade é a mesma nos dois sistemas — some de um lado, some do outro.
          </p>
        </div>

        {/* legenda do fluxo */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs font-bold uppercase tracking-wider text-muted">
          {["ToursFlow", "Reserva", "NauticFlow", "Operação"].map((label, i) => (
            <span key={label} className="flex items-center gap-3">
              {i > 0 && <ArrowRight size={14} className="text-brand/60" />}
              <span className={i === 3 ? "text-brand" : undefined}>{label}</span>
            </span>
          ))}
        </div>

        {/* alertas em tempo real */}
        <div className="mt-16 rounded-card border border-line bg-surface p-6 sm:p-8">
          <div className="mx-auto max-w-2xl text-center">
            <h3 className="font-display text-2xl font-semibold tracking-tight text-heading">
              Novas reservas chegam. Você fica sabendo na hora.
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-body">
              Quando entra uma reserva de fora — do ToursFlow ou de um parceiro — o NauticFlow avisa
              na mesma hora, sem ninguém precisar atualizar a página.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {CANAIS.map((c) => (
              <div key={c.title} className="rounded-xl border border-line bg-app p-5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <c.icon size={20} />
                </span>
                <p className="mt-4 font-display text-base font-semibold text-heading">{c.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-body">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
