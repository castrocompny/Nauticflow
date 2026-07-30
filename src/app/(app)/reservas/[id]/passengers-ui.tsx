"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addPassenger } from "./passenger-actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Adicionar"}
    </button>
  );
}

export function AddPassengerForm({
  reservationId,
  remaining,
}: {
  reservationId: string;
  remaining: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(
    async (p: unknown, f: FormData) => {
      const r = await addPassenger(p, f);
      if (!r.error) setOpen(false);
      return r;
    },
    { error: "" }
  );

  if (remaining <= 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-center text-sm text-slate-400">
        Lista completa. A reserva não comporta mais passageiros.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-brand transition hover:bg-blue-50"
      >
        + Adicionar passageiro ({remaining} {remaining === 1 ? "vaga restante" : "vagas restantes"})
      </button>
    );
  }

  return (
    <div className="rounded-card border border-slate-200 bg-white p-4">
      {state.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="reservation_id" value={reservationId} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Nome</label>
            <input name="name" required className="mt-1" />
          </div>
          <div>
            <label>Documento (CPF / passaporte)</label>
            <input name="document" className="mt-1" />
          </div>
          <div>
            <label>Nacionalidade</label>
            <input name="nationality" className="mt-1" placeholder="BR" />
          </div>
          <div>
            <label>Data de nascimento</label>
            <input name="birth_date" type="date" className="mt-1" />
          </div>
          <div className="col-span-2">
            <label>Contato de emergência</label>
            <input name="emergency_contact" className="mt-1" />
          </div>
        </div>
        <div className="flex gap-2">
          <Save />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
