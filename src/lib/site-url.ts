// URL fixa do site, usada em links enviados por e-mail (reset de senha, convite de
// equipe) -- antes dependia de headers().get("origin"), que é o cabeçalho Origin da
// requisição: normalmente confiável (o Next.js valida Origin/Host em Server Actions),
// mas é uma dependência frágil de comportamento de framework pra algo sensível como
// link de redefinição de senha. Com domínio de produção definitivo, uma env var fixa
// é mais direta e não depende de nenhum cabeçalho.
//
// Em produção, NEXT_PUBLIC_SITE_URL é setada explicitamente (nauticflow.com.br). Em
// deploys de preview (branch de teste, ver seção 9 do DOCUMENTACAO.md), a Vercel expõe
// sozinha a URL daquele deploy específico em VERCEL_URL -- sem isso, o link do e-mail
// de reset/convite testado num preview apontaria pro site de produção por engano.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
