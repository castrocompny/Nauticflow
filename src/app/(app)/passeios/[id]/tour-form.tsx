"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Card } from "@/components/ui";
import { updateTourFull } from "../actions";
import type { Tour } from "@/lib/types";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar alterações"}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 font-display text-sm font-semibold text-heading">{children}</h3>;
}

// Reorganização puramente de UX (pedido explícito): os campos que
// validate_tour_for_publishing (migration 0044/0063, única fonte de
// verdade -- nunca duplicada aqui) realmente exige pra publicar ficam
// SEMPRE visíveis, em vez de escondidos atrás de um <details>. `id` de
// cada campo bate 1:1 com o `field` que a RPC devolve em cada erro do
// checklist -- é assim que PublicationPanel consegue rolar/focar o campo
// certo sem duplicar regra nenhuma de validação no front (ver
// publication-panel.tsx).
export function TourForm({ tour }: { tour: Tour }) {
  const [state, action] = useActionState(updateTourFull, { error: "" });
  const slugLocked = !!tour.published_at;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={tour.id} />
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}

      <Card id="dados-passeio-section">
        <SectionTitle>Dados do passeio</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label>Nome do passeio</label>
            <input id="name" name="name" required defaultValue={tour.name} className="mt-1" />
          </div>
          <div>
            <label>Tipo de preço</label>
            <select id="price_type" name="price_type" defaultValue={tour.price_type} className="mt-1">
              <option value="por_pessoa">Por pessoa</option>
              <option value="por_grupo">Por grupo</option>
              <option value="a_partir_de">A partir de</option>
            </select>
          </div>
          <div>
            <label>Preço-base (R$)</label>
            <input
              id="base_price_cents"
              name="base_price_cents"
              type="number"
              min={0}
              step="0.01"
              defaultValue={(tour.base_price_cents / 100).toFixed(2)}
              className="mt-1"
            />
          </div>
          <div>
            <label>Destino</label>
            <input id="destination" name="destination" defaultValue={tour.destination ?? ""} className="mt-1" placeholder="Búzios" />
          </div>
          <div>
            <label>Categoria</label>
            <select id="category" name="category" defaultValue={tour.category ?? ""} className="mt-1">
              <option value="">Selecione...</option>
              <option value="passeio_privativo">Passeio privativo</option>
              <option value="por_do_sol">Pôr do sol</option>
              <option value="praias">Praias</option>
              <option value="ilhas">Ilhas</option>
              <option value="passeio_compartilhado">Passeio compartilhado</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label>Duração (minutos)</label>
            <input id="duration_minutes" name="duration_minutes" type="number" min={1} defaultValue={tour.duration_minutes ?? ""} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <label>Descrição curta (aparece na listagem)</label>
            <input
              id="short_description"
              name="short_description"
              defaultValue={tour.short_description ?? ""}
              maxLength={160}
              className="mt-1"
              placeholder="Uma frase que resume o passeio"
            />
          </div>
          <div className="sm:col-span-2">
            <label>Descrição completa</label>
            <textarea id="description" name="description" defaultValue={tour.description ?? ""} rows={4} className="mt-1" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          Preço-base é o valor de referência exibido na vitrine. Cada saída (em Saídas) pode ter um preço próprio —
          quando definido, ele tem prioridade sobre este preço-base.
        </p>
      </Card>

      <Card id="booking-model-section">
        <SectionTitle>Modelo de reserva</SectionTitle>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 transition has-[:checked]:border-brand has-[:checked]:bg-blue-50">
            <input
              type="radio"
              name="booking_model"
              value="fixed_schedule"
              defaultChecked={tour.booking_model !== "flexible_private"}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-heading">Horários fixos</span>
              <span className="block text-xs text-muted">
                O operador define dias e horários. Vários clientes podem reservar a mesma saída até atingir a capacidade.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 transition has-[:checked]:border-brand has-[:checked]:bg-blue-50">
            <input
              type="radio"
              name="booking_model"
              value="flexible_private"
              defaultChecked={tour.booking_model === "flexible_private"}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-heading">Horário flexível — privativo</span>
              <span className="block text-xs text-muted">
                O cliente escolhe início e fim dentro da disponibilidade definida. A embarcação fica exclusiva durante o
                período.
              </span>
            </span>
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">
          Trocar de modelo é bloqueado enquanto houver agenda ativa, saídas futuras ou reservas em andamento — resolva
          isso primeiro.
        </p>
      </Card>

      <Card id="boarding-section">
        <SectionTitle>Local de embarque</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label>Nome do local</label>
            <input id="boarding_name" name="boarding_name" defaultValue={tour.boarding_name ?? ""} className="mt-1" placeholder="Píer da Orla" />
          </div>
          <div className="sm:col-span-2">
            <label>Endereço</label>
            <input id="boarding_address" name="boarding_address" defaultValue={tour.boarding_address ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Bairro</label>
            <input id="boarding_neighborhood" name="boarding_neighborhood" defaultValue={tour.boarding_neighborhood ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Cidade</label>
            <input id="boarding_city" name="boarding_city" defaultValue={tour.boarding_city ?? ""} className="mt-1" />
          </div>
          <div>
            <label>Estado</label>
            <input id="boarding_state" name="boarding_state" defaultValue={tour.boarding_state ?? ""} maxLength={2} className="mt-1" placeholder="RJ" />
          </div>
          <div>
            <label>CEP</label>
            <input id="boarding_zip_code" name="boarding_zip_code" defaultValue={tour.boarding_zip_code ?? ""} className="mt-1" />
          </div>
        </div>

        <details className="mt-4 border-t border-line pt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted">Mais opções de embarque</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label>Latitude (opcional)</label>
              <input
                id="boarding_latitude"
                name="boarding_latitude"
                type="number"
                step="0.000001"
                defaultValue={tour.boarding_latitude ?? ""}
                className="mt-1"
              />
            </div>
            <div>
              <label>Longitude (opcional)</label>
              <input
                id="boarding_longitude"
                name="boarding_longitude"
                type="number"
                step="0.000001"
                defaultValue={tour.boarding_longitude ?? ""}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <label>Ponto de referência</label>
              <input id="boarding_reference" name="boarding_reference" defaultValue={tour.boarding_reference ?? ""} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label>Instruções de embarque</label>
              <textarea id="boarding_instructions" name="boarding_instructions" defaultValue={tour.boarding_instructions ?? ""} rows={2} className="mt-1" />
            </div>
          </div>
        </details>
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer font-display text-sm font-semibold text-heading">
            Mais detalhes (opcional)
          </summary>
          <div className="mt-4 space-y-5">
            <div>
              <label>Endereço (slug){slugLocked && <span className="text-muted"> — travado após publicar</span>}</label>
              <input
                id="slug"
                name="slug"
                defaultValue={tour.slug}
                disabled={slugLocked}
                className="mt-1 disabled:opacity-60"
                placeholder="passeio-de-lancha-pelas-ilhas"
              />
            </div>

            <div>
              <SectionTitle>Roteiro</SectionTitle>
              <textarea id="itinerary" name="itinerary" defaultValue={tour.itinerary ?? ""} rows={4} placeholder="Passo a passo do passeio, paradas, horários..." />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <SectionTitle>Incluso</SectionTitle>
                <textarea id="included" name="included" defaultValue={tour.included ?? ""} rows={3} placeholder="Ex.: água, guia, colete salva-vidas" />
              </div>
              <div>
                <SectionTitle>Não incluso</SectionTitle>
                <textarea id="not_included" name="not_included" defaultValue={tour.not_included ?? ""} rows={3} placeholder="Ex.: almoço, bebidas alcoólicas" />
              </div>
            </div>

            <div>
              <SectionTitle>Informações importantes</SectionTitle>
              <textarea
                id="important_information"
                name="important_information"
                defaultValue={tour.important_information ?? ""}
                rows={3}
                placeholder="Ex.: levar protetor solar, roupa de banho, documento com foto"
              />
            </div>

            <div>
              <SectionTitle>Política de cancelamento</SectionTitle>
              <textarea id="cancellation_policy" name="cancellation_policy" defaultValue={tour.cancellation_policy ?? ""} rows={3} />
            </div>
          </div>
        </details>
      </Card>

      <Save />
    </form>
  );
}
