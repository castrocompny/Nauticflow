"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/password";
import { SITE_URL } from "@/lib/site-url";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email ou senha inválidos." };
  redirect("/dashboard");
}

export async function signUp(_prev: unknown, formData: FormData) {
  const name = String(formData.get("name"));
  const company = String(formData.get("company"));
  const city = String(formData.get("city"));
  const cnpj = String(formData.get("cnpj") || "");
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const termsAccepted = formData.get("terms_accepted") === "on";
  if (!termsAccepted) {
    return { error: "É preciso aceitar os Termos de Uso e a Política de Privacidade para criar a conta." };
  }
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError };
  const supabase = createClient();

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

  redirect("/dashboard");
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
