import { ShieldCheck } from "lucide-react";

// Secao de confianca baseada so em garantias verificaveis do produto. Nada de
// depoimentos inventados -- a secao de depoimentos foi removida de proposito ate
// existirem avaliacoes reais de clientes pra colocar aqui.
const TRUST = [
  {
    title: "Dados isolados por empresa",
    desc: "Cada empresa tem seu ambiente separado — suas reservas e clientes não se misturam com os de ninguém.",
  },
  {
    title: "Acesso por níveis",
    desc: "Você define o que cada usuário da equipe pode ver e fazer dentro do sistema.",
  },
  {
    title: "Na nuvem, sempre disponível",
    desc: "Acesse do celular no píer ou do computador no escritório, sem instalar nada.",
  },
];

// Bloco navy fixo (mesma cor do hero e do CTA final) -- quebra a sequencia de secoes
// claras da landing, dando ritmo visual em vez de tudo branco/cinza-claro empilhado.
export function Trust() {
  return (
    <section className="relative overflow-hidden bg-navy py-20 text-white sm:py-24">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 top-[-10%] h-80 w-80 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -right-16 bottom-[-15%] h-80 w-80 rounded-full bg-brand-light/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-light">
            Confiança e segurança
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-tight sm:text-4xl">
            Seus dados isolados e seguros por empresa
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            A tranquilidade de saber que a informação da sua operação é só sua.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-3">
          {TRUST.map((item) => (
            <div key={item.title} className="rounded-card border border-white/10 bg-white/5 p-6">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand/20 text-brand-light">
                <ShieldCheck size={22} />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-300">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
