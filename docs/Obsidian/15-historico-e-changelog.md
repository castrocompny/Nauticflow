---
tags:
  - nauticflow
  - changelog
  - historico
updated: 2026-09-19
---
← [[00-INDEX]]

# Histórico e changelog

Mapa de navegação rápido pelas 147 seções de `DOCUMENTACAO.md` (a fonte completa, cite o número da seção pra ir direto ao detalhe). 🔴 marca achado/incidente crítico da própria sessão. Agrupado por período/tema — não é uma cópia linha a linha.

## Fundação (antes de 2026-08-10) — seções 1-9

Visão geral, stack, autenticação, cobrança Asaas, modelo de dados, convenções do repo. Base do produto antes do primeiro grande ciclo de sessões documentado.

## 2026-08-10 — Dashboard, performance, primeira auditoria de segurança

- §10-11: Dashboard/Agenda reformulados, regra de horário 08:00-19:00 (depois superseded, ver [[11-decisoes-tecnicas]]), modo escuro, gráficos no Financeiro.
- §12: Otimização de performance (deduplicação de `auth.getUser()`, cache de navegação).
- §13: Primeira auditoria de segurança — IDOR real em `reservations`/`passengers` corrigido, CVE-2025-29927 (Next.js) corrigida.

## 2026-08-12 — Supabase CLI e painel /admin

§14 CLI instalado · §15 `/admin` reformulado (suspensão manual, audit log) · §16 controle manual de notas fiscais · §17 gráficos/funil/onboarding travado · §18 validação final da leva de mudanças.

## 2026-08-14 a 08-16 — Primeiro deploy em produção

- §19-20: primeiro deploy Vercel, descoberta de dois projetos Vercel e um commit que nunca tinha ido ao ar.
- §21: chave do Asaas nunca tinha sido configurada — corrigido, checkout testado.
- §22: senha forte no cadastro/reset, botão de excluir conta.
- §23: domínio verificado no Resend (zona Cloudflare duplicada por engano, sem quebrar nada).
- §24-25: bug de timezone (UTC vs. Brasília) e fluxo de "esqueci minha senha" corrigidos.
- §26 🔴: nova auditoria — falha crítica de escalação de privilégio no convite, corrigida (migration `0018`).
- §27-29: favicon, headers de segurança (CSP/HSTS/X-Frame-Options), tabelas pesadas corrigidas.
- §30 🔴: descoberta de quem hospeda `nauticflow.com.br` de verdade + deploy bloqueado — resolvido tornando o repo público.

## 2026-08-17 a 08-24 — Pré-produção, 2FA, planos anuais

- §31: auditoria de segurança pré-produção.
- §32: migração major do Next.js 14 → 16.
- §33: 2FA/TOTP obrigatório pro Super Admin.
- §34-36: ajustes de sidebar, link Super Admin, 2 bugs de dev local.
- §37: sistema responsivo pra celular.
- §38: `middleware.ts` → `src/proxy.ts`, URL fixa nos e-mails.
- §39: webhook do Asaas cadastrado + pagamento E2E confirmado no Sandbox.
- §40-41: landing institucional na raiz `/`, FAQ, WhatsApp, analytics.
- §42-43: planos anuais (ciclo YEARLY no Asaas), admin atualizado.
- §44-49: cliente cancela assinatura, "Gerenciar plano"/zona de perigo, e-mail unificado, §47 🔴 cobrança dupla ao trocar de plano corrigida, bug de logo no og-image, menu com efeito vidro.
- §50-51: novo tipo de embarcação (táxi marítimo), dedup de passeios + botão excluir.
- §52-54: olhinho de senha/lembre-me, reenviar convite, bug de exclusão de conta com espaço no nome.
- §55-57 🔴: sequência de bugs reais no fluxo de convite (conta órfã → causa raiz `invited_at` → convite passa a usar Resend).
- §58-60: staff perde acesso a telas administrativas, Realtime em várias telas, §60 🔴 auditoria completa encontra falha crítica de graça no plano.
- §61-64: ciclo do plano visível, bug mensal↔anual, trava de reaproveitamento do trial, favicon com logo real.

## 2026-08-26 a 2026-09-08 — Construção do marketplace ToursFlow

Ciclo mais longo e mais crítico do projeto: preparação do core, hold de reserva, publicação autônoma, moderação de imagem, anti-abuso de trial por identidade, e todo o módulo financeiro (ledger, saque, comissão, Pix, reembolso), fechado com uma sequência formal de gates de ativação. Ver [[08-integracao-toursflow]] para o detalhe completo.

