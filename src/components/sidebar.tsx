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
  ShieldAlert,
  ChevronRight,
} from "lucide-react";
import { Logo } from "@/components/logo";

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
  overdue,
  isSuperAdmin,
}: {
  company: string;
  city: string | null;
  planName: string;
  overdue: boolean;
  isSuperAdmin?: boolean;
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
        {isSuperAdmin && (
          <Link
            href="/admin"
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              path === "/admin" || path.startsWith("/admin/")
                ? "bg-brand text-white"
                : "text-amber-300 hover:bg-navy-700"
            }`}
          >
            <ShieldAlert size={18} /> Super Admin
          </Link>
        )}
      </nav>

      <Link
        href="/planos"
        className="m-3 flex items-center justify-between rounded-lg bg-navy-700 px-3 py-2.5 text-sm transition hover:bg-navy-700/70"
      >
        <span className="truncate text-white">
          {planName}
          {overdue && <span className="ml-1.5 text-xs font-medium text-danger">vencida</span>}
        </span>
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </Link>
    </aside>
  );
}
