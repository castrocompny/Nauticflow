"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setPayoutAccount } from "./payout-actions";
import { PIX_KEY_TYPES, type PixKeyType } from "@/lib/payout-accounts";

const TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  evp: "Chave aleatória (EVP)",
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar chave Pix"}
    </button>
  );
}

export function PayoutAccountForm({ hasExisting }: { hasExisting: boolean }) {
  const [open, setOpen] = useState(!hasExisting);
  const [type, setType] = useState<PixKeyType>("cpf");
  const [state, action] = useActionState(setPayoutAccount, { error: "" });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-line px-3 py-2.5 text-sm text-brand transition hover:bg-blue-50"
      >
        Trocar chave Pix
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Tipo de chave</label>
        <select
          name="pix_key_type"
          value={type}
          onChange={(e) => setType(e.target.value as PixKeyType)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        >
          {PIX_KEY_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Chave Pix</label>
        <input
          name="pix_key_value"
          type="text"
          required
          placeholder={type === "email" ? "voce@exemplo.com" : type === "evp" ? "chave aleatória (UUID)" : "somente números"}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Chave Pix salva. A titularidade ainda não é verificada pelo provedor.</p>}
      <div className="flex gap-2">
        <Save />
        {hasExisting && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-line px-4 py-2 text-sm text-body hover:bg-surfaceHover"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
