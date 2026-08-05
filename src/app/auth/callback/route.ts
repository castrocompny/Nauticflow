import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// recebe o link de confirmacao/redefinicao de senha do Supabase (?code=...), troca
// por uma sessao valida e redireciona pro destino final (next).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
