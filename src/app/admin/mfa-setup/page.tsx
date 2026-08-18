import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { MfaSetupForm } from "./mfa-setup-form";

export default async function MfaSetupPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") {
    return (
      <div className="grid min-h-screen place-items-center bg-app p-6">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-danger">
            <ShieldAlert size={24} />
          </div>
          <h1 className="font-display text-lg font-semibold text-heading">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted">Esta área é só para administração do NauticFlow.</p>
        </div>
      </div>
    );
  }

  // já tem um fator verificado -- não precisa cadastrar de novo, só falta o desafio
  // (challenge) desta sessão, que a própria /admin redireciona sozinha
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const alreadyEnrolled = (factorsData?.totp ?? []).some((f) => f.status === "verified");
  if (alreadyEnrolled) redirect("/admin");

  return (
    <div className="grid min-h-screen place-items-center bg-app p-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6">
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-navy px-3 py-2">
            <Logo />
          </div>
          <p className="text-sm text-muted">Proteja o Super Admin com verificação em duas etapas</p>
        </div>
        <MfaSetupForm />
      </div>
    </div>
  );
}
