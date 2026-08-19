"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Envolve tabelas largas: no celular a barra de rolagem nativa fica escondida por padrão
// (comportamento do próprio iOS/Android, não dá pra forçar ela a ficar sempre visível) --
// então em vez de depender da barrinha, mostra uma sombra fixa na borda direita indicando
// "tem mais coisa pra esse lado". Fixa de propósito (não acompanha a posição do scroll):
// só liga/desliga uma vez, com base em ter ou não conteúdo escondido, sem "piscar"
// enquanto a pessoa arrasta.
export function ScrollShadowX({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setHasOverflow(el.scrollWidth > el.clientWidth + 2);
    }

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative">
      <div ref={ref} className="overflow-x-auto">
        {children}
      </div>
      {hasOverflow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent"
        />
      )}
    </div>
  );
}
