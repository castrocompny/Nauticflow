"use client";

import { useFormState, useFormStatus } from "react-dom";
import { registerInvoice } from "../actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Registrar nota"}
    </button>
  );
}

export function InvoiceForm({ companyId, suggestedAmount }: { companyId: string; suggestedAmount: string }) {
  const [state, action] = useFormState(registerInvoice, { error: "" });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="company_id" value={companyId} />
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted">Número da nota</label>
          <input name="number" className="mt-1" placeholder="Ex: 2026/00042" />
        </div>
        <div>
          <label className="text-xs text-muted">Valor (R$)</label>
          <input name="amount" defaultValue={suggestedAmount} className="mt-1" placeholder="297,00" />
        </div>
        <div>
          <label className="text-xs text-muted">Data de emissão</label>
          <input name="issued_at" type="date" defaultValue={today} className="mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted">Link do PDF (opcional)</label>
          <input name="pdf_url" type="url" className="mt-1" placeholder="https://..." />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted">Observações (opcional)</label>
          <input name="notes" className="mt-1" />
        </div>
      </div>
      <Save />
    </form>
  );
}
