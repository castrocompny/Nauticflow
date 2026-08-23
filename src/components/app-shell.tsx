"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import type { Notif } from "@/components/notifications-bell";

// Sidebar e Topbar precisam compartilhar o estado de "menu aberto no celular" (o botão
// ☰ fica no Topbar, mas quem abre/fecha é a Sidebar) -- como layout.tsx é Server
// Component (busca dados com cookies()), esse estado não pode morar lá. Esse wrapper
// client concentra só a parte visual que precisa de estado; os dados continuam sendo
// buscados no servidor e passados como props simples (serializáveis).
export function AppShell({
  sidebar,
  topbar,
  banner,
  children,
}: {
  sidebar: {
    company: string;
    city: string | null;
    planName: string;
    overdue: boolean;
    isSuperAdmin: boolean;
    isStaff: boolean;
  };
  topbar: { name: string; role: string; notifications: Notif[] };
  banner: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar {...sidebar} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar {...topbar} onMenuClick={() => setMobileOpen((v) => !v)} />
        {banner}
        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
