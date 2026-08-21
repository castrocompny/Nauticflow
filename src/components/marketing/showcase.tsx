import { CalendarClock, MailCheck, ClipboardList, Check, type LucideIcon } from "lucide-react";

// "Veja por dentro" -- 3 telas recriadas em HTML fiéis ao layout real do app
// (Agenda e Manifesto vistos em prints reais; Voucher é a peça que o cliente recebe
// por e-mail). Dados de exemplo limpos, nada de conta real. As telas do app ficam no
// tema escuro (como o produto); o voucher é claro porque é um e-mail pro cliente.

function WindowChrome({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-white/5 px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
      <span className="ml-3 text-[11px] font-medium text-slate-500">{label}</span>
    </div>
  );
}

function AgendaScreen() {
  const rows = [
    { t: "09:00", label: "livre" },
    { t: "11:30", name: "Lancha Azul", sub: "Ilhas · 6/8", filled: true },
    { t: "13:00", label: "livre" },
    { t: "15:40", name: "Rio Azul", sub: "Geribá · 26/46", filled: true, hot: true },
    { t: "17:00", name: "Escuna Amigos", sub: "Pôr do sol · 12/40", filled: true },
    { t: "19:00", label: "livre" },
  ];
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20">
      <WindowChrome label="nauticflow.com.br/agenda" />
      <div className="p-4">
        <p className="text-[13px] font-semibold text-white">Agenda · Hoje</p>
        <p className="mb-3 text-[10px] text-slate-500">Quinta-feira, 20 de agosto</p>
        <div className="divide-y divide-white/5 rounded-xl border border-white/5 bg-white/[0.02]">
          {rows.map((r) => (
            <div key={r.t} className="flex items-center gap-3 px-3 py-2">
              <span className="w-10 shrink-0 text-[11px] font-medium text-slate-400">{r.t}</span>
              {r.filled ? (
                <span
                  className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                    r.hot ? "bg-brand/20 text-brand-light" : "bg-white/5 text-slate-200"
                  }`}
                >
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-slate-400">{r.sub}</span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-600">{r.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VoucherScreen() {
  const info = [
    ["Data e hora", "20/08 · 15:40"],
    ["Embarcação", "Rio Azul"],
    ["Passageiros", "2 adultos"],
    ["Embarque", "Píer da Orla"],
  ];
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between bg-navy px-5 py-3">
        <span className="font-display text-sm font-semibold text-white">
          Nautic<span className="text-brand-light">Flow</span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-light">
          Voucher de reserva
        </span>
      </div>
      <div className="p-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Passeio</p>
        <p className="font-display text-lg font-semibold text-navy">Passeio das Tartarugas</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {info.map(([k, v]) => (
            <div key={k}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{k}</p>
              <p className="text-sm font-medium text-slate-700">{v}</p>
            </div>
          ))}
        </div>

        <div className="my-4 border-t border-dashed border-slate-200" />

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Código</p>
            <p className="font-mono text-base font-semibold tracking-wider text-navy">NF-7QK2</p>
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
              <Check size={11} /> Confirmado
            </span>
          </div>
          {/* QR ilustrativo */}
          <div className="grid grid-cols-4 gap-0.5">
            {[1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1].map((on, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rounded-[2px] ${on ? "bg-navy" : "bg-slate-200"}`}
              />
            ))}
          </div>
        </div>

        <p className="mt-4 text-[10px] text-slate-400">
          Enviado automaticamente por e-mail ao cliente assim que a reserva é feita.
        </p>
      </div>
    </div>
  );
}

function ManifestoScreen() {
  const pax = [
    ["Marina Alves", "RG 12.345.678-9"],
    ["Carlos Souza", "CPF 123.456.789-00"],
    ["Juliana Lima", "RG 98.765.432-1"],
    ["Rafael Costa", "CPF 987.654.321-00"],
    ["Beatriz Nunes", "Passaporte FZ1029"],
  ];
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20">
      <WindowChrome label="nauticflow.com.br/manifesto" />
      <div className="p-4">
        <p className="text-[13px] font-semibold text-white">Manifesto de embarque</p>
        <p className="mb-3 text-[10px] text-slate-500">Rio Azul · 15:40 · Geribá</p>
        <div className="overflow-hidden rounded-xl border border-white/5">
          <div className="flex items-center gap-3 bg-white/[0.04] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="flex-1">Passageiro</span>
            <span className="w-28 shrink-0">Documento</span>
          </div>
          <div className="divide-y divide-white/5">
            {pax.map(([nome, doc]) => (
              <div key={nome} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 text-[11px] font-medium text-slate-200">{nome}</span>
                <span className="w-28 shrink-0 text-[10px] text-slate-500">{doc}</span>
                <Check size={13} className="shrink-0 text-emerald-400" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[10px] text-slate-500">
            <span className="font-semibold text-slate-300">26</span> passageiros ·{" "}
            <span className="font-semibold text-slate-300">20</span> vagas
          </p>
          <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300">
            Exportar PDF
          </span>
        </div>
      </div>
    </div>
  );
}

const ROWS: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  desc: string;
  bullets: string[];
  screen: React.ReactNode;
}[] = [
  {
    icon: CalendarClock,
    eyebrow: "Agenda",
    title: "Toda a operação do dia numa tela",
    desc: "Veja as saídas por horário, a lotação de cada embarcação e o que ainda está livre — do celular no píer ou do computador no escritório.",
    bullets: ["Saídas por horário", "Lotação em tempo real", "Status de cada barco"],
    screen: <AgendaScreen />,
  },
  {
    icon: MailCheck,
    eyebrow: "Voucher automático",
    title: "O cliente recebe o voucher na hora",
    desc: "A cada reserva, o sistema envia o voucher por e-mail para o cliente automaticamente — com passeio, data, embarcação e código de confirmação. Você não digita nada.",
    bullets: ["Enviado por e-mail sozinho", "Código de confirmação", "Sem trabalho manual"],
    screen: <VoucherScreen />,
  },
  {
    icon: ClipboardList,
    eyebrow: "Manifesto de embarque",
    title: "A lista de passageiros pronta por saída",
    desc: "O manifesto de cada saída fica montado sozinho, do jeito que a Capitania e a tripulação precisam — com passageiros, documentos e vagas.",
    bullets: ["Lista por saída", "Documentos dos passageiros", "Exporta em PDF"],
    screen: <ManifestoScreen />,
  },
];

export function Showcase() {
  return (
    <section className="bg-app py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand">
            Veja por dentro
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-heading sm:text-4xl">
            O sistema por dentro, sem enrolação
          </h2>
          <p className="mt-4 text-lg text-body">
            Telas reais do que você usa no dia a dia — da agenda ao embarque.
          </p>
        </div>

        <div className="mt-16 space-y-16 lg:space-y-24">
          {ROWS.map((row, i) => {
            const flip = i % 2 === 1;
            return (
              <div
                key={row.title}
                className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
              >
                <div className={flip ? "lg:order-2" : ""}>
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand">
                    <row.icon size={16} />
                    {row.eyebrow}
                  </span>
                  <h3 className="mt-3 font-display text-2xl font-semibold text-heading sm:text-3xl">
                    {row.title}
                  </h3>
                  <p className="mt-3 text-[17px] leading-relaxed text-body">{row.desc}</p>
                  <ul className="mt-5 space-y-2">
                    {row.bullets.map((b) => (
                      <li key={b} className="flex items-center gap-2 text-[15px] text-body">
                        <Check size={16} className="shrink-0 text-brand" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={flip ? "lg:order-1" : ""}>{row.screen}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
