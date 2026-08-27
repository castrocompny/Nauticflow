-- Corrige um problema real encontrado na auditoria: o webhook do Asaas
-- (src/app/api/webhooks/asaas/route.ts) soma dias a subscriptions.paid_until sem
-- nenhuma checagem de "esse evento já foi processado antes". Se o Asaas reenviar
-- a mesma notificação (retry normal quando a resposta demora/falha) -- ou mandar
-- PAYMENT_CONFIRMED e, na sequência, PAYMENT_RECEIVED para o MESMO pagamento --
-- a assinatura ganhava o prazo somado de novo, cumulativamente. Isso já afeta o
-- SaaS hoje (antes mesmo do marketplace existir), por isso a correção entra já.
--
-- Chave de deduplicação: só o id do pagamento do Asaas (payment.id), sem o tipo de
-- evento -- de propósito. É exatamente isso que impede PAYMENT_CONFIRMED e
-- PAYMENT_RECEIVED do MESMO pagamento renovarem duas vezes (ver route.ts): a
-- primeira chamada que conseguir inserir a chave "ganha" o direito de renovar: as
-- demais (reenvio do mesmo evento, ou o segundo evento do mesmo pagamento) batem
-- na unique constraint e são silenciosamente ignoradas.
create table public.processed_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null,
  event_key text not null,
  processed_at timestamptz not null default now(),
  unique (provider, event_key)
);

-- RLS habilitada sem nenhuma policy: só o service_role usado pela rota de webhook
-- (que já bypassa RLS) grava/lê aqui -- mesmo padrão de trial_history (0031) e
-- payments (0036).
alter table public.processed_webhook_events enable row level security;

create index on public.processed_webhook_events (provider, event_key);
