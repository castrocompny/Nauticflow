import { Ship, CalendarClock, Ticket } from "lucide-react";

// Mockup ilustrativo do painel — layout generico, sem dados reais de clientes.
export function DashboardMockup() {
  const bars = [42, 58, 35, 72, 64, 88, 61];
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const saidas = [
    { icon: Ship, t: "09:00", s: "Escuna · 32 pax" },
    { icon: CalendarClock, t: "11:30", s: "Lancha · 8 pax" },
    { icon: Ticket, t: "14:00", s: "Catamarã · 20 pax" },
  ];

  return (
    <div
      aria-hidden="true"
      className="w-full rounded-2xl border border-white/10 bg-white p-3 shadow-2xl ring-1 ring-black/5 sm:p-4 dark:bg-[#16181d]"
    >
      <div className="mb-3 flex items-center gap-1.5 px-1">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 text-[11px] font-medium text-slate-400">nauticflow.com.br</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3 grid grid-cols-3 gap-3">
          {[
            { label: "Receita do mês", value: "R$ 38.240", tone: "text-brand" },
            { label: "Ocupação média", value: "82%", tone: "text-emerald-500" },
            { label: "Saídas na semana", value: "46", tone: "text-heading" },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-xl border border-line bg-app/60 p-3 dark:bg-white/5"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{kpi.label}</p>
              <p className={`mt-1 font-display text-lg font-semibold ${kpi.tone}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        <div className="col-span-2 rounded-xl border border-line bg-surface p-3">
          <p className="mb-3 text-xs font-semibold text-heading">Ocupação por dia</p>
          <div className="flex h-24 items-end justify-between gap-2">
            {bars.map((h, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-brand to-brand-light"
                  style={{ height: `${h}%` }}
                />
                <span className="text-[9px] text-muted">{dias[i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-1 rounded-xl border border-line bg-surface p-3">
          <p className="mb-2 text-xs font-semibold text-heading">Próximas saídas</p>
          <ul className="space-y-2">
            {saidas.map((row, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <row.icon size={14} />
                </span>
                <span className="leading-tight">
                  <span className="block text-[11px] font-semibold text-heading">{row.t}</span>
                  <span className="block text-[10px] text-muted">{row.s}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
