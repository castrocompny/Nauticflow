---
tags:
  - nauticflow
  - riscos
  - pendencias
updated: 2026-09-19
---
← [[00-INDEX]]

# Riscos e pendências

Consolidação do que está em aberto hoje. Fonte primária: seção 6 do `DOCUMENTACAO.md` (lista viva de pendências, mantida atualizada pelo próprio projeto) + achados espalhados por outras seções, citadas caso a caso.

## 🔴 Bloqueante antes de vender de verdade

**Trocar o Asaas de Sandbox pra Produção** (checklist fechado em 2026-08-19, mas ainda não executado — é o gatilho de lançamento comercial em si, não um bug). Produção (`nauticflow.com.br`) usa Sandbox do Asaas **de propósito**, decisão consciente de teste já validada ponta-a-ponta. Passos quando o dono avisar "vou vender de verdade":
1. Trocar `ASAAS_API_URL`/`ASAAS_API_KEY` na Vercel pras credenciais de produção (sandbox tem prefixo `$aact_hmlg_`, produção `$aact_prod_`).
2. Cadastrar o webhook de novo na conta de **produção** do Asaas (sandbox e produção são contas separadas no Asaas) — gerar token novo, sincronizar `ASAAS_WEBHOOK_TOKEN` na Vercel, cadastrar `https://nauticflow.com.br/api/webhooks/asaas`.

O `asaas_subscription_id` salvo hoje na empresa do dono é de assinatura de teste, sem cobrança real.

## Ativação de pagamentos do marketplace (ToursFlow)

Decisão de produto pendente, não um bug. Ver estado completo em [[08-integracao-toursflow]]. Resumo: schema financeiro completo aplicado em produção (migrations até `0062`), comissão 10% configurada, webhook Asaas produção com os 14 eventos corretos, camada Bearer ToursFlow↔NauticFlow validada por comportamento HTTP real — mas `MARKETPLACE_PAYMENTS_ENABLED`/`MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED` seguem **deliberadamente OFF** (último estado confirmado: seção 99, 2026-09-08). Falta antes do primeiro Pix real: validar a camada `X-ToursFlow-Client-Key` (ADR ainda não confirmado, seção 97), testar autenticação real contra o Asaas Produção, só então decidir habilitar a flag. `NÃO CONFIRMADO` qualquer mudança de estado depois de 2026-09-08 — não localizada leitura mais recente que confirme ativação.

**Migration history**: `0061`/`0062` foram aplicadas manualmente via SQL Editor (não via `db push`), então `supabase_migrations.schema_migrations` não foi atualizada — reconciliação via `supabase migration repair` fica pendente até a conectividade do CLI normalizar. `supabase migration list --linked` pode mostrar as duas como pendentes mesmo estando aplicadas no schema real — não interpretar como "não aplicado" sem checar o schema ao vivo primeiro.

## Achado recente ainda não fechado (2026-09-15)

**Anomalia de propagação de domínio em `nauticflow.com.br`**: durante a validação do Sentry (seção 145), o domínio customizado ficou servindo uma versão desatualizada da home por mais de 1h mesmo após 5 deploys de produção consecutivos + purge de cache CDN explícito. Causa provável: a conta não tem permissão de `alias` manual sobre `nauticflow.com.br` (erro confirmado: "You don't have access to the domain... under nautic-flow"). Não foi corrigido (fora do escopo daquela sessão) — **registrado como item separado a abrir depois**. `NÃO CONFIRMADO` se persiste hoje.

**Confirmação de entrega do Sentry no painel**: evento de validação enviado com sucesso (event ID real devolvido), mas a confirmação de que apareceu no painel do Sentry depende do usuário checar manualmente (sem `SENTRY_AUTH_TOKEN` disponível na sessão que fez o teste) — `NÃO CONFIRMADO`.

**Cron de extensão de agenda** (`/api/cron/extend-schedules`): o blocker de proxy (rota redirecionando pra `/login`) foi corrigido e confirmado em produção (401 em vez de 307, seção 114/115). Mas o teste autenticado (200 com `CRON_SECRET` real) **nunca foi executado** — 401 sem header não distingue "secret configurado certo" de "secret ausente". Só uma execução real do cron da Vercel, ou o usuário testando manualmente, confirma o caminho de sucesso. `NÃO CONFIRMADO`.

**6 smoke tests funcionais da automação de agenda** (recurring-schedule create/edit, geração automática de departures, pause/reactivate, preservação de departure protegida, criação de data específica + herança de preço, publicação/sellability futura) — não testados na sessão de release (seção 115) por falta de UI/credenciais reais disponíveis. Reportado honestamente como NÃO TESTADO, não como PASS. `NÃO CONFIRMADO`.

