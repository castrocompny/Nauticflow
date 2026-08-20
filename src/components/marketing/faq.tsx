import { ChevronDown } from "lucide-react";

// Conteudo 100% verdadeiro, baseado no produto real (teste de 7 dias sem cartao,
// mobile, voucher automatico, dados isolados, etc.). Nada inventado.
const FAQ = [
  {
    q: "Preciso instalar algo ou saber mexer em computador?",
    a: "Não. O NauticFlow é 100% online e funciona no navegador do celular ou do computador. Se você usa WhatsApp no dia a dia, consegue usar o NauticFlow.",
  },
  {
    q: "Funciona no celular?",
    a: "Sim. Ele foi feito pra usar tanto no celular — no píer, na hora da saída — quanto no computador do escritório.",
  },
  {
    q: "Preciso de cartão de crédito pra testar?",
    a: "Não. São 7 dias de teste grátis, sem cartão. Você só informa uma forma de pagamento se decidir continuar depois do teste.",
  },
  {
    q: "Como o cliente recebe o voucher da reserva?",
    a: "A cada reserva, o sistema envia o voucher automático por e-mail para o cliente, sem você precisar digitar ou montar nada à mão.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim. A cobrança é mensal e você cancela quando quiser, direto no sistema, sem multa nem fidelidade.",
  },
  {
    q: "Vocês cobram comissão por reserva?",
    a: "Não. Você paga apenas a mensalidade do plano escolhido — as reservas são ilimitadas dentro do seu plano.",
  },
  {
    q: "Serve pro meu tipo de embarcação?",
    a: "Sim. Escuna, lancha, jet-ski, catamarã e outros — você cadastra quantas embarcações o seu plano permitir.",
  },
  {
    q: "Meus dados e os dos meus clientes ficam seguros?",
    a: "Sim. Cada empresa tem um ambiente isolado (seus dados não se misturam com os de outras empresas), tudo na nuvem, com controle de acesso por usuário pra sua equipe.",
  },
  {
    q: "Como funciona o suporte?",
    a: "Você fala com a gente por WhatsApp ou e-mail (os contatos ficam no rodapé do site) sempre que precisar.",
  },
];

// FAQPage (dados estruturados) -- ajuda o Google a mostrar as perguntas direto na
// busca. Conteudo estatico e controlado, sem input de usuario.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 bg-app py-20 sm:py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="mx-auto w-full max-w-3xl px-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand">
            Perguntas frequentes
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-heading sm:text-4xl">
            Ainda com dúvida? A gente responde
          </h2>
        </div>

        <div className="mt-12 space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group rounded-card border border-line bg-surface px-5 py-4 transition open:border-brand/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-base font-semibold text-heading marker:hidden [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  size={20}
                  className="shrink-0 text-muted transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-body">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
