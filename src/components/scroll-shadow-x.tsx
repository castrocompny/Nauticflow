"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Envolve tabelas largas: no celular a barra de rolagem nativa fica escondida por padrão
// (comportamento do próprio iOS/Android, não dá pra forçar ela a ficar sempre visível) --
// então em vez de depender da barrinha, mostra uma sombra na borda de quem tiver mais
// conteúdo pra rolar. Some sozinha quando chega no fim daquele lado.
export function ScrollShadowX({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setShowLeft(el.scrollLeft > 2);
      setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div ref={ref} className="overflow-x-auto">
        {children}
      </div>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent transition-opacity ${
          showLeft ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent transition-opacity ${
          showRight ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
