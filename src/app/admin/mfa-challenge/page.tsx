import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { MfaChallengeForm } from "./mfa-challenge-form";

export default async function MfaChallengePage() {
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

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect("/admin");
  if (aal?.nextLevel !== "aal2") redirect("/admin/mfa-setup");

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const factor = (factorsData?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) redirect("/admin/mfa-setup");

  return (
    <div className="grid min-h-screen place-items-center bg-app p-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6">
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-navy px-3 py-2">
            <Logo />
          </div>
          <p className="text-sm text-muted">Digite o código do seu app autenticador</p>
        </div>
        <MfaChallengeForm factorId={factor.id} />
      </div>
    </div>
  );
}
