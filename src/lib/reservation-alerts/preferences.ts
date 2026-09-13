"use client";

// Preferência do alerta de nova reserva -- primeira versão, guardada em
// localStorage (por navegador/usuário), não numa tabela do banco. Decisão
// registrada em DOCUMENTACAO.md: não existe hoje nenhuma infraestrutura de
// "preferências do usuário" no schema (nenhuma tabela `user_preferences` ou
// equivalente), e criar uma migration nova só para duas flags booleanas sem
// nenhum dado sensível e sem necessidade real de sincronizar entre
// dispositivos seria desproporcional para esta primeira versão. Migrar para
// uma tabela de verdade, se um dia isso for necessário (ex.: sincronizar a
// preferência entre o notebook e o celular do operador), é uma mudança
// isolada nestas duas funções -- nenhum outro código depende de onde o valor
// mora fisicamente.
const SOUND_KEY = "nauticflow:reservation-sound-enabled";
const NOTIFICATION_KEY = "nauticflow:reservation-notification-enabled";

// Pub-sub mínimo pra permitir ler estas preferências via useSyncExternalStore
// (única forma correta, sem violar as regras de pureza de render deste
// projeto, de sincronizar um componente com uma fonte externa como
// localStorage) -- cada `set*` abaixo chama `notify()` depois de escrever,
// então qualquer componente assinado via useSyncExternalStore re-lê o valor
// automaticamente, sem precisar de setState dentro de useEffect.
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((listener) => listener());
}
export function subscribeReservationPreferences(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage pode falhar (modo privado, quota excedida) -- a preferência
    // simplesmente não persiste entre sessões, nunca quebra o app por isso
  }
}

// Som ligado por padrão -- é o comportamento mais útil pro operador (avisar de
// uma reserva nova é o objetivo do recurso); ele decide desligar se quiser.
export function isReservationSoundEnabled(): boolean {
  return readBool(SOUND_KEY, true);
}
export function setReservationSoundEnabled(value: boolean) {
  writeBool(SOUND_KEY, value);
  notify();
}

// Notificação do navegador exige opt-in explícito (nunca ligada por padrão) --
// além da permissão do próprio navegador (Notification.permission), que é
// controlada pelo browser, não por este valor. Esta preferência só decide se,
// dado que a permissão já está concedida, o NauticFlow deve efetivamente
// disparar a notificação -- permite o operador "desligar" sem precisar mexer
// na permissão do navegador em si.
export function isReservationNotificationPreferenceEnabled(): boolean {
  return readBool(NOTIFICATION_KEY, false);
}
export function setReservationNotificationPreferenceEnabled(value: boolean) {
  writeBool(NOTIFICATION_KEY, value);
  notify();
}

// Notification.permission não é escrito por nós (só o browser muda depois de
// Notification.requestPermission()) -- exportado aqui só pra quem já chamou
// requestPermission() avisar os componentes assinados que o snapshot mudou,
// reaproveitando o MESMO pub-sub acima em vez de duplicar um novo.
export function notifyReservationPreferencesChanged() {
  notify();
}
