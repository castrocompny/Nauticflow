"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Anchor,
  Users,
  CalendarCheck,
  DollarSign,
  Gauge,
  Ship,
  Plus,
  type LucideIcon,
} from "lucide-react";

// Recriacao fiel do painel real do NauticFlow (mesmo layout: sidebar, KPIs,
// "Desempenho do periodo", proximas saidas), com numeros ilustrativos saudaveis --
// nao e print da conta de teste, e uma demonstracao do produto. Fixo no tema escuro
// (o app e escuro), sobre o hero navy. Interativo: o toggle de periodo anima o grafico.

const NAV: { icon: LucideIcon; active?: boolean }[] = [
  { icon: LayoutDashboard, active: true },
  { icon: ClipboardList },
  { icon: CalendarDays },
  { icon: Anchor },
  { icon: Users },
];

const KPIS: { icon: LucideIcon; label: string; value: string; tile: string }[] = [
  { icon: CalendarCheck, label: "Reservas hoje", value: "12", tile: "bg-[#2563EB]" },
  { icon: DollarSign, label: "Receita do mês", value: "R$ 38.240", tile: "bg-[#16A34A]" },
  { icon: Gauge, label: "Ocupação hoje", value: "82%", tile: "bg-[#F59E0B]" },
  { icon: Ship, label: "Passageiros", value: "148", tile: "bg-[#7C3AED]" },
];

const PERIODS: Record<string, { bars: number[]; total: string }> = {
  "7 dias": { bars: [46, 62, 40, 78, 58, 92, 70], total: "R$ 9.120" },
  "30 dias": { bars: [52, 44, 66, 58, 74, 62, 84, 70, 90, 78], total: "R$ 38.240" },
  "90 dias": { bars: [48, 70, 60, 82, 76, 96], total: "R$ 104.500" },
};

const SAIDAS = [
  { t: "09:00", name: "Escuna Amigos", sub: "Ilhas · 32/40", tone: "text-emerald-400" },
  { t: "11:30", name: "Rio Azul", sub: "Geribá · 26/46", tone: "text-brand-light" },
  { t: "14:00", name: "Catamarã Sol", sub: "Tartarugas · 20/24", tone: "text-amber-400" },
];

export function DashboardMockup() {
  const [period, setPeriod] = useState<keyof typeof PERIODS>("30 dias");
  const { bars, total } = PERIODS[period];

  return (
    <div
      aria-hidden="true"
      className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20"
    >
      {/* barra de janela */}
      <div className="flex items-center gap-1.5 border-b border-white/5 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-3 text-[11px] font-medium text-slate-500">
          nauticflow.com.br/dashboard
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          ao vivo
        </span>
      </div>

      <div className="flex">
        {/* sidebar */}
        <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-white/5 bg-[#0b1428] py-3">
          <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-md bg-brand/20 text-brand-light">
            <Ship size={14} />
          </div>
          {NAV.map((item, i) => (
            <span
              key={i}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                item.active
                  ? "bg-brand text-white"
                  : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
              }`}
            >
              <item.icon size={15} />
            </span>
          ))}
        </div>

        {/* conteudo */}
        <div className="min-w-0 flex-1 p-3.5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[13px] font-semibold text-white">Boa tarde 👋</p>
              <p className="text-[10px] text-slate-500">Resumo do seu negócio hoje</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[10px] font-semibold text-white">
              <Plus size={12} /> Nova reserva
            </span>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2">
            {KPIS.map((kpi) => (
              <div
                key={kpi.label}
                className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-2.5 transition hover:border-white/15 hover:bg-white/[0.06]"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${kpi.tile}`}
                >
                  <kpi.icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[9px] uppercase tracking-wide text-slate-500">
                    {kpi.label}
                  </span>
                  <span className="block font-display text-sm font-semibold text-white">
                    {kpi.value}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* grafico de receita com toggle de periodo */}
          <div className="mt-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-white">Receita</p>
                <p className="text-[10px] text-slate-500">Total: {total}</p>
              </div>
              <div className="flex gap-1 rounded-lg bg-black/30 p-0.5">
                {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium transition ${
                      period === p ? "bg-brand text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex h-16 items-end justify-between gap-1">
              {bars.map((h, i) => (
                <div
                  key={`${period}-${i}`}
                  className="flex-1 rounded-t bg-gradient-to-t from-brand to-brand-light transition-all duration-500 ease-out"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          {/* proximas saidas */}
          <div className="mt-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <p className="mb-2 text-[11px] font-semibold text-white">Próximas saídas</p>
            <ul className="space-y-1.5">
              {SAIDAS.map((s) => (
                <li
                  key={s.t}
                  className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-white/5"
                >
                  <span className="font-display text-xs font-semibold text-white">{s.t}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-slate-200">
                      {s.name}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">{s.sub}</span>
                  </span>
                  <span className={`text-[10px] font-semibold ${s.tone}`}>●</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
