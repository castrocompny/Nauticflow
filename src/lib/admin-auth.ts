import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Confere super_admin + segundo fator (aal2) verificado NESTA sessão -- usado no topo
// de toda página da área /admin. Não fica no middleware pra não gastar uma query extra
// em toda navegação do app inteiro; só quem entra em /admin paga esse custo.
//
// Fluxo: sem sessão -> /login. Não é super_admin -> mostra "acesso restrito" (não
// revela que a área existe pra quem não devia estar nem perto dela). É super_admin mas
// nunca cadastrou o segundo fator -> /admin/mfa-setup (cadastro obrigatório). Cadastrou
// mas ainda não verificou nesta sessão (aal1) -> /admin/mfa-challenge. Só depois disso
// libera a página.
export async function requireSuperAdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") {
    return { supabase, user, denied: true as const, name: undefined };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    redirect(aal?.nextLevel === "aal2" ? "/admin/mfa-challenge" : "/admin/mfa-setup");
  }

  return { supabase, user, denied: false as const, name: profile.name ?? "Super admin" };
}

// Mesma checagem, mas pra Server Actions (que não passam pela renderização da página e
// por isso precisam validar tudo de novo) -- retorna mensagem em vez de redirecionar.
export async function requireSuperAdminAction() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Sessão inválida." };

  const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") return { ok: false as const, message: "Sem permissão." };

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    return { ok: false as const, message: "Verificação de dois fatores necessária. Entre novamente em /admin." };
  }

  return { ok: true as const, supabase, adminId: user.id, adminName: profile.name ?? "Super admin" };
}
