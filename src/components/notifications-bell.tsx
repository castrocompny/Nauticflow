"use client";

import { useState } from "react";
import { Bell, X } from "lucide-react";

export type Notif = { id: string; title: string; desc?: string };

export function NotificationsBell({ items }: { items: Notif[] }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = items.filter((n) => !dismissed.has(n.id));

  function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover"
        aria-label="Notificações"
      >
        <Bell size={18} />
        {visible.length > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {visible.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed right-4 top-16 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-2 shadow-lg">
            <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Notificações
            </p>
            {visible.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted">
                Nenhuma notificação no momento.
              </p>
            ) : (
              <ul className="space-y-1">
                {visible.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-surfaceHover">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-heading">{n.title}</p>
                      {n.desc && <p className="text-xs text-muted">{n.desc}</p>}
                    </div>
                    <button
                      onClick={() => dismiss(n.id)}
                      title="Dispensar"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:bg-surfaceHover hover:text-heading"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
