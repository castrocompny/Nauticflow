import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// recebe o link de confirmacao/redefinicao de senha do Supabase e troca por uma
// sessao valida antes de redirecionar pro destino final (next). O Supabase manda
// ou um `code` (fluxo PKCE) ou um `token_hash`+`type` (fluxo OTP, usado por padrao
// no link de reset de senha) -- os dois precisam ser tratados, senao a sessao nunca
// e criada e o usuario acaba sem acesso na pagina seguinte.
//
// `next` vem de um query param controlado por quem monta a URL do link (achado da
// reauditoria de segurança) -- só dois destinos são realmente gerados pelo próprio
// app hoje (ver src/app/login/actions.ts e src/app/(app)/equipe/actions.ts), então
// allowlist explícita em vez de tentar "sanitizar" a string: elimina de vez qualquer
// truque de URL (ex: `next=@evil.com` virando `${origin}@evil.com`, interpretado
// como userinfo e redirecionando pra um host externo) sem depender de parsing.
// Qualquer valor fora da lista -- ausente, malformado, ou tentativa de redirect
// externo -- cai no mesmo fallback seguro, nunca é refletido na resposta.
const ALLOWED_NEXT_PATHS = new Set(["/dashboard", "/redefinir-senha"]);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const requestedNext = searchParams.get("next");
  const next = requestedNext && ALLOWED_NEXT_PATHS.has(requestedNext) ? requestedNext : "/dashboard";

  const supabase = createClient();
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && type) {
    await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  }

  return NextResponse.redirect(`${origin}${next}`);
}
