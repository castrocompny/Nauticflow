"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
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
      className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition hover:bg-surfaceHover"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
