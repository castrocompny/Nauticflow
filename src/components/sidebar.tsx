"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  Ship,
  Users,
  Wallet,
  Handshake,
  BarChart3,
  Settings,
  Anchor,
  UserCog,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { fmtDate } from "@/lib/format";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reservas", label: "Reservas", icon: ClipboardList },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/saidas", label: "Saídas", icon: Anchor },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/embarcacoes", label: "Embarcações", icon: Ship },
  { href: "/financeiro", label: "Financeiro", icon: Wallet },
  { href: "/parceiros", label: "Parceiros", icon: Handshake },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/equipe", label: "Equipe", icon: UserCog },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar({
  company,
  city,
  planName,
  reservasUso,
  vesselsUso,
  vesselsLimite,
  paidUntil,
  overdue,
}: {
  company: string;
  city: string | null;
  planName: string;
  reservasUso: number;
  vesselsUso: number;
  vesselsLimite: number | null;
  paidUntil: string | null;
  overdue: boolean;
}) {
  const path = usePathname();
  const initial = (company || "?").trim().charAt(0).toUpperCase();
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-navy text-slate-200">
      <div className="px-5 py-5">
        <Logo />
      </div>

      <div className="mx-3 mb-2 flex items-center gap-3 rounded-lg bg-navy-700 p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{company}</p>
          <p className="truncate text-xs text-muted">{city || "Operação náutica"}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {nav.map(({ href, label, icon: Icon }) => {
          const on = path === href || path.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                on ? "bg-brand text-white" : "text-muted hover:bg-navy-700"
              }`}
            >
              <Icon size={18} /> {label}
            </Link>
          );
        })}
      </nav>

      <div className="m-3 rounded-lg bg-navy-700 p-3 text-sm">
        <p className="font-medium text-white">{planName}</p>
        <div className="mt-2 space-y-1 text-xs text-muted">
          <p>
            Embarcações: {vesselsUso}
            {vesselsLimite != null ? ` / ${vesselsLimite}` : ""}
          </p>
          <p>Reservas no mês: {reservasUso}</p>
          {paidUntil && (
            <p className={overdue ? "font-medium text-danger" : ""}>
              {overdue ? "Vencida desde" : "Renova em"} {fmtDate(paidUntil)}
            </p>
          )}
        </div>
        <Link
          href="/planos"
          className="mt-3 block rounded-md bg-brand px-3 py-1.5 text-center text-xs font-medium text-white transition hover:bg-brand-dark"
        >
          Gerenciar plano
        </Link>
      </div>
    </aside>
  );
}
