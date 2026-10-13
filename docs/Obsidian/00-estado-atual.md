---
tags:
  - nauticflow
  - estado-atual
updated: 2026-09-19
---
← [[00-INDEX]]

# Estado atual do NauticFlow

Resumo cross-cutting do que está pronto, em produção, em desenvolvimento ou deliberadamente desligado — feito pra uma sessão futura do Claude Code entender o estado real em menos de 2 minutos, sem precisar ler as 147 seções de `DOCUMENTACAO.md`. Data de referência: **2026-09-19** (última seção lida no fechamento deste vault: §147, 2026-09-15). Para qualquer coisa mais recente que isso, confira `DOCUMENTACAO.md` primeiro — este vault pode estar defasado.

## ✅ Em produção, estável

- SaaS core do NauticFlow (Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto/Voucher) — multi-tenant via RLS, `nauticflow.com.br`, deploy contínuo na Vercel.
- Cobrança de assinatura via Asaas — **Sandbox de propósito**, não produção real (ver bloqueio 🔴 abaixo).
- Autenticação, 2FA/TOTP obrigatório pro super_admin, RLS/IDOR corrigido em todas as classes de bug encontradas até hoje (ver [[06-seguranca]]).
- Equipe/convite, planos anuais, dashboard operacional (calendário de 7 dias + vento informativo), agenda/saídas, reserva de balcão, modelos de reserva `fixed_schedule`/`flexible_private`, alerta de nova reserva (toast+som+notificação).
- Painel `/admin` (super_admin): métricas, funil, suspensão manual, notas fiscais (controle manual, **não emite NF real**), moderação de passeios do marketplace.
- Marketplace ToursFlow — **catálogo e operação**: publicação autônoma do operador, moderação de imagem (modo `manual` por padrão), API pública somente-leitura (`/api/public/*`), reservas com hold de 15min + idempotência, Realtime do catálogo pro ToursFlow (`marketplace_catalog_state`).
- Automação de agenda recorrente (`tour_schedule_rules`) — liberada em produção (§115), com ressalvas de validação pendente (ver 🚧 abaixo).
- Landing institucional pública com seção de ecossistema NauticFlow+ToursFlow, planos/preços reais, vídeo do produto.
- Observabilidade: Sentry com DSN real configurada em produção (§145, 2026-09-15).

## 🟡 Construído por completo, mas DESLIGADO por flag (decisão de produto, não bug)

**Pagamentos reais do marketplace ToursFlow.** Este é o fato mais importante deste vault — ver [[08-integracao-toursflow]] seção 8 e [[12-riscos-e-pendencias]].

- Schema financeiro completo aplicado em produção (migrations até `0062`): ledger append-only, saldo bloqueado→disponível D+1, comissão global 10% configurada, saque via Pix, motor de reembolso real no provider.
- Webhook Asaas de produção configurado com os 14 eventos corretos. Camada Bearer ToursFlow↔NauticFlow validada por comportamento HTTP real. `TOURSFLOW_API_SECRET` **está** configurado em produção.
- `MARKETPLACE_PAYMENTS_ENABLED` e `MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED` seguem **OFF/ausentes em todos os ambientes**, inclusive produção — última confirmação seção 99 (2026-09-08), reafirmado pela cópia da landing na seção 147 (2026-09-15).
- Do lado do ToursFlow: botão "Confirmar reserva" inativo por flag própria dele (`BOOKING_CHECKOUT_ENABLED=false`).
- Todas as tabelas financeiras tinham **0 linhas** na última leitura direta do banco de produção. **R$ 0,00 movimentado** até a última seção lida.
- `NÃO CONFIRMADO` qualquer mudança desse estado após 2026-09-15 — não presuma que a flag foi ligada sem confirmar em `DOCUMENTACAO.md` ou no ambiente real.

## 🚧 Em produção mas com validação pendente (não é "quebrado", é "não confirmado")

- **Cron de extensão de agenda** (`/api/cron/extend-schedules`): blocker de proxy corrigido e confirmado (401 em vez de 307), mas a execução autenticada real com `CRON_SECRET` **nunca foi testada** (§113-115).
- **6 smoke tests funcionais da automação de agenda** (recurring-schedule create/edit, geração automática, pause/reactivate, preservação de departure protegida, data específica + herança de preço, publicação/sellability futura) — reportados honestamente como NÃO TESTADOS na sessão de release (§115), não como PASS.
- **Anomalia de propagação de domínio** em `nauticflow.com.br` observada em 2026-09-15 (§145) durante validação do Sentry — não corrigida, `NÃO CONFIRMADO` se persiste.
- **Confirmação visual no painel do Sentry** do evento de validação enviado — sucesso do lado do app confirmado, painel não checado programaticamente.
- Migrations `0061`/`0062`: aplicadas manualmente no schema real, mas `supabase_migrations.schema_migrations` não reflete isso (aplicadas fora do `db push`) — `supabase migration list` pode mentir dizendo "pendente". Ver [[04-banco-e-supabase]].

## 🔴 Bloqueante explícito antes de "vender de verdade"

**Trocar o Asaas de Sandbox pra Produção** — checklist definido e fechado em 2026-08-19, mas **ainda não executado** (é o próprio gatilho do lançamento comercial, esperando o dono do produto avisar). Ver [[12-riscos-e-pendencias]] pro checklist de 2 passos.

## ⏸️ Adiado de propósito / ❌ Descontinuado por decisão (não reabrir sem novo pedido)

- Logo da empresa customizável (upload) — adiado, sem demanda real ainda.
- CSP com nonce (remove `unsafe-inline`) — melhoria futura, não urgente.
- Chat de suporte online (Tawk.to) — integrado e depois **removido a pedido do dono** (2026-08-15).
- Depoimentos na landing — seção **removida de propósito**: nunca depoimento falso num site comercial no ar.

Ver [[13-roadmap]] pra lista completa de próximos passos e [[11-decisoes-tecnicas]] pra decisões que não devem ser reabertas sem pedido explícito do dono do produto.

## Divergências código vs. documentação registradas neste vault

- **Next.js**: README/textos antigos dizem "14", `package.json` real confirma `16.3.1` (pós-migração §32). Ver [[03-stack-e-infraestrutura]].
- **`src/middleware.ts` vs `src/proxy.ts`**: README ainda cita o nome antigo; renomeado em §38. Ver [[14-arquivos-importantes]].
- **`TOURSFLOW_API_SECRET`**: uma seção do próprio `DOCUMENTACAO.md` (§95) o registrou como ausente em produção; §96 corrigiu — na verdade está configurado. Ver [[08-integracao-toursflow]].
- **Janela de horário 08:00-19:00**: regra original de saída (migration `0014`) foi superseded pelos modelos de reserva `fixed_schedule`/`flexible_private` (migration `0073`), que removem a janela global. Ver [[04-banco-e-supabase]] e [[11-decisoes-tecnicas]].

## Como usar esta nota

Antes de propor qualquer trabalho novo: (1) confira aqui se o que você quer mexer já está pronto, desligado por flag, ou é pendência conhecida; (2) se for sobre marketplace/pagamentos, leia [[08-integracao-toursflow]] seção 8 primeiro; (3) se for sobre segurança, leia [[06-seguranca]] (não refaça auditoria já feita); (4) atualize esta nota (e a nota específica relevante) depois de qualquer mudança real — ver [[00-INDEX]] pra convenção de manutenção.
