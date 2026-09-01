"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createWithdrawal } from "./withdrawal-actions";
import { Badge } from "@/components/ui";
import { brl } from "@/lib/format";
import type { WithdrawalDTO } from "./withdrawal-actions";

const STATUS_LABEL: Record<string, string> = {
  pending: "Saque solicitado",
  processing: "Processando",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  pending: "amber",
  processing: "amber",
  completed: "green",
  failed: "red",
  cancelled: "slate",
};

function Confirm() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Solicitando..." : "Confirmar saque"}
    </button>
  );
}

export function WithdrawalPanel({
  availableCents,
  payoutMasked,
  canWithdraw,
  blockedReason,
}: {
  availableCents: number;
  payoutMasked: string | null;
  canWithdraw: boolean;
  blockedReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  // fecha o painel automaticamente depois de um saque bem-sucedido -- dentro
  // da própria action (mesmo padrão de AddPassengerForm,
  // src/app/(app)/reservas/[id]/passengers-ui.tsx), nunca via useEffect
  // reagindo ao estado (setState síncrono em efeito é desencorajado).
  const [state, action] = useActionState(
    async (prev: { error: string; ok?: boolean; id?: string }, formData: FormData) => {
      const result = await createWithdrawal(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    { error: "" },
  );

  if (!canWithdraw) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-xs text-muted">
        {blockedReason ?? "Saque indisponível no momento."}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={availableCents <= 0}
        className="mt-3 w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-40"
      >
        Sacar
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3 rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-muted">Saldo disponível: {brl(availableCents)}</p>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Valor do saque (R$)</label>
        <input
          name="amount_reais"
          type="number"
          step="0.01"
          min="0.01"
          max={availableCents / 100}
          required
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>
      <p className="text-xs text-muted">Conta Pix de destino: {payoutMasked}</p>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Confirm />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-4 py-2 text-sm text-body hover:bg-surfaceHover"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function WithdrawalHistory({ withdrawals }: { withdrawals: WithdrawalDTO[] }) {
  if (withdrawals.length === 0) {
    return <p className="text-sm text-muted">Nenhum saque solicitado ainda.</p>;
  }
  return (
    <div className="space-y-2">
      {withdrawals.map((w) => (
        <div key={w.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2">
          <div>
            <p className="text-sm font-medium text-heading">{brl(w.amountCents)}</p>
            <p className="text-xs text-muted">
              {w.payoutPixKeyMasked ?? "-"} · {new Date(w.requestedAt).toLocaleDateString("pt-BR")}
            </p>
            {w.status === "failed" && w.failureReasonSafe && <p className="text-xs text-danger">{w.failureReasonSafe}</p>}
          </div>
          <Badge tone={STATUS_TONE[w.status] ?? "slate"}>{STATUS_LABEL[w.status] ?? w.status}</Badge>
        </div>
      ))}
    </div>
  );
}
