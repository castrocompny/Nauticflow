"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/format";
import { playReservationChime, unlockAudioOnFirstInteraction } from "@/lib/reservation-alerts/chime";
import { isReservationSoundEnabled, isReservationNotificationPreferenceEnabled } from "@/lib/reservation-alerts/preferences";

// Alerta de nova reserva -- listener GLOBAL (montado uma vez em layout.tsx,
// fora de qualquer tela específica) que assina `postgres_changes` (INSERT em
// `reservations`) e avisa o operador com toast + som + notificação do
// navegador quando a reserva vem de uma origem EXTERNA (marketplace/partner)
// -- nunca para 'manual' (reserva de balcão: o próprio operador acabou de
// criar, avisar seria ruído). Mesmo padrão de auth/RLS já validado em
// RealtimeRefresh (`src/components/realtime-refresh.tsx`): o Realtime só
// entrega o evento pra quem a RLS de SELECT já deixaria ver aquela linha --
// nunca um filtro de company_id do lado do cliente, a mesma policy de sempre
// é quem decide isso.
//
// 'origin_name' (0000/0035) é texto livre complementar (nome do hotel/
// indicação) -- NÃO é a mesma coisa que 'source' (canal estruturado,
// migration 0035): a decisão de alertar usa sempre `source`, nunca
// `origin_name`.
const SOURCES_THAT_ALERT = new Set(["marketplace", "partner"]);

type AlertPayload = {
  id: string;
  tourName: string;
  clientName: string | null;
  peopleCount: number;
  departsAt: string | null;
  source: string;
};

