import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0D1B3E",
          900: "#0A1430",
          800: "#0D1B3E",
          700: "#13264F",
          600: "#1B335F",
        },
        brand: {
          DEFAULT: "#2563EB",
          light: "#2D9CFF",
          dark: "#1D4ED8",
        },
        ok: "#16A34A",
        purpleflow: "#7C3AED",
        amberflow: "#F59E0B",
        danger: "#DC2626",
        // "page" mantido por compatibilidade (varios arquivos ainda podem referenciar);
        // aponta pro mesmo valor do token novo "app".
        page: "#F4F6FA",

        // tokens reativos ao tema, resolvidos via variavel CSS (ver globals.css).
        // uso: fundo de pagina, fundo de cartao/painel, texto de titulo/corpo/legenda, borda.
        // bg-navy/bg-brand/etc continuam fixos de proposito (identidade visual do menu
        // lateral e de acentos coloridos nao deve inverter com o tema).
        // rgb(var / <alpha-value>): unico jeito do modificador de opacidade do Tailwind
        // (ex: bg-app/60, bg-surface/90) funcionar numa cor vinda de variavel CSS -- antes
        // "app"/"surface" apontavam direto pro hex (var(--bg-app)) e QUALQUER classe com
        // "/NN" (bg-surface/90 etc.) silenciosamente nao aplicava opacidade nenhuma (bug
        // achado tentando o efeito vidro do menu da landing).
        app: "rgb(var(--bg-app-rgb) / <alpha-value>)",
        surface: "rgb(var(--bg-surface-rgb) / <alpha-value>)",
        surfaceHover: "rgb(var(--bg-surface-hover-rgb) / <alpha-value>)",
        heading: "var(--text-heading)",
        body: "var(--text-body)",
        muted: "var(--text-muted)",
        line: "var(--border-line)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-poppins)", "var(--font-inter)", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
      },
    },
  },
  plugins: [],
};
export default config;
