"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { brl, fmtTime } from "@/lib/format";
import { calculateTotalCents, isSellablePriceType } from "@/lib/price-calc";
import { createCounterReservation, searchClients } from "./actions";

type TourOption = { id: string; name: string; base_price_cents: number; price_type: string };
type DepartureOption = {
  id: string;
  tour_id: string;
  departs_at: string;
  capacity: number;
  price_cents: number | null;
  price_type: string | null;
  vessel_name: string | null;
  available: number;
};
type ClientHit = { id: string; name: string; phone: string | null };

// Total automático a partir do price_type EFETIVO (departure.price_type ??
// tour.price_type -- MESMA prioridade que o marketplace usa, ver
// src/app/api/marketplace/bookings/route.ts:230). 'por_pessoa'/'por_grupo'
// reaproveitam a MESMA função usada pelo ToursFlow (calculateTotalCents,
// agora em src/lib/price-calc.ts) -- nenhuma segunda interpretação. Regra
// pra 'a_partir_de' (decisão desta tela, documentada em DOCUMENTACAO.md):
// não existe cálculo automático de total pra este price_type em NENHUM
// lugar do sistema hoje -- nem o marketplace vende esse tipo (ver
// SELLABLE_PRICE_TYPES) -- então o comportamento aqui é o mais conservador
// possível: nunca multiplica pela quantidade (evitaria inflar um valor "a
// partir de" pra um total inventado maior que o real), só mostra o preço-
// base como ponto de partida, sempre editável.
function autoTotalCents(priceType: string, unitPriceCents: number, quantity: number): number {
  if (isSellablePriceType(priceType)) return calculateTotalCents(priceType, unitPriceCents, quantity);
  return unitPriceCents;
}

function Save({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending || disabled}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar reserva"}
    </button>
  );
}

function centsToReaisInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

