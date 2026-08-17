import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Carrega o profile do usuario logado. company_id alimenta todos os inserts.
//
// `cache()` faz o Next.js reaproveitar o resultado entre todas as chamadas
// dentro da MESMA requisicao (ex: layout.tsx e a page.tsx chamando isso na
// mesma navegacao) -- sem isso, cada chamada gastava uma ida e volta real ate
// a API de Auth do Supabase (supabase.auth.getUser() nao eh um check local),
// e o layout + a maioria das paginas chamavam isso 2-3x por clique.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, company_id, role, name, email, companies(name, city)")
    .eq("id", user.id)
    .single();
  return data as unknown as Profile | null;
});
