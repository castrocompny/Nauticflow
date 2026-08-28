"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/password";
import { SITE_URL } from "@/lib/site-url";
import { isValidDocument, normalizeDocumentDigits } from "@/lib/trial-identity";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const remember = formData.get("remember") === "on";
  const supabase = createClient({ persistSession: remember });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email ou senha inválidos." };
  redirect("/dashboard");
}

export async function signUp(_prev: unknown, formData: FormData) {
  const name = String(formData.get("name"));
  const company = String(formData.get("company"));
  const city = String(formData.get("city"));
  const cnpj = String(formData.get("cnpj") || "").trim();
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const termsAccepted = formData.get("terms_accepted") === "on";
  // plano/ciclo vindos da landing (?plan=...&cycle=...) -- so aceita valores validos
  const planParam = String(formData.get("plan") || "");
  const plan = ["start", "profissional", "premium"].includes(planParam) ? planParam : "";
  const cycleParam = String(formData.get("cycle") || "");
  const cycle = cycleParam === "anual" ? "anual" : "";
  const remember = formData.get("remember") === "on";
  if (!termsAccepted) {
    return { error: "É preciso aceitar os Termos de Uso e a Política de Privacidade para criar a conta." };
  }
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError };
  // CNPJ/CPF virou obrigatorio (era opcional) -- e a chave que o gatilho do banco usa
  // pra saber se essa pessoa/empresa ja usou os 7 dias de trial antes (mesmo depois de
  // excluir a conta e criar outra com e-mail diferente, ver trial_history na migration
  // 0045). Validação de dígito verificador real aqui é só UX (mensagem melhor, erro
  // cedo) -- a autoridade de verdade mora no gatilho handle_new_user(), que recalcula
  // tudo de novo a partir do dado bruto e nunca confia neste valor (ver
  // src/lib/trial-identity.ts pra explicação completa do porquê).
  const cnpjDigits = normalizeDocumentDigits(cnpj);
  if (!isValidDocument(cnpjDigits)) {
    return { error: "Informe um CPF ou CNPJ válido." };
  }
  const supabase = createClient({ persistSession: remember });

  // empresa, perfil e assinatura são criados por um gatilho no banco (on_auth_user_created),
  // disparado na própria inserção em auth.users — não depende de uma chamada autenticada
  // subsequente, então funciona mesmo com confirmação de e-mail ativa. O aceite dos termos
  // também é registrado por esse gatilho (profiles.terms_accepted_at).
  const { data, error: signErr } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, company, city, cnpj, terms_accepted: true } },
  });
  if (signErr) return { error: signErr.message };

  if (!data.session) {
    return { error: "", info: "Conta criada! Confirme seu e-mail e depois entre normalmente." };
  }

  // veio de um plano especifico na landing -> cai direto na pagina de planos com ele
  // destacado (e no ciclo escolhido), pronto pra pagar. Sem plano, vai pro dashboard.
  redirect(plan ? `/planos?plan=${plan}${cycle ? `&cycle=${cycle}` : ""}` : "/dashboard");
}

export async function forgotPassword(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email"));
  const supabase = createClient();

  // sempre retorna a mesma mensagem, exista ou nao o e-mail, pra nao revelar quais
  // contas estao cadastradas no sistema
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/auth/callback?next=/redefinir-senha`,
  });
  return { error: "", info: "Se esse e-mail estiver cadastrado, enviamos um link pra redefinir a senha." };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
