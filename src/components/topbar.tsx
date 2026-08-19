"use client";

import { Menu } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { NotificationsBell, type Notif } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";

export function Topbar({
  name,
  role,
  notifications,
  onMenuClick,
}: {
  name: string;
  role: string;
  notifications: Notif[];
  onMenuClick?: () => void;
}) {
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <button
        onClick={onMenuClick}
        aria-label="Abrir menu"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-body hover:bg-surfaceHover lg:hidden"
      >
        <Menu size={20} />
      </button>
      <div className="flex flex-1 items-center justify-end gap-4">
        <p className="hidden text-xs capitalize text-muted sm:block">{today}</p>
        <ThemeToggle />
        <NotificationsBell items={notifications} />
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy text-sm font-semibold text-white">
            {initial}
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-medium text-heading">{name}</p>
            <p className="text-xs text-muted">{role}</p>
          </div>
        </div>
        <form action={signOut}>
          <button className="rounded-lg border border-line px-3 py-2 text-sm text-body transition hover:bg-surfaceHover">
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
