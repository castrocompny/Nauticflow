import { MessageCircle, Mail } from "lucide-react";
import { MKT_LINKS, MKT_NAV, MKT_CONTACT } from "./plans";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer id="contato" className="scroll-mt-20 border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <span className="flex items-center gap-2.5">
              <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-1.5 shadow-sm">
                <img src="/nauticflow-icon.png" alt="NauticFlow" className="h-6 w-auto object-contain" />
              </span>
              <span className="font-display text-lg font-semibold leading-none tracking-tight">
                <span className="text-heading">Nautic</span>
                <span className="text-brand">Flow</span>
              </span>
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-body">
              Sistema de gestão para empresas de turismo náutico — escunas, lanchas, jet-ski e
              catamarãs. Da reserva ao embarque, sem planilha.
            </p>
          </div>

          <nav aria-label="Rodapé">
            <h3 className="font-display text-sm font-semibold text-heading">Navegação</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {MKT_NAV.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-body transition-colors hover:text-brand">
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a href={MKT_LINKS.login} className="text-body transition-colors hover:text-brand">
                  Entrar no sistema
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <h3 className="font-display text-sm font-semibold text-heading">Contato</h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a
                  href={MKT_CONTACT.whatsapp}
                  className="inline-flex items-center gap-2 text-body transition-colors hover:text-brand"
                >
                  <MessageCircle size={16} />
                  {MKT_CONTACT.whatsappLabel}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${MKT_CONTACT.email}`}
                  className="inline-flex items-center gap-2 text-body transition-colors hover:text-brand"
                >
                  <Mail size={16} />
                  {MKT_CONTACT.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-line pt-6 text-sm text-muted sm:flex-row">
          <p>© {year} NauticFlow. Todos os direitos reservados.</p>
          <div className="flex items-center gap-5">
            <a href={MKT_LINKS.termos} className="transition-colors hover:text-brand">
              Termos de uso
            </a>
            <a href={MKT_LINKS.privacidade} className="transition-colors hover:text-brand">
              Privacidade
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