- §65-66: preparação do Core, fundação de reservas (hold 15min, idempotência, preço seguro).
- §67-71: publicação autônoma + suspensão administrativa, validação automática de qualidade/segurança, moderação de imagem via OpenAI (depois tornada opcional, modo manual é o padrão de lançamento).
- §72-74: anti-abuso de trial por identidade, §73 🔴 incidentes de `hmac()` corrigidos ao vivo em produção, §74 rodada completa de hardening (8 etapas) com deploy confirmado — **seção de referência pra qualquer trabalho futuro de segurança**.
- §75-80: Fase 4A (fundação de pagamento sem mover dinheiro), Fase 4B (ledger, D+1, saque, reembolso), §79 colisão real de numeração de migrations.
- §81-89: bloqueio de rede impedindo validação remota, chave Pix do operador, cancelamento/no-show/reembolso em 2 fases, saque Pix (adapter Asaas mock), comissão global 10%, Pix do cliente (cobrança real Asaas), fechamento financeiro.
- §90-96: sequência de gates de ativação (A, A.1, B.1, B.2A, B.2B) — validação sandbox, rotação de `service_role`, §95 decisão explícita de **não habilitar pagamentos ainda**, §96 correção importante: `TOURSFLOW_API_SECRET` na verdade **está** configurado em produção (a listagem da CLI enganava), camada Bearer validada.
- §97-99: fecha o gap de reembolso real no provider (ADR 0007), §98 hotfix de rollback (`0062`), §99 (2026-09-08) migrations `0061`/`0062` aplicadas manualmente em produção — **estado financeiro final**: schema completo até `0062`, comissão configurada, webhook com 14 eventos, mas pagamentos/saques seguem OFF deliberadamente.

## 2026-09-08 a 09-11 — Automação de agenda recorrente

- §100-103: `tour_schedule_rules` (agenda recorrente automatiza `departures`), hardening de reconciliação, revisão independente encontra blockers reais, release candidate.
- §104-108: dois bugs reais de Postgres achados e corrigidos em STAGING de verdade (`0064` ACL, `0065` ambiguidade de coluna, `0066` `AT TIME ZONE '-03:00'` ≠ `'America/Sao_Paulo'` — decisão anterior estava incorreta), validação funcional completa sem falhas.
- §109-112: descoberta de que Production já tinha `0063-0066` no schema antes do processo de release saber disso; reconciliação de migration history concluída.
- §113 🔴: achado bloqueante real — proxy de auth impedia o cron `/api/cron/extend-schedules` de sequer chegar na rota (redirect pra `/login`).
- §114: correção cirúrgica (path exato liberado no `isPublic` do middleware).
- §115: **RELEASE** — merge em `main`, deploy em produção, cron confirmado alcançável (401 em vez de 307) por evidência comportamental real; 6 smoke tests funcionais e o teste autenticado do cron continuam NÃO TESTADOS — ver [[12-riscos-e-pendencias]].

## 2026-09-10 a 09-15 — UX operacional, vento, alertas, landing redesign

- §116: UX do operador simplificada (agenda em destaque, config inicial de 1 passo).
- §117-119 🔴: dois bugs reais em produção (`createTourDraft()` 42501 por trigger sem `SECURITY DEFINER`, `departs_at` 42702 por funções LIVE divergentes) corrigidos por `0067`/`0068`, reteste PASS de ponta a ponta.
- §120: catálogo NauticFlow→ToursFlow em tempo real (`marketplace_catalog_state`, Postgres Changes pra `anon`).
- §121-124: UX de edição de passeio, exclusão = arquivamento (nunca hard delete), "excluir todas as saídas" atômico.
- §125-130: condições do vento no Dashboard (Etapa 1 informativa, Etapa 2 por saída), Dashboard simplificado pra central de operação de hoje + calendário de 7 dias.
- §131-132: reserva de balcão + estoque único, bug de preço automático corrigido.
- §133: `availableSpots` exposto no marketplace (nunca a capacidade interna).
- §134-135: modelos de reserva `fixed_schedule`/`flexible_private` (remove a janela global 08:00-19:00), fixes de UX.
- §136-137: Fix NF-001 (overlap real de embarcação) e NF2-001 (passeio arquivado não recebe reserva de balcão nova) — achados de auditoria funcional.
- §138-140: alerta de nova reserva (toast+som+notificação), validação E2E, bug real de arbitragem multi-aba no `ReservationNotifier` corrigido.
- §141-143: redesign da landing (ecossistema NauticFlow+ToursFlow), crédito institucional Castro Compny, vídeo real do produto + seções interativas.
- §144-145: placeholder quebrado do Sentry corrigido (fallback de validação de formato de DSN), DSN real configurada em produção, evento de validação enviado com sucesso — confirmação final no painel e anomalia de propagação de domínio ficaram como pendência (ver [[12-riscos-e-pendencias]]).
- §146-147: clareza matemática de preços na landing (mensal vs. anual), expansão da seção Ecossistema (fluxo Operador→NauticFlow→ToursFlow→Turista).

## Sessões de debug/temporárias (contexto, não marcos)

§24, §27, §36: sessões de diagnóstico temporário que existiram só pra resolver um bug pontual (gatilho de convite, Realtime, dev local) — o código de diagnóstico foi removido em seguida (ex.: §28 remove o que §27 criou). Citadas aqui só pra quem for investigar um bug similar saber que já houve tentativa de diagnóstico parecida.

Ver [[11-decisoes-tecnicas]] para decisões extraídas desta linha do tempo e [[12-riscos-e-pendencias]] para o que ainda está em aberto.
