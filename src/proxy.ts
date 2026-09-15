import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // robots.txt e sitemap.xml ficam de fora do proxy de auth -- senao o middleware
  // redireciona eles pro /login (307) em vez de servir o arquivo pros crawlers.
  //
  // mp4/webm entraram pelo MESMO motivo, e o sintoma foi real, nao teorico: o
  // video de demonstracao da landing (`/videos/nauticflow-reserva-demo.mp4`)
  // respondia 307 -> /login para qualquer visitante anonimo, porque so as
  // extensoes de IMAGEM estavam excluidas aqui. Sem esta linha o <video> da
  // pagina publica recebe o HTML do login no lugar do arquivo e o navegador
  // falha com "The element has no supported sources".
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm)$).*)",
  ],
};
