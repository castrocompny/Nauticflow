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
  title: "NauticFlow",
  description: "Gestão inteligente para o turismo náutico",
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
        {/* widget de chat de suporte (Tawk.to) -- lazyOnload pra nao competir
            com o carregamento/hidratacao da pagina em si */}
        <Script id="tawk-to" strategy="lazyOnload">
          {`
            var Tawk_API = Tawk_API || {};
            (function () {
              var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
              s1.async = true;
              s1.src = "https://embed.tawk.to/6a80e6c138c19e1d457853de/1k03oapev";
              s1.charset = "UTF-8";
              s1.setAttribute("crossorigin", "*");
              s0.parentNode.insertBefore(s1, s0);
            })();
          `}
        </Script>
      </body>
    </html>
  );
}
