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

export function Trust() {
  return (
    <section className="bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand">
            Confiança e segurança
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-tight text-heading sm:text-4xl">
            Seus dados isolados e seguros por empresa
          </h2>
          <p className="mt-4 text-lg text-body">
            A tranquilidade de saber que a informação da sua operação é só sua.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-3">
          {TRUST.map((item) => (
            <div key={item.title} className="rounded-card border border-line bg-app/60 p-6">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <ShieldCheck size={22} />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-heading">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-body">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
