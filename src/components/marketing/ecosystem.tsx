import { Check, Clock, ArrowRight, Gauge, Globe, Building2, Compass, ExternalLink } from "lucide-react";
import { SectionHeading } from "./section";
import { MKT_LINKS } from "./plans";

// SECAO ECOSSISTEMA -- a mais sensivel da pagina do ponto de vista de verdade.
//
// O que e REAL e esta LIVE hoje (pode ser vendido no presente):
//   - ToursFlow e um site publico separado, no ar, onde o turista encontra os passeios;
//   - o catalogo NauticFlow -> ToursFlow sincroniza em tempo real (Realtime, migration 0069);
//   - a disponibilidade (availableSpots) aparece ao vivo no ToursFlow;
//   - o turista PODE escolher passeio/data/horario/passageiros no ToursFlow (BookingSelector).
//
// O que existe tecnicamente mas NAO esta ligado pro publico ainda:
//   - a infraestrutura de escrita de reserva server-to-server (ToursFlow `POST /api/bookings`
//     -> NauticFlow `POST /api/marketplace/bookings`, HMAC + idempotencia + rate limit) esta
//     PRONTA e validada em E2E real contra producao -- mas o botao "Confirmar reserva" da UI
//     publica do ToursFlow continua INATIVO por uma flag deles (`BOOKING_CHECKOUT_ENABLED`,
//     hoje `false` -- decisao de prontidao OPERACIONAL/comercial, nao limitacao tecnica; ver
//     ADR-013 no repo do ToursFlow). Hoje um turista real que tenta reservar ve "Reserva online
//     chega em breve... fale com o operador para confirmar", sem botao funcional.
//   - por isso: NUNCA escrever aqui que "reservas circulam em tempo real" ou que "a reserva
//     criada no ToursFlow entra no NauticFlow" como coisa que UM TURISTA consegue fazer hoje --
//     so e verdade via chamada direta de API (harness/teste), nao pela interface publica.
//   - checkout/pagamento online tambem nao existe: MARKETPLACE_PAYMENTS_ENABLED e
//     MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED estao OFF em TODOS os ambientes, inclusive
//     Producao -- nao existe Pix/Asaas no fluxo publico, nem voucher/QR emitido por ele,
//     nem repasse automatico pro operador, nem avaliacoes, nem area do turista/login.
// Nunca escrever aqui nada como "receba pagamentos automaticamente", "checkout disponivel"
// ou "reserva concluida pelo turista": seria propaganda de funcionalidade inexistente.

type Item = { label: string; soon?: boolean };

const NAUTICFLOW_ITEMS: Item[] = [
  { label: "Reservas" },
  { label: "Agenda automática" },
  { label: "Saídas" },
  { label: "Embarcações" },
  { label: "Clientes" },
  { label: "Capacidade e vagas" },
  { label: "Passeios" },
  { label: "Parceiros" },
  { label: "Relatórios" },
  { label: "Alertas em tempo real" },
  { label: "Condições do vento" },
];

const TOURSFLOW_ITEMS: Item[] = [
  { label: "Marketplace de passeios" },
  { label: "Página pública do passeio" },
  { label: "Datas, horários e passageiros" },
  { label: "Disponibilidade ao vivo" },
  { label: "Reserva online concluída pelo turista", soon: true },
  { label: "Checkout, pagamento e voucher", soon: true },
];

