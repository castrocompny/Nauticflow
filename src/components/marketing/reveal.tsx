"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Entrada suave (opacity + translateY curto) quando a secao entra na viewport.
// O estilo vive em motion.tsx; aqui so existe o gatilho.
//
// De proposito SEM estado de React: o observer escreve direto o atributo
// `data-revealed` no proprio no do DOM. Revelar e exatamente o caso de uso de
// um efeito (sincronizar um sistema externo -- o DOM), e assim nao ha render em
// cascata nem o risco de `setState` dentro de efeito. Como o valor renderizado
// por React (`"false"`) nunca muda entre renders, o React tambem nunca
// sobrescreve o atributo que o observer ja marcou como `"true"` -- mesmo quando
// o componente pai re-renderiza (e o de fluxo re-renderiza a cada etapa).
//
// `revealed` comeca `false` no servidor E no cliente -- nunca diverge, entao
// nao ha erro de hidratacao.
//
// Falha sempre para "visivel": sem IntersectionObserver (navegador antigo,
// ambiente de teste), marca revelado na hora em vez de deixar o conteudo
// escondido para sempre. Sob `prefers-reduced-motion` o CSS ignora tudo isso e
// mantem o conteudo visivel e estatico, e sem JS nenhum o <noscript> de
// motion.tsx faz o mesmo.
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      el.dataset.revealed = "true";
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.dataset.revealed = "true";
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.04 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-revealed="false"
      className={`nf-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
