import { MKT_CONTACT } from "./plans";

// Botao flutuante de WhatsApp -- o publico (dono de empresa de passeio) resolve
// tudo por Zap, entao um contato direto converte mais que e-mail. Link com
// mensagem pre-preenchida. lucide nao tem glifo de marca do WhatsApp, entao usamos
// um SVG inline proprio.
const message = "Olá! Vim pelo site do NauticFlow e quero saber mais.";

export function WhatsAppButton() {
  const href = `${MKT_CONTACT.whatsapp}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar no WhatsApp"
      className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg ring-1 ring-black/5 transition hover:scale-105 hover:bg-[#1ebe5b] focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:bottom-6 sm:right-6"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-8.6 15.05L2 22l5.1-1.33A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.03.8.81-2.95-.2-.31A8.2 8.2 0 1 1 12 20.2Zm4.5-6.13c-.25-.13-1.46-.72-1.69-.8-.23-.08-.39-.13-.56.13-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-3.3-2.9c-.25-.42.25-.4.71-1.3.08-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.85-.2-.48-.4-.41-.56-.42h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.55c.13.16 1.75 2.66 4.23 3.73 1.57.68 2.19.74 2.98.62.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" />
      </svg>
    </a>
  );
}
