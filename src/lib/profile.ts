import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Carrega o profile do usuario logado. company_id alimenta todos os inserts.
export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, company_id, role, name, email")
    .eq("id", user.id)
    .single();
  return data as Profile | null;
}
