import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Client com service_role — so pode ser usado em codigo que roda no servidor
// (Server Actions, Route Handlers). Nunca importar isso em um Client Component.
// Necessario pra convidar usuarios (auth.admin.inviteUserByEmail), que exige
// privilegio de admin e nao existe no client normal baseado em sessao/cookies.
export function createAdminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
