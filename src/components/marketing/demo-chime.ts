"use client";

// Som da DEMONSTRACAO da landing -- reimplementacao isolada, de proposito.
//
// O alerta real do app vive em `src/lib/reservation-alerts/chime.ts`. Aquele
// arquivo foi lido como REFERENCIA (mesmas duas notas, mesmo envelope, mesmo
// volume discreto) mas NAO e importado aqui: a landing publica nunca deve
// depender de codigo do app autenticado -- isso criaria um acoplamento que
// faria uma mudanca de produto no alerta interno quebrar (ou alterar
// silenciosamente) a pagina de vendas. Sao duas coisas com ciclos de vida
// diferentes que so por acaso soam igual.
//
// Diferenca deliberada em relacao ao app: aqui NAO existe nenhum listener de
// "desbloqueio no primeiro toque". O AudioContext so e criado dentro do
// clique explicito em "Simular nova reserva" -- ou seja, som nenhum pode
// tocar sem uma acao direta da pessoa, nunca automaticamente ao carregar ou
// ao rolar a pagina.

let ctx: AudioContext | null = null;

type WithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

export function playDemoChime() {
  if (typeof window === "undefined") return;

  // respeita reduced-motion tambem para som: quem pede menos estimulo nao
  // recebe o "dlim" -- o toast visual continua aparecendo normalmente.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as WithWebkit).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.16; // discreto de proposito, nunca agressivo
    master.connect(ctx.destination);

    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
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
    // som e um extra -- uma falha aqui nunca pode quebrar a landing
  }
}