// Fluxo: Cliente -> Passeio -> Data -> Horário -> Pessoas -> Valor -> Salvar
// (pedido explícito). Embarcação e capacidade nunca são escolhidas pelo
// operador -- vêm sempre da departure selecionada (estoque único, ver
// migration 0072 e DOCUMENTACAO.md).
export function NewReservationForm({ tours, departures }: { tours: TourOption[]; departures: DepartureOption[] }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState("");

  const [clientMode, setClientMode] = useState<"existing" | "quick">("existing");
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<ClientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientHit | null>(null);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");

  const [tourId, setTourId] = useState("");
  const [date, setDate] = useState("");
  const [departureId, setDepartureId] = useState("");
  const [peopleCount, setPeopleCount] = useState(1);
  // null = automático (recalcula ao mudar pessoas/saída); uma vez que o
  // operador edita o campo manualmente, vira override e para de acompanhar
  // mudanças de "Pessoas" -- só volta a ser automático se outro passeio ou
  // outra saída for escolhido (pickTour/pickDate/pickDeparture resetam pra
  // null). Nenhum useEffect sincronizando estado -- o valor exibido é
  // sempre derivado na hora do render (ver `priceReais` abaixo).
  const [manualPriceReais, setManualPriceReais] = useState<string | null>(null);
  const [originName, setOriginName] = useState("");

  const [state, action] = useActionState(
    async (p: unknown, f: FormData) => {
      const r = await createCounterReservation(p, f);
      if (!r.error) {
        setOpen(false);
        resetForm();
        if ((r as any).info) {
          setToast((r as any).info);
          setTimeout(() => setToast(""), 4500);
        }
      }
      return r;
    },
    { error: "" }
  );

  function resetForm() {
    setClientMode("existing");
    setClientQuery("");
    setClientResults([]);
    setSelectedClient(null);
    setQuickName("");
    setQuickPhone("");
    setTourId("");
    setDate("");
    setDepartureId("");
    setPeopleCount(1);
    setManualPriceReais(null);
    setOriginName("");
  }

  // busca de cliente com debounce -- so dispara com 2+ letras; `cancelled`
  // descarta uma resposta antiga que chegue depois de uma busca mais nova.
  // limpar clientResults/searching pra querys curtas acontece nos handlers
  // (onChange/troca de modo), nunca de forma sincrona dentro do efeito, pra
  // nao encadear renders (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (clientMode !== "existing" || clientQuery.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const hits = await searchClients(clientQuery.trim());
      if (!cancelled) {
        setClientResults(hits);
        setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [clientQuery, clientMode]);

  const tourDepartures = useMemo(() => departures.filter((d) => d.tour_id === tourId), [departures, tourId]);
  const availableDates = useMemo(() => {
    const set = new Set<string>();
    tourDepartures.forEach((d) => set.add(d.departs_at.slice(0, 10)));
    return Array.from(set).sort();
  }, [tourDepartures]);
  const dateDepartures = useMemo(
    () =>
      tourDepartures
        .filter((d) => d.departs_at.slice(0, 10) === date)
        .sort((a, b) => a.departs_at.localeCompare(b.departs_at)),
    [tourDepartures, date]
  );
  const selectedDeparture = departures.find((d) => d.id === departureId) ?? null;
  const selectedTour = tours.find((t) => t.id === tourId) ?? null;

  // preço unitário/base: departure.price_cents quando existir, senão o
  // base_price_cents do passeio (mesma prioridade de sempre); price_type
  // EFETIVO: departure.price_type quando existir, senão o do passeio --
  // idêntico ao que o marketplace já faz (route.ts: "effectivePriceType").
  const unitPriceCents = selectedDeparture ? selectedDeparture.price_cents ?? selectedTour?.base_price_cents ?? 0 : 0;
  const effectivePriceType = selectedDeparture?.price_type ?? selectedTour?.price_type ?? "por_pessoa";
  const autoPriceCents = selectedDeparture ? autoTotalCents(effectivePriceType, unitPriceCents, peopleCount) : 0;
  // valor exibido/enviado: override manual se houver, senão o automático
  // recém-calculado -- deriva a cada render, nunca via useEffect+setState.
  const priceReais = manualPriceReais ?? centsToReaisInput(autoPriceCents);

  function pickTour(id: string) {
    setTourId(id);
    setDate("");
    setDepartureId("");
    setManualPriceReais(null);
  }

  function pickDate(d: string) {
    setDate(d);
    setDepartureId("");
    setManualPriceReais(null);
  }

  function pickDeparture(d: DepartureOption) {
    setDepartureId(d.id);
    // troca de saída sempre reseta um eventual override manual anterior --
    // volta a calcular automaticamente a partir do preço/price_type da NOVA
    // saída (pedido explícito).
    setManualPriceReais(null);
  }

  const overCapacity = !!selectedDeparture && peopleCount > selectedDeparture.available;
  const clientReady = clientMode === "existing" ? !!selectedClient : quickName.trim().length > 0;
  const canSave = !!departureId && clientReady && peopleCount >= 1 && !overCapacity;

  const Toast = toast ? (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg bg-navy px-4 py-3 text-sm text-white shadow-lg">
      {toast}
    </div>
  ) : null;

  if (!open) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          disabled={tours.length === 0}
          className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          + Nova reserva
        </button>
        {Toast}
      </>
    );
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-surface p-5">
      <h3 className="mb-4 font-display font-semibold text-heading">Nova reserva</h3>

      {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}

      <form action={action} className="space-y-5">
        <input type="hidden" name="client_mode" value={clientMode} />
        <input type="hidden" name="client_id" value={selectedClient?.id ?? ""} />
        <input type="hidden" name="departure_id" value={departureId} />

        {/* Cliente */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-heading">Cliente</p>
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setClientMode("existing")}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                clientMode === "existing" ? "border-brand bg-brand text-white" : "border-line text-body hover:bg-surfaceHover"
              }`}
            >
              Buscar cliente existente
            </button>
            <button
              type="button"
              onClick={() => {
                setClientMode("quick");
                setClientQuery("");
                setClientResults([]);
                setSearching(false);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                clientMode === "quick" ? "border-brand bg-brand text-white" : "border-line text-body hover:bg-surfaceHover"
              }`}
            >
              + Criar cliente rápido
            </button>
          </div>

          {clientMode === "existing" ? (
            selectedClient ? (
              <div className="flex items-center justify-between rounded-lg border border-line bg-surfaceHover px-3 py-2 text-sm">
                <span className="font-medium text-heading">
                  {selectedClient.name}
                  {selectedClient.phone ? ` · ${selectedClient.phone}` : ""}
                </span>
                <button type="button" onClick={() => setSelectedClient(null)} className="text-xs font-medium text-brand hover:underline">
                  Trocar
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={clientQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setClientQuery(v);
                    if (v.trim().length < 2) {
                      setClientResults([]);
                      setSearching(false);
                    }
                  }}
                  placeholder="Buscar cliente por nome..."
                  autoComplete="off"
                />
                {clientQuery.trim().length >= 2 && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
                    {searching ? (
                      <p className="px-3 py-2 text-xs text-muted">Buscando...</p>
                    ) : clientResults.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted">Nenhum cliente encontrado.</p>
                    ) : (
                      clientResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedClient(c);
                            setClientQuery("");
                            setClientResults([]);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surfaceHover"
                        >
                          <span className="text-heading">{c.name}</span>
                          {c.phone && <span className="text-xs text-muted">{c.phone}</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Nome</label>
                <input
                  name="client_name"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="mt-1"
                  placeholder="Nome do cliente"
                />
              </div>
              <div>
                <label>Telefone (opcional)</label>
                <input
                  name="client_phone"
                  value={quickPhone}
                  onChange={(e) => setQuickPhone(e.target.value)}
                  className="mt-1"
                  placeholder="22 99999-9999"
                />
              </div>
            </div>
          )}
        </div>

        {/* Passeio */}
        <div>
          <label>Passeio</label>
          <select value={tourId} onChange={(e) => pickTour(e.target.value)} className="mt-1">
            <option value="">Selecione um passeio</option>
            {tours.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Data */}
        {tourId && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-heading">Data</p>
            {availableDates.length === 0 ? (
              <p className="mb-2 text-sm text-muted">Nenhuma data disponível para este passeio.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableDates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => pickDate(d)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                      date === d ? "border-brand bg-brand text-white" : "border-line text-body hover:bg-surfaceHover"
                    }`}
                  >
                    {d.slice(8, 10)}/{d.slice(5, 7)}
                  </button>
                ))}
              </div>
            )}
            <Link href={`/saidas?tour_id=${tourId}`} className="mt-2 inline-block text-xs text-brand hover:underline">
              Criar saída avulsa para este passeio
            </Link>
          </div>
        )}

        {/* Horário */}
        {date && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-heading">Horário</p>
            <div className="flex flex-wrap gap-2">
              {dateDepartures.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => pickDeparture(d)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    departureId === d.id ? "border-brand bg-brand text-white" : "border-line text-body hover:bg-surfaceHover"
                  }`}
                >
                  {fmtTime(d.departs_at)}
                  {d.vessel_name ? ` — ${d.vessel_name}` : ""} — {d.available} vagas
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pessoas + Valor */}
        {departureId && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label>Pessoas</label>
              <input
                name="people_count"
                type="number"
                min={1}
                max={selectedDeparture?.available ?? undefined}
                value={peopleCount}
                onChange={(e) => setPeopleCount(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1"
              />
              <p className={`mt-1 text-xs ${overCapacity ? "text-danger" : "text-muted"}`}>
                {selectedDeparture?.available ?? 0} vagas disponíveis
              </p>
            </div>
            <div>
              <label>Valor da reserva (R$)</label>
              <input
                name="value"
                value={priceReais}
                onChange={(e) => setManualPriceReais(e.target.value)}
                className="mt-1"
                placeholder="320,00"
              />
              {/* ajuda o operador a entender de onde veio o valor -- some
                  assim que ele edita manualmente (vira negociação livre) */}
              {manualPriceReais === null && (
                <p className="mt-1 text-xs text-muted">
                  {effectivePriceType === "por_grupo"
                    ? `${brl(unitPriceCents)} por grupo`
                    : effectivePriceType === "a_partir_de"
                      ? `${brl(unitPriceCents)} a partir de -- ajuste o valor final`
                      : `${brl(unitPriceCents)} por pessoa × ${peopleCount} = ${brl(autoPriceCents)}`}
                </p>
              )}
            </div>
            <div className="col-span-2">
              <label>Origem (parceiro / hotel) -- opcional</label>
              <input
                name="origin_name"
                value={originName}
                onChange={(e) => setOriginName(e.target.value)}
                className="mt-1"
                placeholder="Pousada Águas Claras"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Save disabled={!canSave} />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            className="rounded-lg border border-line px-4 py-2 text-sm text-body"
          >
            Cancelar
          </button>
        </div>
      </form>
      {Toast}
    </div>
  );
}
