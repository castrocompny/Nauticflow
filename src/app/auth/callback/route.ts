import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// recebe o link de confirmacao/redefinicao de senha do Supabase e troca por uma
// sessao valida antes de redirecionar pro destino final (next). O Supabase manda
// ou um `code` (fluxo PKCE) ou um `token_hash`+`type` (fluxo OTP, usado por padrao
// no link de reset de senha) -- os dois precisam ser tratados, senao a sessao nunca
// e criada e o usuario acaba sem acesso na pagina seguinte.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = createClient();
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && type) {
    await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  }

  return NextResponse.redirect(`${origin}${next}`);
}
