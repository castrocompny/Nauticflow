import { Check, Clock, ArrowRight, Gauge, Globe } from "lucide-react";
import { SectionHeading } from "./section";
import { MKT_LINKS } from "./plans";

// SECAO ECOSSISTEMA -- a mais sensivel da pagina do ponto de vista de verdade.
//
// O que e REAL e esta LIVE hoje (pode ser vendido no presente):
//   - ToursFlow e um site publico separado, no ar, onde o turista encontra os passeios;
//   - o catalogo NauticFlow -> ToursFlow sincroniza em tempo real (Realtime, migration 0069);
//   - a disponibilidade (availableSpots) aparece ao vivo no ToursFlow;
//   - a reserva criada no ToursFlow entra no NauticFlow (source='marketplace'), aparece
//     no painel/agenda do operador e dispara o alerta de nova reserva.
//
// O que NAO existe ainda (so pode aparecer como "em breve"):
//   - checkout/pagamento online dentro desse fluxo. MARKETPLACE_PAYMENTS_ENABLED e
//     MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED estao OFF em TODOS os ambientes, inclusive
//     Producao -- nao existe Pix/Asaas no fluxo publico, nem voucher/QR emitido por ele,
//     nem repasse automatico pro operador.
// Nunca escrever aqui nada como "receba pagamentos automaticamente" ou "checkout
// disponivel": seria propaganda de funcionalidade inexistente.

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
  { label: "Integração com a sua operação" },
  { label: "Venda e pagamento online", soon: true },
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

        {/* Nota honesta sobre o que ja roda e o que ainda vem. Se esta frase
            mudar, conferir antes MARKETPLACE_PAYMENTS_ENABLED. */}
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-slate-400">
          A conexão entre os dois já está ativa: catálogo, disponibilidade e reservas circulam em
          tempo real entre o ToursFlow e o NauticFlow.{" "}
          <span className="text-slate-300">
            Em breve, seus passeios também poderão ser pagos online diretamente pelo ToursFlow
          </span>{" "}
          — o NauticFlow já está preparado para isso.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
