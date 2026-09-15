import {
  ClipboardList,
  Users,
  Anchor,
  Ship,
  CalendarDays,
  CalendarCheck,
  Gauge,
  MapPinned,
  Handshake,
  BarChart3,
  Wind,
  BellRing,
  MailCheck,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { SectionHeading } from "./section";

// Checklist da "central operacional": tudo que o sistema cobre hoje, em Producao.
// Nada aqui e promessa -- cada item corresponde a uma area que ja existe no app.
const ITEMS: { icon: LucideIcon; label: string }[] = [
  { icon: ClipboardList, label: "Reservas" },
  { icon: Users, label: "Clientes" },
  { icon: Anchor, label: "Embarcações" },
  { icon: Ship, label: "Saídas" },
  { icon: CalendarDays, label: "Agenda" },
  { icon: CalendarCheck, label: "Disponibilidade" },
  { icon: Gauge, label: "Capacidade" },
  { icon: MapPinned, label: "Passeios" },
  { icon: Handshake, label: "Parceiros" },
  { icon: BarChart3, label: "Relatórios" },
  { icon: Wind, label: "Condições do vento" },
  { icon: BellRing, label: "Alertas em tempo real" },
  { icon: MailCheck, label: "Voucher automático" },
  { icon: FileText, label: "Manifesto de embarque" },
];

export function OperationSuite() {
  return (
    <section id="funcionalidades" className="scroll-mt-20 bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Central operacional"
          title="Tudo que sua operação precisa. Em um único sistema."
          subtitle="Sem alternar entre planilha, caderno e conversa — a operação inteira mora num lugar só."
        />

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ITEMS.map((item) => (
            // No mobile o ícone fica ACIMA do rótulo: lado a lado, a coluna de
            // texto sobrava ~80px em 375px e palavras longas ("Disponibilidade",
            // "Embarcações") estouravam a caixa, já que não há onde quebrar.
            <div
              key={item.label}
              className="flex flex-col items-start gap-2 rounded-card border border-line bg-app px-4 py-4 transition hover:border-brand/40 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <item.icon size={18} />
              </span>
              <span className="min-w-0 break-words text-sm font-medium leading-snug text-heading">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
