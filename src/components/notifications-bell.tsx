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
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50"
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
          <div className="absolute right-0 z-40 mt-2 w-72 rounded-card border border-slate-200 bg-white p-2 shadow-lg">
            <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Notificações
            </p>
            {visible.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-slate-500">
                Nenhuma notificação no momento.
              </p>
            ) : (
              <ul className="space-y-1">
                {visible.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-navy">{n.title}</p>
                      {n.desc && <p className="text-xs text-slate-500">{n.desc}</p>}
                    </div>
                    <button
                      onClick={() => dismiss(n.id)}
                      title="Dispensar"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-navy"
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
