"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { updateBookingModel } from "../actions";
import type { TourBookingModel } from "@/lib/types";

const OPTIONS: { value: TourBookingModel; title: string; description: string }[] = [
  {
    value: "fixed_schedule",
    title: "Horário fixo — agenda",
    description: "Saídas com dia e hora definidos, vendidas por vaga (agenda recorrente ou datas específicas).",
  },
  {
    value: "flexible_private",
    title: "Horário flexível — privativo",
    description: "O cliente escolhe início e fim dentro de uma janela de disponibilidade que você configura.",
  },
];

// Seletor de tours.booking_model (migration 0073), extraído do form grande de
// TourForm (achado de UX visual, seção 135): salva sozinho, com feedback
// imediato, em vez de depender do botão "Salvar alterações" distante. O
// `selected` sempre parte do valor PERSISTIDO (`persistedModel`) e volta pra
// ele em qualquer falha/bloqueio -- nunca fica "quicando" com um valor que não
// existe no banco. `blockedReason` vem pronto do server (page.tsx, a partir de
// dados já buscados lá) pra desabilitar de verdade a opção bloqueada ANTES do
// clique, sem exigir uma nova query nem tocar no gatilho
// check_tour_booking_model_transition.
export function BookingModelSection({
  tourId,
  persistedModel,
  blockedReason,
}: {
  tourId: string;
  persistedModel: TourBookingModel;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<TourBookingModel>(persistedModel);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function choose(value: TourBookingModel) {
    if (value === selected || isPending) return;
    setError("");
    startTransition(async () => {
      const result = await updateBookingModel(tourId, value);
      if (result.ok) {
        setSelected(value);
        router.refresh();
      } else {
        setSelected(persistedModel);
        setError(result.error);
      }
    });
  }

  return (
    <Card id="booking-model-section">
      <h3 className="mb-1 font-display text-sm font-semibold text-heading">Modelo de reserva</h3>
      <p className="mb-3 text-xs text-muted">Define como este passeio é vendido -- escolha antes de configurar a disponibilidade abaixo.</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          const isDisabled = !isSelected && !!blockedReason;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={isDisabled || isPending}
              onClick={() => choose(opt.value)}
              aria-pressed={isSelected}
              className={`rounded-lg border p-3 text-left transition ${
                isSelected
                  ? "border-brand bg-brand text-white"
                  : isDisabled
                    ? "cursor-not-allowed border-line bg-surface text-muted opacity-60"
                    : "border-line bg-surface text-body hover:bg-surfaceHover"
              } ${isPending ? "opacity-70" : ""}`}
            >
              <span className={`block text-sm font-medium ${isSelected ? "text-white" : ""}`}>{opt.title}</span>
              <span className={`mt-0.5 block text-xs ${isSelected ? "text-white/80" : "text-muted"}`}>{opt.description}</span>
            </button>
          );
        })}
      </div>

      {blockedReason && <p className="mt-3 text-xs text-amber-700">{blockedReason}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </Card>
  );
}
