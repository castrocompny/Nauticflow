// Rate limiting pra login/cadastro/recuperação de senha e pra vitrine pública
// (/api/public/*) -- reaproveita a MESMA infraestrutura já existente
// (public.check_rate_limit + public.api_rate_limits, migration 0042), a mesma
// usada por src/app/api/marketplace/bookings/route.ts. Nenhuma tabela/função nova.
//
// Diferente da rota do marketplace (fail-closed -- um único parceiro conhecido,
// tráfego previsível, pode se dar ao luxo de recusar se a checagem falhar), aqui
// o rate limit é uma camada SECUNDÁRIA sobre fluxos de usuário final -- se a
// checagem em si falhar por motivo técnico (RPC fora do ar, etc.), preferimos
// deixar a operação principal seguir (fail-open) a derrubar login/cadastro/
// vitrine pública pra todo mundo por causa de uma proteção secundária.
import { headers } from "next/headers";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/security-log";

// Vercel é o único proxy nesta arquitetura (sem CDN/WAF extra na frente do
// nauticflow.com.br) -- pra tráfego que chega DIRETO do navegador do usuário
// final (login, cadastro, esqueci senha), o PRIMEIRO IP de x-forwarded-for é o
// que a borda da Vercel escreve com o IP observado na conexão real. Isto só é
// usado nessas rotas -- /api/public/* NÃO usa IP como chave (ver
// src/lib/public-api.ts, checkPublicApiRateLimit), porque hoje não há garantia
// de que quem chama ali é o navegador do visitante final (pode ser o próprio
// servidor do ToursFlow renderizando páginas de listagem/SEO), e um limite por
// IP arriscaria bloquear tráfego legítimo concentrado numa única origem.
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip || "unknown";
}

// nunca guarda o valor bruto (e-mail) na tabela de rate limit -- só o hash.
// Não precisa de pepper/segredo aqui (diferente do fingerprint de trial-abuso,
// migration 0045): esta chave só precisa ser estável pra agrupar tentativas, não
// resistir a um ataque direcionado de descobrir o valor original.
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// true = liberado (dentro do limite, OU a checagem falhou tecnicamente --
// fail-open, ver comentário no topo do arquivo). false = bloqueado.
export async function checkRateLimit(consumerKey: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_consumer_key: consumerKey,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("checkRateLimit RPC error:", error.message);
    return true;
  }
  const allowed = data === true;
  if (!allowed) {
    // "scope" é só o prefixo semântico da chave (ex: "login:ip", "forgot:email",
    // "public-api:global") -- nunca o valor bruto depois disso, que é IP/hash real.
    // Ponto único: cobre login/signup/forgot-password e a API pública, que passam
    // todos por aqui (ver src/app/login/actions.ts e src/lib/public-api.ts).
    // Vai como tag (3º argumento) -- é um conjunto fixo e pequeno de valores
    // controlados pelo código, filtrável de verdade no Sentry (achado da
    // reauditoria: coisa de alta cardinalidade continua indo só em `extra`).
    const scope = consumerKey.split(":").slice(0, 2).join(":");
    logSecurityEvent("rate_limited", undefined, scope);
  }
  return allowed;
}