const BROADCAST_CHANNEL_NAME = "nauticflow:reservation-alert";
// Desempate determinístico entre abas (seção 11): cada aba que recebe o MESMO
// evento (Realtime entrega a cada aba com sua própria subscrição -- não é uma
// mensagem única compartilhada) faz um "claim" com seu próprio tabId + um
// timestamp de alta resolução, transmite pelo BroadcastChannel, espera uma
// janela curta por claims de outras abas do MESMO evento, e todas as abas
// calculam o MESMO vencedor a partir do mesmo conjunto de claims (menor
// timestamp, empate por tabId) -- sem precisar de um líder eleito
// previamente nem de nenhuma coordenação central. Só a aba vencedora toca som
// e dispara a Notification; toast aparece em todas (é só "atualizar a UI
// normalmente", pedido explícito da seção 11).
const CLAIM_WINDOW_MS = 150;
const TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export function ReservationNotifier() {
  const router = useRouter();
  const [toast, setToast] = useState<AlertPayload | null>(null);
  const seenIdsRef = useRef<string[]>([]);
  const seenIdsSetRef = useRef<Set<string>>(new Set());
  // Date.now() é impuro -- não pode ser chamado durante o render (nem como
  // argumento de useRef). Fica null até o efeito de assinatura abaixo
  // preenchê-lo (mutação de ref dentro de efeito é sempre segura, só
  // setState em efeito puro é o que o lint proíbe).
  const mountedAtMsRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const claimsRef = useRef<Map<string, { tabId: string; ts: number }[]>>(new Map());

  useEffect(() => {
    unlockAudioOnFirstInteraction();
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channelRef.current = bc;
    bc.onmessage = (event) => {
      const data = event.data as { reservationId?: string; tabId?: string; ts?: number } | null;
      if (!data?.reservationId || !data.tabId || typeof data.ts !== "number") return;
      const list = claimsRef.current.get(data.reservationId) ?? [];
      list.push({ tabId: data.tabId, ts: data.ts });
      claimsRef.current.set(data.reservationId, list);
    };
    return () => {
      bc.close();
      channelRef.current = null;
    };
  }, []);

  const remember = useCallback((id: string) => {
    if (seenIdsSetRef.current.has(id)) return false;
    seenIdsSetRef.current.add(id);
    seenIdsRef.current.push(id);
    // mantém a lista de "já visto" pequena -- só interessa dedupe recente,
    // nunca precisa crescer indefinidamente numa sessão longa
    if (seenIdsRef.current.length > 200) {
      const oldest = seenIdsRef.current.shift();
      if (oldest) seenIdsSetRef.current.delete(oldest);
    }
    return true;
  }, []);

  const arbitrateAndAlert = useCallback(
    (payload: AlertPayload) => {
      const myClaim = { tabId: TAB_ID, ts: performance.now() };
      const list = claimsRef.current.get(payload.id) ?? [];
      list.push(myClaim);
      claimsRef.current.set(payload.id, list);
      channelRef.current?.postMessage({ reservationId: payload.id, tabId: TAB_ID, ts: myClaim.ts });

      window.setTimeout(() => {
        const claims = claimsRef.current.get(payload.id) ?? [];
        claimsRef.current.delete(payload.id);
        const winner = [...claims].sort((a, b) => a.ts - b.ts || a.tabId.localeCompare(b.tabId))[0];
        if (winner?.tabId !== TAB_ID) return;

        if (isReservationSoundEnabled()) playReservationChime();

        if (
          isReservationNotificationPreferenceEnabled() &&
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            const body = [
              payload.tourName,
              `${payload.peopleCount} passageiro${payload.peopleCount === 1 ? "" : "s"}`,
              payload.departsAt ? fmtTime(payload.departsAt) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const notification = new Notification("Nova reserva — NauticFlow", { body, tag: `reservation-${payload.id}` });
            notification.onclick = () => {
              window.focus();
              router.push(`/reservas/${payload.id}`);
              notification.close();
            };
          } catch {
            // Notification pode falhar (config do SO, navegador) -- nunca quebra o resto do app
          }
        }
      }, CLAIM_WINDOW_MS);
    },
    [router]
  );

  useEffect(() => {
    mountedAtMsRef.current = Date.now();
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // mesmo achado/fix já documentado em RealtimeRefresh: o Realtime precisa do
    // access_token da sessão (não só a apikey anônima) pra RLS liberar os
    // eventos -- setAuth ANTES de criar/assinar o canal.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      const c = supabase.channel("reservation-notifier");
      channel = c;
      c.on("postgres_changes", { event: "INSERT", schema: "public", table: "reservations" }, async (event) => {
        const row = event.new as {
          id: string;
          source: string;
          created_at: string;
          people_count: number;
        } | null;
        if (!row?.id) return;
        if (!remember(row.id)) return; // dedupe (seção 10)
        if (!SOURCES_THAT_ALERT.has(row.source)) return; // 'manual' nunca alerta
        // defesa extra contra reconexão reenviando algo antigo (seção 10) --
        // Realtime já não faz isso por design (só transmite mudanças a partir
        // do momento da assinatura), mas custa nada garantir de novo aqui.
        if (mountedAtMsRef.current != null && new Date(row.created_at).getTime() < mountedAtMsRef.current) return;

        // payload do INSERT só traz as colunas cruas de `reservations` -- uma
        // busca extra (mesma sessão, mesma RLS) pra montar o conteúdo legível
        // do toast/notificação (nome do passeio, cliente, horário da saída).
        const { data: full } = await supabase
          .from("reservations")
          .select("id, people_count, clients(name), departures(departs_at, tours(name))")
          .eq("id", row.id)
          .maybeSingle();

        const joined = full as unknown as {
          people_count: number;
          clients: { name: string } | null;
          departures: { departs_at: string; tours: { name: string } | null } | null;
        } | null;

        const alertPayload: AlertPayload = {
          id: row.id,
          tourName: joined?.departures?.tours?.name ?? "Passeio",
          clientName: joined?.clients?.name ?? null,
          peopleCount: joined?.people_count ?? row.people_count,
          departsAt: joined?.departures?.departs_at ?? null,
          source: row.source,
        };

        setToast(alertPayload);
        window.setTimeout(() => setToast((current) => (current?.id === alertPayload.id ? null : current)), 8000);
        arbitrateAndAlert(alertPayload);
      });
      c.subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [remember, arbitrateAndAlert]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-lg">
      <p className="font-display font-semibold text-heading">Nova reserva recebida</p>
      <p className="mt-1 text-body">{toast.tourName}</p>
      {toast.clientName && <p className="text-xs text-muted">Cliente: {toast.clientName}</p>}
      <p className="text-xs text-muted">
        {toast.peopleCount} passageiro{toast.peopleCount === 1 ? "" : "s"}
        {toast.departsAt ? ` · ${fmtDate(toast.departsAt)} às ${fmtTime(toast.departsAt)}` : ""}
      </p>
      <p className="mt-1 text-xs text-muted">Origem: {sourceLabel(toast.source)}</p>
    </div>
  );
}

function sourceLabel(source: string): string {
  if (source === "marketplace") return "ToursFlow";
  if (source === "partner") return "Parceiro";
  return source;
}
