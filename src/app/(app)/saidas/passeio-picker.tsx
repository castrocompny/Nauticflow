"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { deleteTour } from "./actions";
import type { Tour } from "@/lib/types";

// Seletor de passeio com botão de excluir ao lado de cada nome (um <select> nativo
// não permite botões dentro das opções, por isso é um dropdown customizado). O valor
// escolhido vai num input escondido "tour_id" pra o form continuar funcionando igual.
export function PasseioPicker({ tours }: { tours: Tour[] }) {
  const [selected, setSelected] = useState(""); // "" = "Novo passeio..."
  const [open, setOpen] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const list = tours.filter((t) => !deletedIds.has(t.id));
  const selectedName = selected ? list.find((t) => t.id === selected)?.name ?? "Novo passeio..." : "Novo passeio...";

  // fecha ao clicar fora
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function handleDelete(id: string, name: string) {
    if (
      !window.confirm(
        `Excluir o passeio "${name}"? Se ele já tiver saídas cadastradas, ele só sai da lista (o histórico das saídas é mantido).`
      )
    )
      return;
    setError("");
    setPendingId(id);
    const fd = new FormData();
    fd.set("id", id);
    const res = await deleteTour(fd);
    setPendingId(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setDeletedIds((prev) => new Set(prev).add(id));
    if (selected === id) setSelected("");
  }

  return (
    <div ref={ref} className="relative">
      <input type="hidden" name="tour_id" value={selected} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-sm text-heading transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      >
        <span className="truncate">{selectedName}</span>
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setSelected("");
              setOpen(false);
            }}
            className="flex w-full items-center px-4 py-2 text-left text-sm text-heading hover:bg-surfaceHover"
          >
            Novo passeio...
          </button>
          {list.map((t) => (
            <div key={t.id} className="flex items-center gap-1 pr-2 hover:bg-surfaceHover">
              <button
                type="button"
                onClick={() => {
                  setSelected(t.id);
                  setOpen(false);
                }}
                className="flex-1 truncate px-4 py-2 text-left text-sm text-heading"
              >
                {t.name}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(t.id, t.name)}
                disabled={pendingId === t.id}
                title="Excluir passeio"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-red-50 hover:text-danger disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
