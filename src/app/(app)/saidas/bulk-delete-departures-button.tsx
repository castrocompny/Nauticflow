"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { getBulkCleanupPreview, clearCompanyDepartures, type BulkCleanupPreview } from "./actions";

// Ação GLOBAL da página (empresa inteira, não a saída de um card) -- fica no
// canto superior direito do PageHeader, de propósito separada de "Adicionar
// saída avulsa" (que continua abaixo do texto explicativo, inalterada).
// Visual deliberadamente "discreto mas claramente perigoso": borda e texto
// vermelhos sempre visíveis (não só no hover), fundo neutro/transparente em
// repouso, hover mais evidente.
export function BulkDeleteDeparturesButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<BulkCleanupPreview | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function openModal() {
    setOpen(true);
    setError("");
    setResult("");
    setPreview(null);
    setLoadingPreview(true);
    const res = await getBulkCleanupPreview();
    setLoadingPreview(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPreview({ wouldDelete: res.wouldDelete, wouldProtect: res.wouldProtect, activeSchedules: res.activeSchedules });
  }

  function close() {
    if (pending) return;
    setOpen(false);
  }

  // Esc fecha o modal -- mesmo padrão já usado em delete-account-form.tsx/tour-card.tsx
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function confirmDelete() {
    startTransition(async () => {
      const res = await clearCompanyDepartures();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(
        res.deleted === 0
          ? "Nenhuma saída foi excluída. Todas possuem reservas vinculadas."
          : `${res.deleted} saída(s) excluída(s). ${res.protected} saída(s) com reservas foram preservadas. ${res.paused} agenda(s) automática(s) foram pausadas.`
      );
      // router.refresh() atualiza esta página (/saidas) na hora; /agenda e
      // /dashboard já foram invalidados no servidor (revalidatePath, ver
      // clearCompanyDepartures em ./actions.ts), então mostram o estado
      // novo assim que o operador navegar até lá -- RealtimeRefresh
      // (departures/reservations) continua funcionando normalmente, sem
      // nenhuma alteração.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-transparent px-3 py-2 text-sm font-medium text-danger transition hover:border-red-400 hover:bg-red-50"
      >
        <Trash2 size={15} />
        Excluir todas as saídas
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={close}>
            <div
              className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-heading">Excluir todas as saídas?</h2>
                <button
                  type="button"
                  onClick={close}
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surfaceHover hover:text-heading"
                >
                  <X size={16} />
                </button>
              </div>

              {!result ? (
                <>
                  <p className="text-sm text-muted">
                    As saídas sem reservas serão excluídas. Saídas que possuem reservas serão preservadas. As
                    agendas automáticas serão pausadas para impedir que novas saídas sejam geradas novamente.
                  </p>

                  {loadingPreview && <p className="mt-3 text-xs text-muted">Calculando...</p>}
                  {error && <p className="mt-3 text-xs text-danger">{error}</p>}
                  {preview && !error && (
                    <ul className="mt-3 space-y-1 rounded-lg border border-line bg-surfaceHover px-3 py-2 text-xs text-body">
                      <li>{preview.wouldDelete} saída(s) serão excluídas</li>
                      <li>{preview.wouldProtect} saída(s) possuem reservas e serão preservadas</li>
                      <li>{preview.activeSchedules} agenda(s) automática(s) serão pausadas</li>
                    </ul>
                  )}

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={close}
                      disabled={pending}
                      className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-heading transition hover:bg-surfaceHover disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmDelete}
                      disabled={pending || loadingPreview || !!error}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
                    >
                      {pending ? "Excluindo..." : "Excluir todas as saídas"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-emerald-700">{result}</p>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-heading transition hover:bg-surfaceHover"
                    >
                      Fechar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
