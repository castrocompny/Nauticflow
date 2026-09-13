"use client";

// Alerta de nova reserva -- som gerado por código via Web Audio API, nunca um
// arquivo de áudio externo (evita qualquer questão de licença/hospedagem pra
// um "ding" de duas notas curtas). Dois osciladores em sequência (880Hz depois
// 1318.5Hz, ~90ms de intervalo), envelope de ganho com ataque rápido e
// decaimento exponencial -- soa como um "dlim" discreto, nunca uma música,
// nunca mais que ~0.5s no total.
let audioContext: AudioContext | null = null;
let unlockAttached = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  return audioContext;
}

// Política de autoplay do navegador: um AudioContext nasce (ou permanece)
// "suspended" até haver uma interação real do usuário na página -- nunca dá
// pra tocar som nenhum antes disso, e tentar contornar isso não é uma opção
// (pedido explícito). Esta função registra um listener genérico, uma única
// vez, no primeiro clique/toque/tecla em QUALQUER lugar do app autenticado --
// quando ele dispara, cria/retoma o AudioContext, então o alerta sonoro já
// está pronto para tocar assim que a primeira reserva relevante chegar depois
// disso. Chamar de novo depois do primeiro unlock não faz nada (idempotente).
export function unlockAudioOnFirstInteraction() {
  if (unlockAttached || typeof window === "undefined") return;
  unlockAttached = true;
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {
        // se falhar, o pior caso é o alerta sonoro ficar mudo -- nunca quebra o resto do app
      });
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function playReservationChime() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "suspended") return; // sem interação prévia do usuário ainda, não tenta tocar
  try {
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.18; // volume discreto de propósito -- nunca agressivo
    master.connect(ctx.destination);

    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // som é um extra opcional -- uma falha aqui nunca pode quebrar o resto do app
  }
}
