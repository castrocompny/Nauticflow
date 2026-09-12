"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { brl, fmtTime, saoPauloToUTC } from "@/lib/format";
import { calculateTotalCents, isSellablePriceType } from "@/lib/price-calc";
import { createCounterReservation, createFlexibleCounterReservation, getVesselOccupiedPeriods, searchClients } from "./actions";

type TourOption = {
  id: string;
  name: string;
  base_price_cents: number;
  price_type: string;
  booking_model: string;
  duration_minutes: number | null;
};
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
type FlexibleRuleOption = {
  tour_id: string;
  vessel_id: string;
  vessel_name: string | null;
  vessel_capacity: number;
  days_of_week: number[];
  window_start: string;
  window_end: string;
  min_duration_minutes: number;
  max_duration_minutes: number;
  slot_interval_minutes: number;
  pricing_mode: string;
  hourly_price_cents: number | null;
};
type ClientHit = { id: string; name: string; phone: string | null };
type OccupiedPeriod = { starts_at: string; ends_at: string | null };

// Total automático a partir do price_type EFETIVO (departure.price_type ??
// tour.price_type -- MESMA prioridade que o marketplace usa, ver
// src/app/api/marketplace/bookings/route.ts:230). 'por_pessoa'/'por_grupo'
// reaproveitam a MESMA função usada pelo ToursFlow (calculateTotalCents,
// em src/lib/price-calc.ts) -- nenhuma segunda interpretação. 'a_partir_de'
// não tem cálculo automático de total em NENHUM lugar do sistema -- nunca
// multiplica, só mostra o preço-base como ponto de partida (decisão desta
// tela, documentada em DOCUMENTACAO.md).
function autoTotalCents(priceType: string, unitPriceCents: number, quantity: number): number {
  if (isSellablePriceType(priceType)) return calculateTotalCents(priceType, unitPriceCents, quantity);
  return unitPriceCents;
}

// Preço automático do privativo flexível (seção 21, pedido explícito): modo
// 'fixed' sugere tour.base_price_cents (independente da duração); modo
// 'per_hour' sugere hourly_price_cents × duração, proporcional aos minutos
// (2h30 = 2,5×, nunca arredondado pra hora cheia).
function flexAutoPriceCents(rule: FlexibleRuleOption, tour: TourOption, durationMinutes: number): number {
  if (rule.pricing_mode === "per_hour" && rule.hourly_price_cents != null) {
    return Math.round((rule.hourly_price_cents * durationMinutes) / 60);
  }
  return tour.base_price_cents;
}

function formatDurationHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function centsToReaisInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function toDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Próximas datas permitidas pelos days_of_week da regra flexível -- nunca
// pré-gera saídas (isso só monta uma LISTA de datas clicáveis; a departure
// real só nasce no momento da reserva, ver create_flexible_counter_reservation).
function nextAllowedDates(daysOfWeek: number[], count: number): string[] {
  const dates: string[] = [];
  const start = new Date();
  for (let i = 0; dates.length < count && i < 60; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (daysOfWeek.includes(d.getDay())) dates.push(toDateISO(d));
  }
  return dates;
}

// HH:MM (5 chars) de um "HH:MM:SS" vindo do banco (type `time` do Postgres).
function hhmm(t: string): string {
  return t.slice(0, 5);
}

function minutesSinceMidnight(hhmmStr: string): number {
  const [h, m] = hhmmStr.split(":").map(Number);
  return h * 60 + m;
}

