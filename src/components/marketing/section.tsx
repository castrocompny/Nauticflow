import type { ReactNode } from "react";

// Cabecalho padrao das secoes da landing (eyebrow + titulo + subtitulo).
// Existe pra nao repetir as mesmas ~12 linhas de markup em cada secao e, mais
// importante, pra garantir que TODAS usem a mesma escala tipografica -- a pagina
// tem muitas secoes e qualquer variacao ad-hoc de tamanho/espacamento aparece na
// hora como "template generico". `onNavy` troca os tokens de tema (text-heading/
// text-body) pelas cores fixas usadas sobre os blocos navy, que nao invertem com
// o tema claro/escuro.
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  onNavy = false,
  align = "center",
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onNavy?: boolean;
  align?: "center" | "left";
}) {
  const centered = align === "center";
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-2xl"}>
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
          onNavy
            ? "border-white/20 bg-white/10 text-brand-light"
            : "border-brand/20 bg-brand/5 text-brand"
        }`}
      >
        {eyebrow}
      </span>
      <h2
        className={`mt-4 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl ${
          onNavy ? "text-white" : "text-heading"
        }`}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-4 text-lg leading-relaxed ${onNavy ? "text-slate-300" : "text-body"}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// Moldura de "janela de navegador" usada em todos os mockups de produto da
// landing. Mockup e sempre fixo no tema escuro (o app e escuro) -- e uma
// demonstracao desenhada em HTML/CSS, nunca um print da conta real nem dado de
// Producao.
export function WindowChrome({ label, live = false }: { label: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-white/5 px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
      <span className="ml-3 truncate text-[11px] font-medium text-slate-500">{label}</span>
      {live && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          ao vivo
        </span>
      )}
    </div>
  );
}
