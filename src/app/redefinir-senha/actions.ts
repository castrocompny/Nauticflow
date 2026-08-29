"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/password";

export async function updatePassword(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password"));
  const confirm = String(formData.get("confirm"));
  if (password !== confirm) return { error: "As senhas não são iguais." };
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Link inválido ou expirado. Solicite um novo na tela de login." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("updatePassword:", error);
    return { error: "Não foi possível redefinir a senha. Tente novamente." };
  }

  redirect("/dashboard");
}
