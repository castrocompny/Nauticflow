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
  X,
} from "lucide-react";
import { Logo } from "@/components/logo";

const navGroups = [
  {
    label: "Operação",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/reservas", label: "Reservas", icon: ClipboardList },
      { href: "/agenda", label: "Agenda", icon: CalendarDays },
      { href: "/saidas", label: "Saídas", icon: Anchor },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { href: "/clientes", label: "Clientes", icon: Users },
      { href: "/embarcacoes", label: "Embarcações", icon: Ship },
      { href: "/parceiros", label: "Parceiros", icon: Handshake },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: Wallet },
      { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
      { href: "/equipe", label: "Equipe", icon: UserCog },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export function Sidebar({
  company,
  city,
  planName,
  overdue,
  isSuperAdmin,
  mobileOpen = false,
  onNavigate,
}: {
  company: string;
  city: string | null;
  planName: string;
  overdue: boolean;
  isSuperAdmin?: boolean;
  mobileOpen?: boolean;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const initial = (company || "?").trim().charAt(0).toUpperCase();
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-navy text-slate-200 transition-transform duration-200 lg:static lg:translate-x-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between px-5 py-5">
        <Logo />
        <button
          onClick={onNavigate}
          aria-label="Fechar menu"
          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-navy-700 lg:hidden"
        >
          <X size={18} />
        </button>
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

      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {navGroups.map((group, i) => (
          <div key={group.label ?? i} className="space-y-1">
            {group.label && (
              <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">{group.label}</p>
            )}
            {group.items.map(({ href, label, icon: Icon }) => {
              const on = path === href || path.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    on ? "bg-brand text-white" : "text-slate-300 hover:bg-navy-700 hover:text-white"
                  }`}
                >
                  <Icon size={18} /> {label}
                </Link>
              );
            })}
          </div>
        ))}
        {isSuperAdmin && (
          <Link
            href="/admin"
            onClick={onNavigate}
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
        onClick={onNavigate}
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
