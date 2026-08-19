"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

type Status = "confirmada" | "pendente";
type Result = { ok: boolean; message: string };

// Menu customizado em vez de <select> nativo -- em Android, um <select> estilizado com
// cor de fundo custom vinha renderizando errado (caixa vazia até clicar, ou o conteúdo
// da coluna vizinha aparecendo por baixo do menu aberto). Controlando o dropdown a gente
// mesmo evita esses problemas de renderização do controle nativo do navegador/OS.
const OPTIONS: { value: Status; label: string; toneClass: string }[] = [
  {
    value: "confirmada",
    label: "confirmada",
    toneClass: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  },
  {
    value: "pendente",
    label: "pendente",
    toneClass: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  },
];

export function ReservationStatusSelect({
  id,
  status,
  action,
}: {
  id: string;
  status: string;
  action: (id: string, status: Status) => Promise<Result>;
}) {
  const [current, setCurrent] = useState<string>(status);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // fecha ao clicar fora, ou ao rolar/redimensionar (o menu é um portal com posição fixa
  // calculada na hora que abre -- mais simples fechar do que ficar recalculando)
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 128) });
    }
    setOpen((v) => !v);
  }

  function choose(next: Status) {
    setOpen(false);
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const r = await action(id, next);
      if (!r.ok) {
        setCurrent(previous);
        setMsg({ ok: false, text: r.message });
        setTimeout(() => setMsg(null), 4000);
      }
    });
  }

  if (current !== "confirmada" && current !== "pendente") {
    return <span className="text-xs text-muted">{current}</span>;
  }

  const currentOption = OPTIONS.find((o) => o.value === current)!;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        ref={btnRef}
        type="button"
        disabled={pending}
        onClick={toggleOpen}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${currentOption.toneClass}`}
      >
        {currentOption.label}
        <ChevronDown size={12} />
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 w-32 rounded-lg border border-line bg-surface py-1 shadow-lg"
          >
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value)}
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-surfaceHover ${
                  o.value === current ? "font-semibold text-heading" : "text-body"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body
        )}
      {msg && <span className="text-[11px] text-danger">{msg.text}</span>}
    </div>
  );
}