function ItemList({
  items,
  accent,
  columns = false,
}: {
  items: Item[];
  accent: string;
  columns?: boolean;
}) {
  return (
    <ul
      className={`mt-6 ${
        columns ? "grid gap-x-6 gap-y-2.5 sm:grid-cols-2" : "space-y-2.5"
      }`}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2.5 text-[15px]">
          {item.soon ? (
            <Clock size={17} className="shrink-0 text-amber-400" />
          ) : (
            <Check size={17} className={`shrink-0 ${accent}`} />
          )}
          <span className={item.soon ? "text-slate-400" : "text-slate-200"}>{item.label}</span>
          {item.soon && (
            <span className="ml-auto shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              Em breve
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// Fluxo Operador -> NauticFlow -> ToursFlow -> Turista: quem faz o que, na
// ordem em que a informacao se move. Direcao COMPLEMENTAR ao stepper de
// sales-flow.tsx (que mostra "uma reserva acontece" na direcao inversa,
// venda -> operacao) -- aqui o assunto e distribuicao/descoberta de catalogo,
// nunca mostrado em outro lugar da pagina.
const FLOW_STEPS = [
  {
    icon: Building2,
    title: "Operador",
    caption: "Gerencia sua empresa e seus passeios.",
  },
  {
    icon: Gauge,
    title: "NauticFlow",
    caption: "Centraliza operação, reservas, saídas, disponibilidade, embarcações e clientes.",
  },
  {
    icon: Globe,
    title: "ToursFlow",
    caption: "Marketplace que apresenta os passeios ao público e conecta turistas aos operadores.",
  },
  {
    icon: Compass,
    title: "Turista",
    caption: "Encontra, compara e escolhe experiências em um único lugar.",
  },
];

const COMO_VAI_FUNCIONAR = [
  "O operador administra sua operação no NauticFlow.",
  "Informações autorizadas dos passeios são disponibilizadas para o ToursFlow.",
  "O turista encontra, compara e escolhe passeios no marketplace.",
  "Conforme a operação comercial avançar, a reserva poderá ser concluída direto pelo turista no ToursFlow, entrando automaticamente na operação do NauticFlow.",
];

export function Ecosystem() {
  return (
    <section
      id="ecossistema"
      className="relative scroll-mt-20 overflow-hidden bg-navy py-20 text-white sm:py-24"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-[-10%] h-80 w-80 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -right-20 bottom-[-15%] h-80 w-80 rounded-full bg-brand-light/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          onNavy
          eyebrow="Ecossistema NauticFlow + ToursFlow"
          title="Venda na frente. Controle tudo por trás."
          subtitle="O NauticFlow organiza sua operação. O ToursFlow conecta seus passeios ao cliente. Dois produtos, um único fluxo."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          {/* NAUTICFLOW */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/20 text-brand-light">
                <Gauge size={22} />
              </span>
              <div>
                <span className="rounded-full bg-brand/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-light">
                  Gestão
                </span>
                <p className="mt-1 font-display text-lg font-semibold">NauticFlow</p>
              </div>
            </div>

            <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight">
              Controle sua operação.
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-300">
              O sistema onde a sua empresa trabalha todo dia — da reserva ao embarque.
            </p>

            {/* duas colunas: 11 itens numa lista só deixavam este cartão muito
                mais alto que o do ToursFlow (6 itens), com um vazio enorme no pé
                do outro cartão -- em grade os dois ficam na mesma altura. */}
            <ItemList items={NAUTICFLOW_ITEMS} accent="text-brand-light" columns />

            <p className="mt-auto pt-6 text-[13px] text-slate-400">
              É aqui que a sua equipe trabalha todos os dias.
            </p>
          </div>

          {/* TOURSFLOW */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-400">
                <Globe size={22} />
              </span>
              <div>
                <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Vendas online
                </span>
                <p className="mt-1 font-display text-lg font-semibold">ToursFlow</p>
              </div>
            </div>

            <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight">
              Coloque seus passeios na frente do cliente.
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-300">
              O marketplace onde o turista encontra seus passeios, com data, horário e
              disponibilidade sincronizados com o seu sistema.
            </p>

            <ItemList items={TOURSFLOW_ITEMS} accent="text-emerald-400" />

            <p className="mt-auto pt-6 text-[13px] text-slate-400">
              Catálogo e disponibilidade já sincronizados com o seu NauticFlow, em tempo real.
            </p>
          </div>
        </div>

        {/* Fluxo Operador -> NauticFlow -> ToursFlow -> Turista */}
        <div className="mt-16">
          <h3 className="text-center font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Um ecossistema da operação até a venda
          </h3>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[15px] leading-relaxed text-slate-300">
            Você cuida da operação no NauticFlow. O ToursFlow ajuda seus passeios a chegarem aos
            clientes.
          </p>

          <div className="mx-auto mt-10 flex max-w-5xl flex-col items-stretch gap-3 lg:flex-row lg:items-center">
            {FLOW_STEPS.map((step, i) => (
              <div key={step.title} className="flex flex-1 items-center gap-3 lg:flex-col lg:gap-0">
                <div className="flex flex-1 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-center lg:w-full">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/20 text-brand-light">
                    <step.icon size={20} aria-hidden="true" />
                  </span>
                  <p className="mt-3 font-display text-base font-semibold">{step.title}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{step.caption}</p>
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <ArrowRight
                    aria-hidden="true"
                    size={20}
                    className="shrink-0 rotate-90 text-brand-light/50 lg:my-2 lg:rotate-0"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Como vai funcionar */}
        <div className="mx-auto mt-16 max-w-3xl">
          <h3 className="text-center font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Como vai funcionar
          </h3>
          <ol className="mt-8 space-y-5">
            {COMO_VAI_FUNCIONAR.map((texto, i) => (
              <li key={texto} className="flex items-start gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/20 text-sm font-bold text-brand-light">
                  {i + 1}
                </span>
                <p className="pt-0.5 text-[15px] leading-relaxed text-slate-300">{texto}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Nota honesta sobre o que ja roda e o que ainda vem. Se esta frase
            mudar, conferir antes MARKETPLACE_PAYMENTS_ENABLED (NauticFlow) e
            BOOKING_CHECKOUT_ENABLED (ToursFlow). */}
        <div className="mx-auto mt-10 max-w-3xl">
          <p className="text-center text-sm leading-relaxed text-slate-400">
            O catálogo e as informações dos passeios já são conectados ao NauticFlow, em tempo
            real.{" "}
            <span className="text-slate-300">
              A infraestrutura de integração de reservas também já foi validada tecnicamente e
              será liberada ao público conforme a operação comercial do ToursFlow avançar
            </span>{" "}
            — hoje, a reserva pelo turista ainda passa por contato direto com o operador.
          </p>

          <div className="mt-6 flex justify-center">
            <a
              href="https://toursflow.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:border-emerald-400/40 hover:text-emerald-300"
            >
              Explorar o ToursFlow
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={MKT_LINKS.signup}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-6 py-3.5 text-base font-semibold text-white transition hover:bg-brand-dark"
          >
            Começar grátis
            <ArrowRight size={20} />
          </a>
          <a
            href="#fluxo"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 py-3.5 text-base font-semibold text-white transition hover:border-brand-light/50"
          >
            Ver o fluxo completo
          </a>
        </div>
      </div>
    </section>
  );
}
