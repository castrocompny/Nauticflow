import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// getAll/setAll assincronos (em vez de resolver cookies() uma vez no topo) pra nao
// precisar tornar createClient() async e mudar todo mundo que chama isso pra "await
// createClient()" -- o @supabase/ssr aceita metodos async nessa interface.
//
// persistSession: false remove o maxAge/expires que o @supabase/ssr define por padrao
// nos cookies de sessao, virando cookie de sessao do navegador (some ao fechar o
// navegador) -- usado pelo checkbox "Lembrar de mim" do login/cadastro.
export function createClient(clientOptions?: { persistSession?: boolean }) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          const cookieStore = await cookies();
          return cookieStore.getAll();
        },
        async setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            const cookieStore = await cookies();
            cookiesToSet.forEach(({ name, value, options }) => {
              const finalOptions =
                clientOptions?.persistSession === false
                  ? { ...options, maxAge: undefined, expires: undefined }
                  : options;
              cookieStore.set(name, value, finalOptions);
            });
          } catch {
            // chamado de um Server Component: ignorado, o middleware renova a sessao
          }
        },
      },
    }
  );
}
