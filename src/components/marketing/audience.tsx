import { Sailboat, Ship, Anchor, Waves, Building2, type LucideIcon } from "lucide-react";

// "Pra quem é" -- ajuda o visitante a se reconhecer logo de cara. So tipos de
// operação que o produto realmente atende.
const AUDIENCE: { icon: LucideIcon; label: string }[] = [
  { icon: Sailboat, label: "Escunas" },
  { icon: Ship, label: "Lanchas" },
  { icon: Waves, label: "Jet-skis" },
  { icon: Anchor, label: "Catamarãs" },
  { icon: Building2, label: "Marinas e operadores" },
];

export function Audience() {
  return (
    <section className="border-b border-line bg-surface py-12">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <p className="text-center text-sm font-semibold uppercase tracking-wide text-muted">
          Feito pra quem trabalha na água
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {AUDIENCE.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-app/60 px-4 py-2 text-sm font-medium text-body"
            >
              <item.icon size={18} className="text-brand" />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
