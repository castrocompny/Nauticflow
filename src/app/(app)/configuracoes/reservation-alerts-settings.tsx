"use client";

import { useState, useSyncExternalStore } from "react";
import { Card } from "@/components/ui";
import { playReservationChime, unlockAudioOnFirstInteraction } from "@/lib/reservation-alerts/chime";
import {
  isReservationSoundEnabled,
  setReservationSoundEnabled,
  isReservationNotificationPreferenceEnabled,
  setReservationNotificationPreferenceEnabled,
  subscribeReservationPreferences,
  notifyReservationPreferencesChanged,
} from "@/lib/reservation-alerts/preferences";

// Configuração do alerta de nova reserva (som + notificação do navegador) --
// puramente client-side: lê/grava localStorage (ver preferences.ts pro
// porquê de não ser uma tabela ainda) e a Notification API do próprio
// navegador, nunca chama nenhuma Server Action.
//
// useSyncExternalStore (não useState+useEffect): localStorage/Notification.
// permission são fontes IMPURAS, indisponíveis durante o render no servidor
// -- este projeto usa as regras de pureza de render mais recentes do React
// (proíbem setState direto dentro de um efeito só pra sincronizar com algo
// externo). getServerSnapshot devolve o mesmo default sempre, então o
// primeiro render (servidor e hidratação) nunca diverge; depois disso, cada
// `set*` em preferences.ts chama `notify()` e este componente re-lê sozinho.
function getServerSoundSnapshot() {
  return true;
}
function getServerNotificationPrefSnapshot() {
  return false;
}
function getPermissionSnapshot(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}
function getServerPermissionSnapshot(): NotificationPermission | "unsupported" {
  return "unsupported";
}

export function ReservationAlertsSettings() {
  const soundEnabled = useSyncExternalStore(subscribeReservationPreferences, isReservationSoundEnabled, getServerSoundSnapshot);
  const notificationPref = useSyncExternalStore(
    subscribeReservationPreferences,
    isReservationNotificationPreferenceEnabled,
    getServerNotificationPrefSnapshot
  );
  const permission = useSyncExternalStore(subscribeReservationPreferences, getPermissionSnapshot, getServerPermissionSnapshot);
  const [testFeedback, setTestFeedback] = useState("");

  function toggleSound(checked: boolean) {
    setReservationSoundEnabled(checked);
  }

  // Nunca pede permissão automaticamente (pedido explícito) -- só quando o
  // próprio operador marca a caixa, um gesto real dele. Se o navegador já
  // tinha negado antes (fora do NauticFlow), não dá pra pedir de novo --
  // browsers bloqueiam re-prompt depois de uma negação explícita; nesse caso
  // só mostramos a explicação de como reativar manualmente.
  async function toggleNotification(checked: boolean) {
    if (!checked) {
      setReservationNotificationPreferenceEnabled(false);
      return;
    }

    if (permission === "unsupported" || permission === "denied") return; // caixa continua desmarcada -- explicação já aparece embaixo
    if (permission === "granted") {
      setReservationNotificationPreferenceEnabled(true);
      return;
    }

    const result = await Notification.requestPermission();
    notifyReservationPreferencesChanged(); // avisa o snapshot de `permission` que mudou
    if (result === "granted") {
      setReservationNotificationPreferenceEnabled(true);
    }
  }

  function testAlert() {
    unlockAudioOnFirstInteraction();
    // o clique no botão já É a interação do usuário -- toca direto, sem
    // esperar o listener genérico (que só liga o AudioContext, não toca nada
    // sozinho).
    if (soundEnabled) playReservationChime();
    setTestFeedback("Nova reserva recebida — Passeio de teste · 2 passageiros · agora");
    window.setTimeout(() => setTestFeedback(""), 4000);

    if (notificationPref && permission === "granted" && typeof window !== "undefined" && "Notification" in window) {
      try {
        new Notification("Nova reserva — NauticFlow", { body: "Passeio de teste · 2 passageiros · agora", tag: "reservation-test" });
      } catch {
        // notificação de teste é só um extra -- nunca quebra a tela de configurações
      }
    }
  }

  return (
    <Card className="h-fit lg:col-span-3">
      <h2 className="mb-1 font-display font-semibold text-heading">Alertas de novas reservas</h2>
      <p className="mb-3 text-xs text-muted">
        Avisa quando uma reserva vinda do ToursFlow ou de um parceiro entra no sistema. Reservas de balcão criadas por
        você não geram alerta.
      </p>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-body">
          <input type="checkbox" checked={soundEnabled} onChange={(e) => toggleSound(e.target.checked)} className="accent-brand" />
          Som de nova reserva
        </label>

        <div>
          <label className="flex items-center gap-2 text-sm text-body">
            <input
              type="checkbox"
              checked={notificationPref && permission === "granted"}
              disabled={permission === "unsupported"}
              onChange={(e) => toggleNotification(e.target.checked)}
              className="accent-brand disabled:opacity-60"
            />
            Notificação do navegador
          </label>
          {permission === "unsupported" && (
            <p className="mt-1 text-xs text-muted">Este navegador não suporta notificações.</p>
          )}
          {permission === "denied" && (
            <p className="mt-1 text-xs text-muted">
              As notificações estão bloqueadas para o NauticFlow nas configurações do seu navegador. Permita manualmente
              e recarregue a página para ativar.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={testAlert}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-body transition hover:border-brand"
          >
            Testar alerta
          </button>
          {testFeedback && <p className="text-xs text-muted">{testFeedback}</p>}
        </div>
      </div>
    </Card>
  );
}
