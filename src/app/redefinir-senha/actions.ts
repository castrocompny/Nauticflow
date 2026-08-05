"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password"));
  const confirm = String(formData.get("confirm"));
  if (password !== confirm) return { error: "As senhas não são iguais." };
  if (password.length < 6) return { error: "A senha precisa ter pelo menos 6 caracteres." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Link inválido ou expirado. Solicite um novo na tela de login." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  redirect("/dashboard");
}
