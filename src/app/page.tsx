import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Pricing } from "@/components/marketing/pricing";
import { Trust } from "@/components/marketing/trust";
import { FinalCta } from "@/components/marketing/final-cta";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MKT_PLANS } from "@/components/marketing/plans";

export const metadata: Metadata = {
  title: "NauticFlow — Sistema de gestão para empresas de turismo náutico",
  description:
    "Software de gestão para empresas de passeio de barco: agenda de saídas, reservas com voucher automático, manifesto de embarque e dashboard de receita. Sistema para escuna, lancha, jet-ski e catamarã. Teste grátis por 7 dias.",
  keywords: [
    "gestão para empresas de passeio de barco",
    "sistema para escuna e lancha",
    "software para turismo náutico",
    "sistema de reservas de passeio de barco",
    "gestão de embarcações",
    "manifesto de embarque",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "NauticFlow",
    title: "NauticFlow — Gestão completa para empresas de turismo náutico",
    description:
      "Pare de controlar reservas e saídas de barco em planilha e WhatsApp. Agenda, reservas com voucher automático, manifesto de embarque e dashboard num só lugar. Teste grátis por 7 dias.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "NauticFlow" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NauticFlow — Gestão para empresas de turismo náutico",
    description:
      "Agenda de saídas, reservas com voucher automático e dashboard de receita para empresas de passeio de barco. Teste grátis por 7 dias.",
    images: ["/og-image.png"],
  },
};

// Dados estruturados (SEO) descrevendo o SaaS e os planos.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "NauticFlow",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  inLanguage: "pt-BR",
  description:
    "Sistema de gestão para empresas de turismo náutico: agenda de saídas, reservas com voucher automático, manifesto de embarque e dashboard de receita.",
  url: "https://nauticflow.com.br",
  offers: MKT_PLANS.map((plan) => ({
    "@type": "Offer",
    name: `Plano ${plan.name}`,
    price: plan.price.replace(/[^\d]/g, ""),
    priceCurrency: "BRL",
    category: "Assinatura mensal",
  })),
};

// O redirecionamento de quem esta logado (/ -> /dashboard) e feito no proxy
// (src/lib/supabase/middleware.ts), junto com o restante do roteamento de auth.
// Aqui a home so renderiza a landing institucional para o visitante.
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Pricing />
        <Trust />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