function addMinutesToTime(hhmmStr: string, minutes: number): string {
  const total = Math.max(0, minutesSinceMidnight(hhmmStr) + minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

// Fluxo fixed_schedule: Cliente -> Passeio -> Data -> Horário -> Pessoas ->
// Valor -> Salvar (sem regressão, idêntico ao já aprovado). Fluxo
// flexible_private: Cliente -> Passeio -> Data -> Início -> Término ->
// Pessoas -> Valor -> Salvar (a departure nasce na hora da reserva, nunca
// pré-gerada). Embarcação e capacidade nunca são escolhidas pelo operador em
// nenhum dos dois -- vêm sempre da departure/regra (estoque único, ver
// migrations 0072/0073 e DOCUMENTACAO.md).
export function NewReservationForm({
  tours,
  departures,
  flexibleRules,
}: {
  tours: TourOption[];
  departures: DepartureOption[];
  flexibleRules: FlexibleRuleOption[];
}) {
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
  const [departureId, setDepartureId] = useState(""); // fixed_schedule só
  const [flexStart, setFlexStart] = useState(""); // flexible_private só, "HH:MM"
  const [flexEnd, setFlexEnd] = useState("");
  const [occupiedPeriods, setOccupiedPeriods] = useState<OccupiedPeriod[]>([]);
  const [loadingOccupied, setLoadingOccupied] = useState(false);
  const [peopleCount, setPeopleCount] = useState(1);
  const [manualPriceReais, setManualPriceReais] = useState<string | null>(null);
  const [originName, setOriginName] = useState("");

  const selectedTour = tours.find((t) => t.id === tourId) ?? null;
  const isFlexible = selectedTour?.booking_model === "flexible_private";
  const flexRule = isFlexible ? flexibleRules.find((r) => r.tour_id === tourId) ?? null : null;

  const fixedAction = useActionState(
    async (p: unknown, f: FormData) => {
      const r = await createCounterReservation(p, f);
      if (!r.error) finishSuccess(r);
      return r;
    },
    { error: "" }
  );
  const flexAction = useActionState(
    async (p: unknown, f: FormData) => {
      const r = await createFlexibleCounterReservation(p, f);
      if (!r.error) finishSuccess(r);
      return r;
    },
    { error: "" }
  );
  const [state, action] = isFlexible ? flexAction : fixedAction;

  function finishSuccess(r: { info?: string }) {
    setOpen(false);
    resetForm();
    if (r.info) {
      setToast(r.info);
      setTimeout(() => setToast(""), 4500);
    }
  }

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
    setFlexStart("");
    setFlexEnd("");
    setOccupiedPeriods([]);
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

  // ===== fixed_schedule: data/horário a partir das departures existentes =====
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

  const unitPriceCents = selectedDeparture ? selectedDeparture.price_cents ?? selectedTour?.base_price_cents ?? 0 : 0;
  const effectivePriceType = selectedDeparture?.price_type ?? selectedTour?.price_type ?? "por_pessoa";
  const autoPriceCents = selectedDeparture ? autoTotalCents(effectivePriceType, unitPriceCents, peopleCount) : 0;

  // ===== flexible_private: datas permitidas + períodos ocupados =====
  const flexAvailableDates = useMemo(() => (flexRule ? nextAllowedDates(flexRule.days_of_week, 14) : []), [flexRule]);
  const flexDurationMinutes = flexStart && flexEnd ? minutesSinceMidnight(flexEnd) - minutesSinceMidnight(flexStart) : 0;
  const flexAutoCents =
    flexRule && selectedTour && flexDurationMinutes > 0 ? flexAutoPriceCents(flexRule, selectedTour, flexDurationMinutes) : 0;

  // valor exibido/enviado (os dois fluxos): override manual se houver, senão
  // o automático recém-calculado -- deriva a cada render, nunca via
  // useEffect+setState (a causa raiz de um bug real já corrigido nesta
  // mesma tela: o preço travava porque dependia de um efeito pra recalcular).
  const priceReais = manualPriceReais ?? centsToReaisInput(isFlexible ? flexAutoCents : autoPriceCents);

  function pickTour(id: string) {
    setTourId(id);
    setDate("");
    setDepartureId("");
    setFlexStart("");
    setFlexEnd("");
    setOccupiedPeriods([]);
    setManualPriceReais(null);
  }

  function pickDate(d: string) {
    setDate(d);
    setDepartureId("");
    setManualPriceReais(null);
    if (isFlexible && flexRule) {
      setFlexStart("");
      setFlexEnd("");
      setLoadingOccupied(true);
      getVesselOccupiedPeriods(flexRule.vessel_id, d)
        .then(setOccupiedPeriods)
        .finally(() => setLoadingOccupied(false));
    }
  }

  function pickDeparture(d: DepartureOption) {
    setDepartureId(d.id);
    // troca de saída sempre reseta um eventual override manual anterior --
    // volta a calcular automaticamente a partir do preço/price_type da NOVA
    // saída (pedido explícito).
    setManualPriceReais(null);
  }

  function pickFlexStart(t: string) {
    setFlexStart(t);
    if (flexRule) setFlexEnd(addMinutesToTime(t, flexRule.min_duration_minutes));
    setManualPriceReais(null);
  }

  const overCapacity = isFlexible
    ? !!flexRule && peopleCount > flexRule.vessel_capacity
    : !!selectedDeparture && peopleCount > selectedDeparture.available;
  const availableSpotsHint = isFlexible ? flexRule?.vessel_capacity ?? 0 : selectedDeparture?.available ?? 0;
  const clientReady = clientMode === "existing" ? !!selectedClient : quickName.trim().length > 0;
  const flexPeriodReady = isFlexible
    ? !!flexRule && !!date && !!flexStart && !!flexEnd && flexDurationMinutes > 0
    : !!departureId;
  const canSave = flexPeriodReady && clientReady && peopleCount >= 1 && !overCapacity;

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
        {isFlexible ? (
          <>
            <input type="hidden" name="tour_id" value={tourId} />
            <input type="hidden" name="starts_at" value={date && flexStart ? saoPauloToUTC(date, flexStart) : ""} />
            <input type="hidden" name="ends_at" value={date && flexEnd ? saoPauloToUTC(date, flexEnd) : ""} />
          </>
        ) : (
          <input type="hidden" name="departure_id" value={departureId} />
        )}

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

        {/* ===== FIXED_SCHEDULE: Data + Horário a partir de departures existentes ===== */}
        {!isFlexible && tourId && (
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

        {!isFlexible && date && (
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

        {/* ===== FLEXIBLE_PRIVATE: Data + Início + Término ===== */}
        {isFlexible && tourId && !flexRule && (
          <p className="text-sm text-muted">
            Este passeio ainda não tem disponibilidade configurada. Configure em Passeios → este passeio → Disponibilidade do
            passeio privativo.
          </p>
        )}

        {isFlexible && flexRule && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-heading">Data</p>
            <div className="flex flex-wrap gap-2">
              {flexAvailableDates.map((d) => (
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
            <p className="mt-1 text-xs text-muted">
              {flexRule.vessel_name} · janela {hhmm(flexRule.window_start)}–{hhmm(flexRule.window_end)}
            </p>
          </div>
        )}

        {isFlexible && flexRule && date && (
          <div>
            {loadingOccupied ? (
              <p className="mb-2 text-xs text-muted">Verificando horários ocupados...</p>
            ) : occupiedPeriods.length > 0 ? (
              <div className="mb-3 space-y-1">
                <p className="text-xs font-medium text-muted">Horários já ocupados nesta embarcação:</p>
                {occupiedPeriods.map((p, i) => (
                  <p key={i} className="text-xs text-muted">
                    Indisponível: {fmtTime(p.starts_at)}
                    {p.ends_at ? `–${fmtTime(p.ends_at)}` : ""}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mb-3 text-xs text-muted">Nenhum horário ocupado nesta embarcação neste dia.</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Horário de início</label>
                <input
                  type="time"
                  value={flexStart}
                  step={flexRule.slot_interval_minutes * 60}
                  min={hhmm(flexRule.window_start)}
                  max={hhmm(flexRule.window_end)}
                  onChange={(e) => pickFlexStart(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label>Horário de término</label>
                <input
                  type="time"
                  value={flexEnd}
                  min={flexStart || hhmm(flexRule.window_start)}
                  max={hhmm(flexRule.window_end)}
                  onChange={(e) => {
                    setFlexEnd(e.target.value);
                    setManualPriceReais(null);
                  }}
                  className="mt-1"
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-muted">
              Duração mínima {formatDurationHours(flexRule.min_duration_minutes)} · máxima{" "}
              {formatDurationHours(flexRule.max_duration_minutes)}
              {flexDurationMinutes > 0 ? ` · selecionada: ${formatDurationHours(flexDurationMinutes)}` : ""}
            </p>
          </div>
        )}

        {/* Pessoas + Valor */}
        {flexPeriodReady && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label>Pessoas</label>
              <input
                name="people_count"
                type="number"
                min={1}
                max={availableSpotsHint || undefined}
                value={peopleCount}
                onChange={(e) => setPeopleCount(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1"
              />
              <p className={`mt-1 text-xs ${overCapacity ? "text-danger" : "text-muted"}`}>
                {availableSpotsHint} {isFlexible ? "lugares (capacidade da embarcação)" : "vagas disponíveis"}
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
              {manualPriceReais === null && !isFlexible && (
                <p className="mt-1 text-xs text-muted">
                  {effectivePriceType === "por_grupo"
                    ? `${brl(unitPriceCents)} por grupo`
                    : effectivePriceType === "a_partir_de"
                      ? `${brl(unitPriceCents)} a partir de -- ajuste o valor final`
                      : `${brl(unitPriceCents)} por pessoa × ${peopleCount} = ${brl(autoPriceCents)}`}
                </p>
              )}
              {manualPriceReais === null && isFlexible && flexRule && flexDurationMinutes > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {flexRule.pricing_mode === "per_hour" && flexRule.hourly_price_cents != null
                    ? `${brl(flexRule.hourly_price_cents)}/h × ${formatDurationHours(flexDurationMinutes)} = ${brl(flexAutoCents)}`
                    : "Valor fixo sugerido para este passeio"}
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
