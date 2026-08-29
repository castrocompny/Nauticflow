import * as Sentry from "@sentry/nextjs";

// Log de eventos de SEGURANÇA (tentativa de acesso negado, rate limit atingido,
// autenticação servidor-a-servidor rejeitada) -- achado da auditoria de segurança
// (item 10, logging/alertas). Reaproveita o Sentry já configurado no projeto em vez
// de criar infraestrutura nova; não grava em admin_audit_log de propósito -- aquela
// tabela tem RLS que só deixa um super_admin inserir em nome de si mesmo (migration
// 0016), então estruturalmente não serve pra registrar tentativa de quem NÃO é
// super_admin.
//
// Best-effort: nunca lança. Uma falha do Sentry (SDK indisponível, DSN não
// configurado, etc.) nunca pode derrubar o fluxo de autorização/rate limit que
// chamou isto -- o bloqueio em si já aconteceu antes desta chamada.
//
// NUNCA passar em `extra`: senha, token, cookie, e-mail, CPF/CNPJ completo, chave de
// API ou qualquer segredo. Só identificadores não sensíveis (ids, escopo do evento).
//
// `scope`, se informado, vira TAG do Sentry (junto com `event`) -- só faz sentido
// pra valores de baixa cardinalidade e não sensíveis, fixados no próprio código (ex:
// "login:ip", "forgot:email", "public-api:global" em src/lib/rate-limit.ts), nunca
// pra um identificador variável (IP, hash, e-mail). `extra` continua sem virar tag
// -- é onde ficam userId/companyId e qualquer outro dado de alta cardinalidade, que
// o Sentry aceita mas não indexa/filtra como tag (achado da reauditoria: filtros de
// alerta só funcionam contra tags, nunca contra `extra`).
export function logSecurityEvent(
  event: string,
  extra?: Record<string, string | number | boolean | null | undefined>,
  scope?: string
) {
  try {
    Sentry.captureMessage(`security.${event}`, {
      level: "warning",
      tags: { event, ...(scope ? { scope } : {}) },
      extra,
    });
  } catch {
    // silencioso -- ver comentário acima
  }
}
