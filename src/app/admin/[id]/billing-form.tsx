"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateCompanyBilling } from "../actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar"}
    </button>
  );
}

export function BillingForm({ companyId, cnpj, city }: { companyId: string; cnpj: string; city: string }) {
  const [state, action] = useFormState(updateCompanyBilling, { error: "" });

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="company_id" value={companyId} />
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted">CNPJ ou CPF</label>
          <input name="cnpj" defaultValue={cnpj} className="mt-1" placeholder="00.000.000/0000-00" />
        </div>
        <div>
          <label className="text-xs text-muted">Cidade</label>
          <input name="city" defaultValue={city} className="mt-1" />
        </div>
      </div>
      <Save />
    </form>
  );
}
