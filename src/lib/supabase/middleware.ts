import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: any }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/" || // landing institucional (raiz) e publica -- casa EXATO, nao startsWith
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/redefinir-senha") ||
    path.startsWith("/termos") ||
    path.startsWith("/privacidade") ||
    path.startsWith("/api/webhooks") ||
    // vitrine somente-leitura do futuro ToursFlow -- precisa ser alcançável por
    // visitante sem sessão (é literalmente o público-alvo dela). Sem esta linha,
    // o middleware redirecionava qualquer chamada anônima pra /login antes mesmo
    // de a rota rodar -- achado testando de verdade depois do deploy do schema.
    path.startsWith("/api/public") ||
    // rota servidor-servidor pro ToursFlow iniciar reserva (POST /api/marketplace/bookings)
    // -- autentica com segredo compartilhado (Authorization: Bearer), nunca com sessão de
    // usuário logado. Mesmo motivo/achado de /api/public acima: sem isto, o middleware
    // redireciona a chamada pra /login antes mesmo da rota checar o Bearer.
    path.startsWith("/api/marketplace") ||
    // cron de auto-extensão da agenda recorrente (Vercel Cron -> GET /api/cron/
    // extend-schedules) -- autentica com Authorization: Bearer $CRON_SECRET, nunca com
    // sessão de usuário (a chamada real da Vercel não carrega cookie nenhum). Mesmo
    // achado de /api/public e /api/marketplace acima: sem isto, o proxy redireciona a
    // chamada pra /login antes mesmo da rota checar o CRON_SECRET -- rota exata (não um
    // prefixo /api/cron amplo) pra não liberar de saída qualquer cron futuro sem revisão.
    path === "/api/cron/extend-schedules";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // quem ja tem sessao nao precisa ver login nem a landing -- vai direto pro app
  if (user && (path === "/login" || path === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
