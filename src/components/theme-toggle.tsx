"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ borderClassName = "border-line" }: { borderClassName?: string } = {}) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // le o estado real (definido pelo script anti-flash em layout.tsx antes da hidratacao)
    // -- precisa comecar como false no SSR/1a renderizacao do client pra bater com o HTML
    // do servidor, so corrige depois de montado. Padrao intencional, nao um efeito solto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      title={dark ? "Mudar para modo claro" : "Mudar para modo escuro"}
      className={`grid h-9 w-9 place-items-center rounded-lg border ${borderClassName} text-muted transition hover:bg-surfaceHover`}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
