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

export function TourForm({ tour }: { tour: Tour }) {
  const [state, action] = useActionState(updateTourFull, { error: "" });
  const slugLocked = !!tour.published_at;

  return (
    <Card>
      {state?.error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <form action={action} className="space-y-6">
        <input type="hidden" name="id" value={tour.id} />

        <div>
          <SectionTitle>Informações básicas</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label>Nome do passeio</label>
              <input name="name" required defaultValue={tour.name} className="mt-1" />
            </div>
            <div>
              <label>Endereço (slug){slugLocked && <span className="text-muted"> — travado após publicar</span>}</label>
              <input
                name="slug"
                defaultValue={tour.slug}
                disabled={slugLocked}
                className="mt-1 disabled:opacity-60"
                placeholder="passeio-de-lancha-pelas-ilhas"
              />
            </div>
            <div>
              <label>Destino</label>
              <input name="destination" defaultValue={tour.destination ?? ""} className="mt-1" placeholder="Búzios" />
            </div>
            <div>
              <label>Categoria</label>
              <select name="category" defaultValue={tour.category ?? ""} className="mt-1">
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
              <input name="duration_minutes" type="number" min={1} defaultValue={tour.duration_minutes ?? ""} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label>Descrição curta (aparece na listagem)</label>
              <input
                name="short_description"
                defaultValue={tour.short_description ?? ""}
                maxLength={160}
                className="mt-1"
                placeholder="Uma frase que resume o passeio"
              />
            </div>
            <div className="sm:col-span-2">
              <label>Descrição completa</label>
              <textarea name="description" defaultValue={tour.description ?? ""} rows={4} className="mt-1" />
            </div>
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <SectionTitle>Preço</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label>Tipo de preço</label>
              <select name="price_type" defaultValue={tour.price_type} className="mt-1">
                <option value="por_pessoa">Por pessoa</option>
                <option value="por_grupo">Por grupo</option>
                <option value="a_partir_de">A partir de</option>
              </select>
            </div>
            <div>
              <label>Preço-base (R$)</label>
              <input
                name="base_price_cents"
                type="number"
                min={0}
                step="0.01"
                defaultValue={(tour.base_price_cents / 100).toFixed(2)}
                className="mt-1"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Este é o preço de referência exibido na vitrine. Cada saída (em Saídas) pode ter um preço específico
            próprio — quando definido, ele tem prioridade sobre este preço-base.
          </p>
        </div>

        <div className="border-t border-line pt-5">
          <SectionTitle>Roteiro</SectionTitle>
          <textarea name="itinerary" defaultValue={tour.itinerary ?? ""} rows={4} placeholder="Passo a passo do passeio, paradas, horários..." />
        </div>

        <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
          <div>
            <SectionTitle>Incluso</SectionTitle>
            <textarea name="included" defaultValue={tour.included ?? ""} rows={3} placeholder="Ex.: água, guia, colete salva-vidas" />
          </div>
          <div>
            <SectionTitle>Não incluso</SectionTitle>
            <textarea name="not_included" defaultValue={tour.not_included ?? ""} rows={3} placeholder="Ex.: almoço, bebidas alcoólicas" />
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <SectionTitle>Informações importantes</SectionTitle>
          <textarea
            name="important_information"
            defaultValue={tour.important_information ?? ""}
            rows={3}
            placeholder="Ex.: levar protetor solar, roupa de banho, documento com foto"
          />
        </div>

        <div className="border-t border-line pt-5">
          <SectionTitle>Política de cancelamento</SectionTitle>
          <textarea name="cancellation_policy" defaultValue={tour.cancellation_policy ?? ""} rows={3} />
        </div>

        <div className="border-t border-line pt-5">
          <SectionTitle>Local de embarque</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label>Nome do local</label>
              <input name="boarding_name" defaultValue={tour.boarding_name ?? ""} className="mt-1" placeholder="Píer da Orla" />
            </div>
            <div className="sm:col-span-2">
              <label>Endereço</label>
              <input name="boarding_address" defaultValue={tour.boarding_address ?? ""} className="mt-1" />
            </div>
            <div>
              <label>Bairro</label>
              <input name="boarding_neighborhood" defaultValue={tour.boarding_neighborhood ?? ""} className="mt-1" />
            </div>
            <div>
              <label>Cidade</label>
              <input name="boarding_city" defaultValue={tour.boarding_city ?? ""} className="mt-1" />
            </div>
            <div>
              <label>Estado</label>
              <input name="boarding_state" defaultValue={tour.boarding_state ?? ""} maxLength={2} className="mt-1" placeholder="RJ" />
            </div>
            <div>
              <label>CEP</label>
              <input name="boarding_zip_code" defaultValue={tour.boarding_zip_code ?? ""} className="mt-1" />
            </div>
            <div>
              <label>Latitude (opcional)</label>
              <input name="boarding_latitude" type="number" step="0.000001" defaultValue={tour.boarding_latitude ?? ""} className="mt-1" />
            </div>
            <div>
              <label>Longitude (opcional)</label>
              <input name="boarding_longitude" type="number" step="0.000001" defaultValue={tour.boarding_longitude ?? ""} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label>Ponto de referência</label>
              <input name="boarding_reference" defaultValue={tour.boarding_reference ?? ""} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label>Instruções de embarque</label>
              <textarea name="boarding_instructions" defaultValue={tour.boarding_instructions ?? ""} rows={2} className="mt-1" />
            </div>
          </div>
        </div>

        <Save />
      </form>
    </Card>
  );
}
