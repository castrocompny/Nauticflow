"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { MKT_LINKS, MKT_NAV } from "./plans";

// Lockup de logo proprio da landing: o <Logo/> padrao usa texto branco (pensado
// pro fundo navy do menu). Aqui o header e claro/escuro, entao o nome usa tokens
// de tema (text-heading/brand) pra ler nos dois. O icone fica num chip branco.
function MarketingLogo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-1.5 shadow-sm">
        <img src="/nauticflow-icon.png" alt="NauticFlow" className="h-6 w-auto object-contain" />
      </span>
      <span className="font-display text-lg font-semibold leading-none tracking-tight">
        <span className="text-heading">Nautic</span>
        <span className="text-brand">Flow</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // trava o scroll do body quando o menu mobile esta aberto
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors ${
        scrolled
          ? "border-line bg-surface/90 backdrop-blur-md"
          : "border-transparent bg-surface/60 backdrop-blur-sm"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-8">
        <a href="#topo" aria-label="NauticFlow — início" className="shrink-0">
          <MarketingLogo />
        </a>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Principal">
          {MKT_NAV.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-body transition-colors hover:text-brand"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <a
            href={MKT_LINKS.login}
            className="rounded-lg px-4 py-2 text-sm font-medium text-body transition-colors hover:text-brand"
          >
            Entrar
          </a>
          <a
            href={MKT_LINKS.signup}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            Começar grátis
          </a>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line text-heading"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-surface md:hidden">
          <nav className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 py-4 sm:px-6" aria-label="Mobile">
            {MKT_NAV.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-base font-medium text-body hover:bg-surfaceHover"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2">
              <a
                href={MKT_LINKS.login}
                onClick={() => setOpen(false)}
                className="w-full rounded-lg border border-line py-2.5 text-center text-sm font-medium text-heading"
              >
                Entrar
              </a>
              <a
                href={MKT_LINKS.signup}
                onClick={() => setOpen(false)}
                className="w-full rounded-lg bg-brand py-2.5 text-center text-sm font-semibold text-white"
              >
                Começar grátis
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
