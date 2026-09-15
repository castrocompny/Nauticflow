"use client";

import { useSyncExternalStore } from "react";
import { Menu } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { NotificationsBell, type Notif } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";

// "Hoje" nunca muda por conta própria enquanto a aba fica aberta (não
// precisa de um `subscribe` real) -- só não pode ser calculado durante o
// render (ver comentário abaixo), então useSyncExternalStore com um
// getServerSnapshot fixo é o jeito correto, sem violar as regras de
// pureza de render deste projeto.
function subscribeNoop() {
  return () => {};
}
function getServerToday() {
  return "";
}
function getClientToday() {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

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
  // Achado real (auditoria E2E do alerta de reserva, sem relação com o
  // recurso em si -- bug pré-existente, confirmado via teste A/B com/sem
  // ReservationNotifier: o erro de hidratação continuava idêntico mesmo
  // com o notifier desligado): `new Date()` direto no corpo do render é
  // impuro -- o servidor calcula num instante, a hidratação no navegador
  // recalcula num instante ligeiramente diferente (e potencialmente noutro
  // fuso, já que o runtime da Vercel não roda em America/Sao_Paulo) -- o
  // texto renderizado pode divergir e o React derruba a árvore inteira com
  // erro de hidratação (#418, "text mismatch"). Corrigido com
  // useSyncExternalStore (nunca calculado durante o render em si).
  const today = useSyncExternalStore(subscribeNoop, getClientToday, getServerToday);
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
