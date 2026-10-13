---
tags:
  - nauticflow
  - roadmap
updated: 2026-09-19
---
← [[00-INDEX]]

# Roadmap

Próximos passos concretos, derivados do que está documentado como pendente em `DOCUMENTACAO.md`. Nada aqui é inventado — cada item tem lastro numa seção específica. Ver [[12-riscos-e-pendencias]] para o detalhe de cada risco.

## Antes do lançamento comercial

- [ ] Trocar `ASAAS_API_URL`/`ASAAS_API_KEY` na Vercel pras credenciais de **produção** do Asaas (hoje Sandbox de propósito).
- [ ] Cadastrar webhook na conta de **produção** do Asaas (token novo, `ASAAS_WEBHOOK_TOKEN` sincronizado, URL `https://nauticflow.com.br/api/webhooks/asaas`).
- [ ] Confirmar se a anomalia de propagação de domínio em `nauticflow.com.br` (achado de 2026-09-15) ainda ocorre — `NÃO CONFIRMADO`.

## Ativação financeira do marketplace (ToursFlow)

Ver [[08-integracao-toursflow]] para o estado completo. Checklist do que falta antes do primeiro Pix real (última confirmação: seção 99, 2026-09-08):

- [ ] Validar a camada `X-ToursFlow-Client-Key` end-to-end (ADR ainda não confirmado).
- [ ] Executar teste real de autenticação contra o Asaas Produção (bloqueado historicamente pela proteção de Secret da Vercel — pode exigir o usuário rodando localmente com credenciais em mãos).
- [ ] Testar criação e cancelamento de uma cobrança Pix pendente controlada (sem pagar), confirmando ausência de custo.
- [ ] Só então decidir habilitar `MARKETPLACE_PAYMENTS_ENABLED`.
- [ ] Reconciliar `supabase_migrations.schema_migrations` para `0061`/`0062` via `supabase migration repair` quando a conectividade do CLI normalizar.
- [ ] `PAYMENT_RECEIVED` real e validação E2E do webhook — pendente da primeira venda real, tratada como teste E2E produtivo acompanhado.

## Automação de agenda — validação pendente

- [ ] Confirmar execução real do cron `/api/cron/extend-schedules` com `CRON_SECRET` real (retorno 200) — só 401 sem header foi confirmado.
- [ ] Rodar os 6 smoke tests funcionais ainda não testados: recurring-schedule create/edit, geração automática de departures, pause/reactivate, preservação de departure protegida, criação de data específica + herança de preço, publicação/sellability futura.

## Observabilidade

- [ ] Confirmar no painel do Sentry que o evento de validação de 2026-09-15 chegou de fato (o envio teve sucesso do lado do app, mas a confirmação visual no painel não foi verificada programaticamente).

## Melhorias futuras opcionais (sem data, baixa prioridade)

- [ ] CAPTCHA (hCaptcha/Turnstile) no login — só se houver sinal de abuso real (acompanhável via Authentication → Audit Logs no Supabase).
- [ ] CSP com nonce (remover `unsafe-inline` do `script-src`).
- [ ] `/admin`: impersonar empresa pra dar suporte, exportar lista de empresas em CSV, indicador de risco de churn.
- [ ] Logo da empresa customizável (upload, Storage, redimensionamento).
- [ ] Reconsiderar chat de suporte, preferindo provedor com bot de IA gratuito de verdade.
- [ ] Verificação de magic bytes no upload de fotos de passeio.
- [ ] 2FA pra troca de chave Pix do operador.
- [ ] Vento com classificação de segurança de navegação ("seguro pra navegar"), com limiares configuráveis por empresa/embarcação.
- [ ] Permitir papel `staff` customizar preferências do alerta de nova reserva.
- [ ] Unificar o desenho do favicon com o logo real.
- [ ] Reativar seção de depoimentos na landing quando houver avaliações reais de clientes.
- [ ] Split de comissão do marketplace por operador (`asaas_wallet_id`) — hoje é só comissão global.
- [ ] Reembolso de saldo já `transferred` (sacado) — cenário de dívida do operador, hoje não implementado.
- [ ] Decidir se operador com assinatura vencida continua recebendo reservas do marketplace.

## Dívida técnica não-bloqueante

Registradas na rodada de hardening (seção 74) — nenhuma é vulnerabilidade em aberto. Ver [[06-seguranca]] e [[04-banco-e-supabase]]:

- [ ] TTL de `api_rate_limits`.
- [ ] Rate limit global da API pública (endurecer).
- [ ] Rate limit de autenticação contra botnet distribuída.
- [ ] Caminho de falha na deduplicação do webhook Asaas.
- [ ] Limpar/arquivar migrations históricas órfãs: `0000b`, `0000c`, `0032`, `0033`.
- [ ] Reavaliar os 2 advisories HIGH residuais do `npm audit` numa futura migração de major version do Next.js.
- [ ] Reavaliar migration `0022_passeios_dedup.sql` — precisa ser rodada manualmente no Supabase se ainda não tiver sido (limpeza de backlog, não afeta código novo).

## Não é roadmap — decisões conscientes que não vão mudar sem novo pedido explícito

Não confundir com pendência: Sandbox do Asaas até o lançamento comercial ser decidido, ausência de depoimentos falsos na landing, chat de suporte removido, logo customizável adiado. Ver [[11-decisoes-tecnicas]].
