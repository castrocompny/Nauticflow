import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { Hero } from "@/components/marketing/hero";
import { Audience } from "@/components/marketing/audience";
import { BeforeAfter } from "@/components/marketing/before-after";
import { Automation } from "@/components/marketing/automation";
import { Ecosystem } from "@/components/marketing/ecosystem";
import { SalesFlow } from "@/components/marketing/sales-flow";
import { DemoVideo } from "@/components/marketing/demo-video";
import { BookingModels } from "@/components/marketing/booking-models";
import { OperationOverview } from "@/components/marketing/operation-overview";
import { OperationSuite } from "@/components/marketing/operation-suite";
import { Showcase } from "@/components/marketing/showcase";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Pricing } from "@/components/marketing/pricing";
import { Trust } from "@/components/marketing/trust";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { SiteFooter } from "@/components/marketing/site-footer";
import { WhatsAppButton } from "@/components/marketing/whatsapp-button";
import { MarketingMotionStyles } from "@/components/marketing/motion";
import { MKT_PLANS } from "@/components/marketing/plans";

export const metadata: Metadata = {
  title: "NauticFlow — Sistema automatizado de gestão para turismo náutico",
  description:
    "Automatize reservas, saídas, embarcações e agenda da sua empresa de turismo náutico com o NauticFlow. Agenda gerada sozinha, vagas atualizadas em tempo real e alertas de reserva nova — conectado ao ecossistema de vendas ToursFlow. Teste grátis por 7 dias.",
  keywords: [
    "sistema automatizado para turismo náutico",
    "gestão para empresas de passeio de barco",
    "sistema de reservas de passeio de barco",
    "agenda automática de saídas",
    "sistema para escuna e lancha",
    "controle de embarcações e capacidade",
    "software para turismo náutico",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "NauticFlow",
    title: "NauticFlow — Sua operação náutica no automático",
    description:
      "Configure uma vez e o NauticFlow cuida do restante: agenda de saídas gerada sozinha, reservas centralizadas, vagas atualizadas em tempo real e alertas na hora. Parte do ecossistema NauticFlow + ToursFlow.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "NauticFlow" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NauticFlow — Sistema automatizado para turismo náutico",
    description:
      "Automatize reservas, saídas, embarcações e agenda da sua empresa de passeio de barco. Teste grátis por 7 dias.",
    images: ["/og-image.png"],
  },
};

// Dados estruturados (SEO) descrevendo o SaaS e os planos. A descricao acompanha
// o posicionamento visivel da pagina (automacao da operacao) -- os dois textos
// nunca devem divergir.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "NauticFlow",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  inLanguage: "pt-BR",
  description:
    "Sistema automatizado de gestão para empresas de turismo náutico: agenda de saídas gerada automaticamente, reservas centralizadas em tempo real, controle de capacidade e vagas, frota, clientes e relatórios da operação.",
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
//
// Narrativa da pagina: problema -> automacao -> ecossistema (gestao + vendas) ->
// capacidades da operacao -> prova -> planos -> conversao.
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingMotionStyles />
      <SiteHeader />
      <main>
        <Hero />
        <Audience />
        <BeforeAfter />
        <Automation />
        <Ecosystem />
        <SalesFlow />
        <DemoVideo />
        <BookingModels />
        <OperationOverview />
        <OperationSuite />
        <Showcase />
        <HowItWorks />
        <Pricing />
        <Trust />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <WhatsAppButton />
    </>
  );
}
