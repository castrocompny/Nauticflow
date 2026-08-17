"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

type Result = { error: string } | void;

export function DeleteButton({
  action,
  id,
  confirmText = "Tem certeza que deseja excluir?",
  extraFields,
}: {
  action: (formData: FormData) => Promise<Result>;
  id: string;
  confirmText?: string;
  extraFields?: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handle() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("id", id);
    if (extraFields) for (const [k, v] of Object.entries(extraFields)) fd.set(k, v);
    const res = await action(fd);
    setBusy(false);
    if (res && res.error) {
      setMsg({ type: "err", text: res.error });
    } else {
      setMsg({ type: "ok", text: "Excluído com sucesso." });
      setTimeout(() => setMsg(null), 2500);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        title="Excluir"
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:border-red-200 hover:bg-red-50 hover:text-danger disabled:opacity-50"
      >
        <Trash2 size={16} />
      </button>
      {msg && (
        <div
          onClick={() => setMsg(null)}
          className={`fixed bottom-4 right-4 z-50 max-w-sm cursor-pointer rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
            msg.type === "ok" ? "bg-ok" : "bg-danger"
          }`}
        >
          {msg.text}
        </div>
      )}
    </>
  );
}
