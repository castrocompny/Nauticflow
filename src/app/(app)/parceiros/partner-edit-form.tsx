"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updatePartner } from "./actions";

type Partner = {
  id: string;
  name: string;
  type: string;
  contact: string | null;
  commission_rate: number;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar"}
    </button>
  );
}

export function PartnerEditForm({ p, onClose }: { p: Partner; onClose: () => void }) {
  const [state, action] = useFormState(
    async (prev: unknown, f: FormData) => {
      const res = await updatePartner(prev, f);
      if (!res.error) onClose();
      return res;
    },
    { error: "" }
  );

  return (
    <>
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={p.id} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label>Nome</label>
            <input name="name" required defaultValue={p.name} className="mt-1" />
          </div>
          <div>
            <label>Tipo</label>
            <select name="type" className="mt-1" defaultValue={p.type}>
              <option value="hotel">Hotel</option>
              <option value="pousada">Pousada</option>
              <option value="agencia">Agência</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label>Contato</label>
            <input name="contact" defaultValue={p.contact ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Comissão (%)</label>
            <input name="commission_rate" defaultValue={String(p.commission_rate)} className="mt-1" />
          </div>
        </div>
        <div className="flex gap-2">
          <Save />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-body"
          >
            Cancelar
          </button>
        </div>
      </form>
    </>
  );
}
