import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import Script from "next/script";
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
    // favicon.png e uma versao quadrada (com padding transparente) do
    // nauticflow-icon.png -- o arquivo original e bem largo (738x341), e
    // navegadores esmagam/cortam imagens nao-quadradas na aba, deixando
    // irreconhecivel em tamanho pequeno
    icon: "/favicon.png",
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
      <body className="font-sans">{children}</body>
    </html>
  );
}
