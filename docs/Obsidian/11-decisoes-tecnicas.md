---
tags:
  - nauticflow
  - decisoes
updated: 2026-09-19
---
← [[00-INDEX]]

# Decisões técnicas e de produto

Log cross-cutting de decisões não triviais. Decisões substituídas ficam marcadas como **superseded**, nunca apagadas. Fonte: `DOCUMENTACAO.md` (números de seção como citados).

## Log de decisões

| Data | Decisão | Motivo | Status | Detalhe |
|---|---|---|---|---|
| 2026-08 (pré-lançamento) | Asaas roda em **Sandbox** em produção de propósito | Testar todo o fluxo de pagamento sem cobrar ninguém antes de abrir pra clientes reais | Ativo até o dono avisar "vou vender de verdade" | [[12-riscos-e-pendencias]] |
| 2026-08-20 | Landing **nunca** mostra depoimento falso | Ética comercial — site no ar com clientes reais visitando | Ativo (seção só com garantias verificáveis) | [[07-funcionalidades]] |
| 2026-08-20 | Upload de logo da empresa **adiado de propósito** | Trabalho real (Storage, redimensionamento, trocar avatar em vários lugares) sem travar ninguém hoje | Adiado, sem data | [[12-riscos-e-pendencias]] |
| 2026-08-15 | Chat de suporte (Tawk.to) integrado e depois **removido a pedido do dono** | Motivo de produto, ver seção 22 do DOCUMENTACAO.md | Descontinuado | [[12-riscos-e-pendencias]] |
| §44 (2026-08-20) | Publicação de passeio pelo operador é **autônoma**, sem aprovação prévia obrigatória do super admin | Decisão de produto explícita (não inventada na sessão) — validação automática de qualidade/segurança faz o gate, super admin modera depois | Ativo | [[08-integracao-toursflow]], [[07-funcionalidades]] |
| §57 (2026-08-31) | Comissão global inicial do marketplace = **10%** (1000 basis points), snapshot em basis points por venda | Arquitetura já pronta pra permitir override por empresa no futuro, mas hoje é global | Ativo | [[08-integracao-toursflow]] |
| §83/§1571 | Check-in do passageiro (`passengers.status`) **não libera saldo financeiro** — critério é `departures.status` + relógio, no nível da saída | Check-in prova presença de 1 passageiro, não do passeio inteiro | Ativo | [[04-banco-e-supabase]] |
| §2 (fundação) | Bootstrap de empresa/perfil/assinatura via **gatilho `handle_new_user()`** em `auth.users`, não RPC pós-signup | Cadastro "pela metade" real: sessão não existia a tempo pra RPC autenticada funcionar | Ativo | [[05-autenticacao-e-autorizacao]] |
| §45 (2026-08-27) | Anti-abuso do trial de 7 dias calculado **dentro do gatilho no banco**, nunca na aplicação | Endpoint de signup do Supabase é público, pode ser chamado direto — fingerprint precisa ser recalculado no banco a partir do dado bruto | Ativo | [[06-seguranca]] |
| §14/§73/§134 | Janela fixa de saída 08:00–19:00 (trigger, migration 0014) | Regra de negócio original, pedida pelo dono | **Superseded** pela introdução dos modelos de reserva `fixed_schedule`/`flexible_private` (migration 0073) — a janela global foi removida; regras de horário agora variam por modelo de reserva | [[04-banco-e-supabase]], [[07-funcionalidades]] |
| §79 (2026-08-29) | Renumeração de migrations por colisão em trabalho paralelo (0049/0050 → 0052/0053) | Duas frentes de trabalho geraram migrations com o mesmo número | Resolvido — decisão de processo registrada, evitar em futuras frentes paralelas | [[04-banco-e-supabase]] |
| §96 (2026-09-02) | Evidência comportamental (chamadas HTTP reais) tem **precedência sobre listagens da CLI da Vercel** sempre que houver conflito | `vercel env ls production` já divergiu 2x do comportamento real (TOURSFLOW_API_SECRET, alias de domínio) | Ativo — padrão de verificação do projeto | [[12-riscos-e-pendencias]] |
| §95→§96 | Ativação de `MARKETPLACE_PAYMENTS_ENABLED` continua **deliberadamente adiada** mesmo com a camada Bearer ToursFlow↔NauticFlow já validada | Camada `X-ToursFlow-Client-Key` e teste real de auth Asaas Produção ainda não concluídos; primeiro pagamento real será tratado como teste E2E produtivo acompanhado | Ativo | [[08-integracao-toursflow]] |
| §113/§114 (2026-09-10) | Rota `/api/cron/extend-schedules` liberada no proxy por **comparação exata de path** (`===`), não por prefixo | Não abrir de saída qualquer rota de cron futura sem revisão explícita | Ativo | [[06-seguranca]] |

## Architecture Decision Records (ADRs)

9 ADRs formais em `docs/adr/`, todas sobre o domínio do marketplace ToursFlow. Resumo executivo de cada uma está em [[08-integracao-toursflow]]; aqui só a lista de navegação (arquivo original entre parênteses):

1. Hold expirado vs. pagamento confirmado (`docs/adr/0001-hold-expirado-vs-pagamento-confirmado.md`)
2. Marketplace ledger, payout e refund (`docs/adr/0002-marketplace-ledger-payout-refund.md`)
3. Destino do payout e política de liberação (`docs/adr/0003-marketplace-payout-destination-and-release-policy.md`)
4. Cancelamento, no-show e política de reembolso (`docs/adr/0004-marketplace-cancellation-no-show-refund-policy.md`)
5. Saque e payout via Pix (`docs/adr/0005-marketplace-withdrawal-and-pix-payout.md`)
6. Comissão global do marketplace (`docs/adr/0006-marketplace-global-commission.md`)
7. Liquidação de pagamento Pix (`docs/adr/0007-marketplace-pix-payment-settlement.md`)
8. Automação de agenda do operador (`docs/adr/0008-operator-schedule-automation.md`)
9. Modelos de reserva fixo/flexível (`docs/adr/0009-booking-models-fixed-flexible.md`)

Ver também [[15-historico-e-changelog]] para a linha do tempo completa e [[12-riscos-e-pendencias]] para o que cada decisão ainda deixa em aberto.
