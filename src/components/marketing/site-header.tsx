"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { MKT_LINKS, MKT_NAV } from "./plans";

// Lockup de logo proprio da landing: o <Logo/> padrao usa texto branco (pensado
// pro fundo navy do menu). Aqui o header e claro/escuro, entao o nome usa tokens
// de tema (text-heading/brand) pra ler nos dois -- exceto por cima do hero (ver
// "onNavy" abaixo), que e sempre navy fixo, nao reage ao tema.
function MarketingLogo({ onNavy }: { onNavy: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-1.5 shadow-sm">
        <img src="/nauticflow-icon.png" alt="NauticFlow" className="h-6 w-auto object-contain" />
      </span>
      <span className="font-display text-lg font-semibold leading-none tracking-tight">
        <span className={onNavy ? "text-white" : "text-heading"}>Nautic</span>
        <span className={onNavy ? "text-brand-light" : "text-brand"}>Flow</span>
      </span>
    </span>
  );
}

// Header sempre com efeito vidro (fundo translucido + blur), do topo ao fim da pagina.
// A letra que muda de cor conforme o fundo por baixo -- branca por cima do hero (sempre
// navy, escuro e saturado demais pra confiar só em opacidade alta o tempo todo), escura
// nas demais seções (claras). Detecta isso com IntersectionObserver no próprio hero
// (id="topo") em vez de "rolou X px": o hero tem altura variável (mobile/desktop, quebra
// de linha do título), então um número fixo de pixels não acompanha onde ele realmente
// termina.
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  // "atTop": bem no topo, scroll em 0 -- nesse estado especifico o fundo fica branco
  // solido (nao o vidro navy), como se fosse a barra de endereco do navegador. Assim
  // que rola so um pouco (ainda em cima do hero), vira vidro navy com letra branca.
  const [atTop, setAtTop] = useState(true);
  const onNavy = heroVisible && !atTop;

  useEffect(() => {
    const heroEl = document.getElementById("topo");
    if (!heroEl) return;
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), {
      // -64px no topo = altura do header (h-16): so conta como "ainda sobre o hero"
      // enquanto sobra hero visivel abaixo da faixa do header
      rootMargin: "-64px 0px 0px 0px",
      threshold: 0,
    });
    observer.observe(heroEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY <= 1);
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
      // "fixed" (nao "sticky"): nao reserva espaco no fluxo, entao o hero (bg-navy)
      // comeca exatamente no topo da pagina, por baixo do header -- ver o padding-top
      // extra em hero.tsx que compensa a altura do header (h-16) pro conteudo nao
      // ficar coberto.
      className={`fixed inset-x-0 top-0 z-50 shadow-sm backdrop-blur-md transition-colors ${
        onNavy ? "border-b border-white/10 bg-white/10" : "border-b border-line bg-surface/90"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-8">
        <a href="#topo" aria-label="NauticFlow — início" className="shrink-0">
          <MarketingLogo onNavy={onNavy} />
        </a>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Principal">
          {MKT_NAV.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-brand-light ${
                onNavy ? "text-slate-100" : "text-heading hover:text-brand"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle borderClassName={onNavy ? "border-white/30" : "border-slate-300"} />
          <a
            href={MKT_LINKS.login}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              onNavy ? "text-slate-100 hover:text-brand-light" : "text-heading hover:text-brand"
            }`}
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
          <ThemeToggle borderClassName={onNavy ? "border-white/30" : "border-slate-300"} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            className={`grid h-9 w-9 place-items-center rounded-lg border ${
              onNavy && !open ? "border-white/20 text-white" : "border-line text-heading"
            }`}
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
