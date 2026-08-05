import Link from "next/link";
import { AlertCircle } from "lucide-react";

export function OverdueBanner({ companyName }: { companyName: string }) {
  const whatsappHref = `https://wa.me/5565992407699?text=${encodeURIComponent(
    `Olá! Sou da empresa ${companyName} e quero regularizar minha assinatura do NauticFlow.`
  )}`;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            <strong>Assinatura vencida.</strong> Você ainda pode ver e editar tudo, mas não consegue cadastrar
            embarcações, clientes, saídas, reservas ou parceiros novos até regularizar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/planos"
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
          >
            Renovar plano
          </Link>
          <a href={whatsappHref} target="_blank" rel="noreferrer" className="text-xs font-medium text-amber-900 underline">
            Falar com o suporte
          </a>
        </div>
      </div>
    </div>
  );
}
