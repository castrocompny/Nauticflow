import Link from "next/link";
import { AlertCircle } from "lucide-react";

export function OverdueBanner({
  companyName,
  suspended,
  suspendedReason,
}: {
  companyName: string;
  suspended?: boolean;
  suspendedReason?: string | null;
}) {
  const whatsappHref = `https://wa.me/5565992407699?text=${encodeURIComponent(
    suspended
      ? `Olá! Sou da empresa ${companyName} e minha conta do NauticFlow está suspensa. Quero entender o motivo.`
      : `Olá! Sou da empresa ${companyName} e quero regularizar minha assinatura do NauticFlow.`
  )}`;

  const tone = suspended
    ? { border: "border-red-200", bg: "bg-red-50", icon: "text-danger", text: "text-red-900", link: "text-red-900" }
    : { border: "border-amber-200", bg: "bg-amber-50", icon: "text-amber-600", text: "text-amber-900", link: "text-amber-900" };

  return (
    <div className={`border-b ${tone.border} ${tone.bg} px-6 py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className={`mt-0.5 shrink-0 ${tone.icon}`} />
          <p className={`text-sm ${tone.text}`}>
            {suspended ? (
              <>
                <strong>Conta suspensa pelo administrador.</strong>
                {suspendedReason ? ` Motivo: ${suspendedReason}.` : ""} Você ainda pode ver e editar tudo, mas não
                consegue cadastrar embarcações, clientes, saídas, reservas ou parceiros novos.
              </>
            ) : (
              <>
                <strong>Assinatura vencida.</strong> Você ainda pode ver e editar tudo, mas não consegue cadastrar
                embarcações, clientes, saídas, reservas ou parceiros novos até regularizar.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!suspended && (
            <Link
              href="/planos"
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
            >
              Renovar plano
            </Link>
          )}
          <a href={whatsappHref} target="_blank" rel="noreferrer" className={`text-xs font-medium underline ${tone.link}`}>
            Falar com o suporte
          </a>
        </div>
      </div>
    </div>
  );
}
