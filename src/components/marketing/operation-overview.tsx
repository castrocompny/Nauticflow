import { Anchor, Users, Wind, Navigation, BarChart3, Check } from "lucide-react";
import { SectionHeading } from "./section";

// Quatro blocos do dia a dia: frota, clientes, condicoes do vento e relatorios.
// Todos os numeros sao ILUSTRATIVOS (demonstracao do produto), nunca dado real
// de nenhuma empresa.

const FROTA = [
  { name: "Escuna Amigos", capacity: "40 lugares", status: "Ativa", saidas: "3 saídas hoje" },
  { name: "Catamarã Sol", capacity: "24 lugares", status: "Ativa", saidas: "2 saídas hoje" },
  { name: "Lancha Azul", capacity: "8 lugares", status: "Manutenção", saidas: "sem saídas" },
];

const CLIENTES = [
  { name: "Marina Duarte", detail: "Ilha Feia · 14/09 · 2 pax", origin: "ToursFlow", value: "R$ 380" },
  { name: "Carlos Bastos", detail: "Ilhas do Sul · 12/09 · 4 pax", origin: "Balcão", value: "R$ 760" },
  { name: "Ana Prado", detail: "Pôr do sol · 08/09 · 2 pax", origin: "Parceiro", value: "R$ 420" },
];

const VENTO_HORAS = [
  { h: "13h", v: 16, d: "SE" },
  { h: "14h", v: 18, d: "SE" },
  { h: "15h", v: 21, d: "S" },
  { h: "16h", v: 19, d: "S" },
];

const RELATORIOS = [
  { label: "Reservas", value: "128" },
  { label: "Receita", value: "R$ 42.850" },
  { label: "Passageiros", value: "312" },
  { label: "Ticket médio", value: "R$ 334" },
  { label: "Cancelamentos", value: "4%" },
];

export function OperationOverview() {
  return (
    <section className="bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="No dia a dia"
          title="Frota, clientes e números no mesmo lugar"
          subtitle="O que a sua equipe precisa consultar durante o dia fica a um clique — sem procurar em planilha, conversa antiga ou caderno."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          {/* frota */}
          <article className="rounded-card border border-line bg-surface p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Anchor size={22} />
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold text-heading">
                  Controle sua frota em um só lugar
                </h3>
                <p className="text-sm text-muted">
                  Embarcações, capacidade comercial, status e saídas vinculadas.
                </p>
              </div>
            </div>

            <ul className="mt-6 divide-y divide-line rounded-xl border border-line">
              {FROTA.map((f) => (
                <li key={f.name} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-heading">{f.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {f.capacity} · {f.saidas}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${
                      f.status === "Ativa"
                        ? "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                    }`}
                  >
                    {f.status}
                  </span>
                </li>
              ))}
            </ul>
          </article>

          {/* clientes e reservas */}
          <article className="rounded-card border border-line bg-surface p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purpleflow/10 text-purpleflow">
                <Users size={22} />
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold text-heading">
                  Histórico organizado. Clientes centralizados.
                </h3>
                <p className="text-sm text-muted">
                  Cadastro, reserva rápida, passageiros, origem, passeio, data e valor.
                </p>
              </div>
            </div>

            <ul className="mt-6 divide-y divide-line rounded-xl border border-line">
              {CLIENTES.map((c) => (
                <li key={c.name} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-heading">{c.name}</span>
                    <span className="block truncate text-xs text-muted">{c.detail}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold text-heading">{c.value}</span>
                    <span className="block text-[11px] text-muted">{c.origin}</span>
                  </span>
                </li>
              ))}
            </ul>
          </article>

          {/* condicoes do vento */}
          <article className="rounded-card border border-line bg-surface p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Wind size={22} />
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold text-heading">
                  Condições do vento direto no Dashboard
                </h3>
                <p className="text-sm text-muted">
                  Consulte rapidamente as condições do vento junto da sua agenda operacional.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-line p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-display text-3xl font-semibold text-heading">18 km/h</p>
                  <p className="text-xs text-muted">Vento atual</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-body">
                    Rajadas: <span className="font-medium text-heading">27 km/h</span>
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-body">
                    <Navigation size={14} style={{ transform: "rotate(135deg)" }} />
                    Direção SE
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                {VENTO_HORAS.map((p) => (
                  <div key={p.h} className="rounded-lg bg-app px-2 py-2 text-center">
                    <p className="text-[11px] text-muted">{p.h}</p>
                    <p className="text-sm font-semibold text-heading">{p.v} km/h</p>
                    <p className="text-[11px] text-muted">{p.d}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Enquadramento deliberado: informacao operacional de consulta.
                Nunca prometer seguranca/garantia de navegacao. */}
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Informação operacional de apoio, exibida junto da agenda. Não é um sistema de
              segurança marítima — a decisão sobre navegar continua sendo do comandante.
            </p>
          </article>

          {/* relatorios */}
          <article className="rounded-card border border-line bg-surface p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amberflow/10 text-amberflow">
                <BarChart3 size={22} />
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold text-heading">
                  Entenda sua operação
                </h3>
                <p className="text-sm text-muted">
                  Uma visão central de quanto você vendeu, quanto entrou e como andou a ocupação.
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {RELATORIOS.map((r) => (
                <div key={r.label} className="rounded-xl border border-line px-3 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted">{r.label}</p>
                  <p className="mt-1 font-display text-lg font-semibold text-heading">{r.value}</p>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-3">
                <Check size={16} className="shrink-0 text-brand" />
                <p className="text-[11px] leading-snug text-muted">Atualizado a cada reserva</p>
              </div>
            </div>

            <p className="mt-4 text-xs text-muted">
              Números ilustrativos para demonstração do sistema.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
