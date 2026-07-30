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

  const { error: signErr } = await supabase.auth.signUp({ email, password });
  if (signErr) return { error: signErr.message };

  // bootstrap_company roda como SECURITY DEFINER e cria company, profile e assinatura
  const { error: rpcErr } = await supabase.rpc("bootstrap_company", {
    company_name: company,
    plan_code: "start",
    user_name: name,
  });
  if (rpcErr) return { error: "Conta criada, mas falhou ao montar a empresa: " + rpcErr.message };

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
