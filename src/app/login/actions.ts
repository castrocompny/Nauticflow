"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const supabase = createClient();

  // empresa, perfil e assinatura são criados por um gatilho no banco (on_auth_user_created),
  // disparado na própria inserção em auth.users — não depende de uma chamada autenticada
  // subsequente, então funciona mesmo com confirmação de e-mail ativa.
  const { data, error: signErr } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, company } },
  });
  if (signErr) return { error: signErr.message };

  if (!data.session) {
    return { error: "", info: "Conta criada! Confirme seu e-mail e depois entre normalmente." };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
