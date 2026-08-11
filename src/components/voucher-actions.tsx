"use client";

import { useState } from "react";
import { FileText, Printer, Send } from "lucide-react";

export function VoucherActions({
  reservationId,
  resend,
}: {
  reservationId: string;
  resend: (id: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onResend() {
    setBusy(true);
    setMsg(null);
    const r = await resend(reservationId);
    setBusy(false);
    setMsg({ ok: r.ok, text: r.message });
    setTimeout(() => setMsg(null), 4000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/voucher/${reservationId}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-heading transition hover:bg-surfaceHover"
      >
        <FileText size={15} /> Ver voucher
      </a>
      <a
        href={`/voucher/${reservationId}?print=1`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-heading transition hover:bg-surfaceHover"
      >
        <Printer size={15} /> Imprimir
      </a>
      <button
        onClick={onResend}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        <Send size={15} /> {busy ? "Reenviando..." : "Reenviar voucher"}
      </button>
      {msg && (
        <span className={`text-xs font-medium ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</span>
      )}
    </div>
  );
}
