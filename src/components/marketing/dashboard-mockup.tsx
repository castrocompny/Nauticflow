import {
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Anchor,
  Users,
  Ship,
  Navigation,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { WindowChrome } from "./section";

// Mockup do Dashboard real do NauticFlow recriado em HTML/CSS: agenda de hoje
// (horario, passeio, embarcacao, passageiros/capacidade e % de ocupacao),
// condicoes do vento ao lado da agenda (exatamente como o produto mostra hoje --
// ver src/app/(app)/dashboard/wind-conditions-card.tsx) e as reservas que
// acabaram de entrar, com a origem de cada uma.
//
// IMPORTANTE: numeros ILUSTRATIVOS, escolhidos a mao. Nao e print de tela nem
// dado de nenhuma conta de Producao. Fixo no tema escuro (o app e escuro),
// porque o cartao funciona como "screenshot" do produto sobre o hero navy --
// as secoes em volta continuam reagindo ao tema normalmente.

const NAV: { icon: LucideIcon; active?: boolean }[] = [
  { icon: LayoutDashboard, active: true },
  { icon: ClipboardList },
  { icon: CalendarDays },
  { icon: Anchor },
  { icon: Users },
];

// Agenda do dia: cada linha e uma saida com ocupacao real sobre a capacidade
// comercial da embarcacao.
const AGENDA = [
  { time: "09:00", tour: "Ilhas do Sul", boat: "Escuna Amigos", booked: 32, capacity: 40 },
  { time: "11:30", tour: "Pôr do sol", boat: "Lancha Azul", booked: 6, capacity: 8 },
  { time: "14:00", tour: "Ilha Feia", boat: "Catamarã Sol", booked: 18, capacity: 24 },
];

const RESERVAS = [
  { tour: "Ilha Feia", detail: "2 passageiros · 14:00", origin: "ToursFlow", fresh: true },
  { tour: "Ilhas do Sul", detail: "4 passageiros · 09:00", origin: "Balcão" },
];

const VENTO_HORAS = [
  { h: "13h", v: "16" },
  { h: "14h", v: "18" },
  { h: "15h", v: "21" },
];

function occupancyTone(pct: number) {
  if (pct >= 90) return { bar: "bg-amber-400", text: "text-amber-400" };
  if (pct >= 70) return { bar: "bg-emerald-400", text: "text-emerald-400" };
  return { bar: "bg-brand-light", text: "text-brand-light" };
}

export function DashboardMockup() {
  return (
    <div
      aria-hidden="true"
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20"
    >
      <WindowChrome label="nauticflow.com.br/dashboard" live />

      <div className="flex">
        {/* menu lateral */}
        <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-white/5 bg-[#0b1428] py-3">
          <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-md bg-brand/20 text-brand-light">
            <Ship size={14} />
          </div>
          {NAV.map((item, i) => (
            <span
              key={i}
              className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                item.active ? "bg-brand text-white" : "text-slate-500"
              }`}
            >
              <item.icon size={15} />
            </span>
          ))}
        </div>

        {/* conteudo */}
        <div className="min-w-0 flex-1 p-3.5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white">Agenda de hoje</p>
              {/* sem nome de dia da semana de proposito: o mockup e estatico e
                  uma data fixa com "sábado"/"segunda" escrito envelhece errado. */}
              <p className="text-[10px] text-slate-500">Hoje · 14 de setembro · 3 saídas</p>
            </div>
            <span className="shrink-0 rounded-lg bg-emerald-500/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
              76% ocupação
            </span>
          </div>

          {/* condicoes do vento -- informacao operacional ao lado da agenda */}
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/20 text-brand-light">
                <Wind size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] uppercase tracking-wide text-slate-500">
                  Condições do vento
                </p>
                {/* rajada em linha propria: em 375px "18 km/h · rajadas 27 km/h"
                    quebrava deixando um "km/h" orfao na linha de baixo. */}
                <p className="font-display text-sm font-semibold leading-tight text-white">
                  18 km/h
                </p>
                <p className="text-[10px] leading-tight text-slate-400">rajadas 27 km/h</p>
              </div>
              <span className="flex shrink-0 items-center gap-1 rounded-md bg-white/5 px-1.5 py-1 text-[10px] font-medium text-slate-300">
                <Navigation size={11} style={{ transform: "rotate(135deg)" }} />
                SE
              </span>
            </div>
            <div className="mt-2 flex gap-1.5">
              {VENTO_HORAS.map((p) => (
                <span
                  key={p.h}
                  className="flex-1 rounded-md bg-black/25 px-1 py-1 text-center text-[9px] text-slate-400"
                >
                  <span className="block text-slate-500">{p.h}</span>
                  <span className="block font-semibold text-slate-200">{p.v} km/h</span>
                </span>
              ))}
            </div>
          </div>

          {/* saidas do dia com ocupacao */}
          <div className="mt-2.5 space-y-1.5">
            {AGENDA.map((s, i) => {
              const pct = Math.round((s.booked / s.capacity) * 100);
              const tone = occupancyTone(pct);
              return (
                <div
                  key={s.time}
                  className={`rounded-xl border p-2.5 ${
                    i === 0
                      ? "border-brand/30 bg-brand/10"
                      : "border-white/5 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-display text-xs font-semibold text-white">{s.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-slate-100">
                        {s.tour}
                      </span>
                      <span className="block truncate text-[10px] text-slate-500">{s.boat}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11px] font-semibold text-white">
                        {s.booked}/{s.capacity}
                      </span>
                      <span className={`block text-[9px] font-medium ${tone.text}`}>{pct}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div className={`h-1 rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* reservas recentes com origem */}
          <div className="mt-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <p className="mb-2 text-[11px] font-semibold text-white">Reservas recentes</p>
            <ul className="space-y-1.5">
              {RESERVAS.map((r) => (
                <li key={r.tour} className="flex items-center gap-2">
                  {r.fresh ? (
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                  ) : (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-slate-200">
                      {r.tour}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">{r.detail}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${
                      r.origin === "ToursFlow"
                        ? "bg-brand/20 text-brand-light"
                        : "bg-white/5 text-slate-400"
                    }`}
                  >
                    {r.origin}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
