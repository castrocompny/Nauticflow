import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  // resolve URLs relativas de Open Graph/Twitter (ex: /og-image.png) pro dominio real
  // em producao, em vez de cair no localhost (aviso do next build).
  metadataBase: new URL("https://nauticflow.com.br"),
  title: "NauticFlow",
  description: "Gestão inteligente para o turismo náutico",
  icons: {
    // favicon.png/ico/apple-icon sao versoes quadradas (padding transparente) do
    // nauticflow-icon.png -- o original e bem largo (738x341), e navegadores esmagam/
    // cortam imagens nao-quadradas na aba. O .ico e essencial: muitos crawlers de
    // preview (Google, apps de chat) pedem /favicon.ico direto e, sem ele (404),
    // caem no globo generico -- era o que acontecia.
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  // confirma pro Google Search Console que o dono do produto é dono do domínio --
  // gera exatamente a <meta name="google-site-verification" content="..."> pedida
  // no passo "Tag HTML" da verificação. Não remover, mesmo depois de verificado.
  verification: {
    google: "dwg3ZYc1M1X51jY8nDRd-GFlbwiQXb2SI0E9LIYivpI",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${poppins.variable}`} suppressHydrationWarning>
      <head>
        {/* aplica o tema salvo antes da pagina pintar, pra nao "piscar" claro e depois escuro */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`
            try {
              var theme = localStorage.getItem('theme');
              if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              if (theme === 'dark') document.documentElement.classList.add('dark');
            } catch (e) {}
          `}
        </Script>
      </head>
      <body className="font-sans">
        {children}
        {/* Vercel Web Analytics -- cookieless e sem coletar PII (não precisa de banner
            de consentimento). Só coleta de verdade depois de ativar "Web Analytics" no
            painel da Vercel; sem isso, é inofensivo. Endpoints same-origin (/_vercel),
            compatível com a CSP atual. */}
        <Analytics />
      </body>
    </html>
  );
}