## Pendências técnicas não-bloqueantes (rodada de hardening, seção 74)

Nenhuma é vulnerabilidade em aberto — candidatas a rodada futura de manutenção/confiabilidade. Ver [[06-seguranca]] para o hardening completo.

- TTL de `api_rate_limits` (limpeza de linhas antigas).
- Rate limit global da API pública.
- Rate limit de autenticação contra botnet distribuída (hoje mitigado por IP, não por padrão coordenado).
- Caminho de falha na deduplicação do webhook Asaas.
- Migrations históricas órfãs/temporárias: `0000b`, `0000c`, `0032`, `0033` — ver [[04-banco-e-supabase]].
- 2 advisories HIGH residuais no `npm audit` (SSRF em rewrites com host controlado por env var interna, DoS em Server Components) — só têm correção na branch major 15/16 do Next; não se aplicam hoje (sem custom server, i18n, `images.remotePatterns` ou WebSocket). Reavaliar em futura migração de major version.

## Gaps de produto documentados e aceitos (decisão explícita, não esquecimento)

| Gap | Onde | Por quê |
|---|---|---|
| Magic bytes / conteúdo real do arquivo de foto não verificado (confia no `Content-Type` declarado) | Upload de fotos de passeio | Verificar exigiria baixar cada foto no servidor; instrução explícita "não criar custo absurdo" |
| Fotos antigas (`legacy_approved`) e `manual_approved` não são remoderadas automaticamente se o modo mudar pra `openai` | Moderação de imagem | Evita custo inesperado e mudança de catálogo sem aviso; remoderação histórica ficaria como processo opcional separado |
| Backfill de anti-abuso de trial pros 3 companies existentes na época | Trial 7 dias | Sem jeito confiável de distinguir "trial histórico" de "já pago" automaticamente; estratégia sugerida é manual, por empresa |
| Split de comissão por operador (`asaas_wallet_id`) | Marketplace financeiro | Nenhuma company tem configurado — bloqueador registrado, nenhum percentual/wallet inventado |
| Reembolso de saldo já `transferred` (sacado) | Marketplace financeiro | Não implementado — pendência explícita (cenário de dívida do operador) |
| 2FA pra troca de chave Pix do operador | Marketplace financeiro | Sem infraestrutura de 2FA no projeto ainda (fora do super_admin) — hardening futuro |
| Formato exato do campo PHONE (com/sem `+55`) | Pix do cliente | Não confirmado nem na revisão do ADR 0007 — dígitos normalizados enviados como estão |
| Alerta de nova reserva não customizável pelo papel `staff` | Notificações | `/configuracoes` redireciona `staff` pra `/dashboard`; staff recebe os defaults (som ligado, notificação desligada) sem onde ajustar |
| Vento sem classificação de segurança de navegação ("seguro pra navegar") | Dashboard | Etapa deliberadamente só informativa; limiares configuráveis por empresa/embarcação ficam pra etapa futura |
| Decisão sobre bloquear reservas de marketplace pra operador com assinatura vencida | Marketplace | Decisão de produto pendente — a rota hoje **não** aplica esse bloqueio |

## Adiado de propósito

- **Logo da empresa customizável** (upload de imagem pra sidebar/cabeçalho/voucher) — avaliado em 2026-08-20, trabalho real de Storage/validação/redimensionamento, sem travar ninguém hoje.
- **CSP com nonce** — hoje libera `unsafe-inline` em `script-src` por causa do script anti-flash do tema; endurecer é melhoria futura, não urgente.
- **Unificar o desenho do favicon** — usa um terceiro desenho (só ondas, sem barco), diferente do logo real e do ícone antigo do `og-image`. Fica pra quando o dono confirmar que quer.

## Descontinuado por decisão

- **Chat de suporte online** (Tawk.to) — integrado 2026-08-14, removido a pedido do dono 2026-08-15. Contato hoje é só o link de WhatsApp no `OverdueBanner`. Se reconsiderar, preferir provedor com bot de IA gratuito de verdade.
- **Depoimentos na landing** — seção removida de propósito (2026-08-20): nada de depoimento falso num site comercial no ar. Reativar quando houver avaliações reais.

## Melhorias futuras não urgentes (baixa prioridade, registradas mas não priorizadas)

CAPTCHA (hCaptcha/Turnstile) no login — só se houver sinal de abuso real. `/admin`: impersonar empresa, exportar CSV, indicador de risco de churn — não urgente com base de clientes pequena.

Ver [[13-roadmap]] para os próximos passos organizados em checklist e [[06-seguranca]] para o detalhe de segurança.
