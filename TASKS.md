# NauticFlow — Tarefas e pendências

## Estado confirmado

- [x] Fluxo Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto/Voucher.
- [x] Isolamento multiempresa com RLS e regras críticas no PostgreSQL.
- [x] Dashboard, agenda, reservas, saídas, clientes, embarcações, parceiros, passeios, financeiro, equipe e admin.
- [x] API pública para ToursFlow documentada em `docs/PUBLIC-API-CONTRACT.md`.
- [x] Asaas, Resend, Sentry e Vercel integrados em pontos específicos.
- [x] Tema claro/escuro e ajustes responsivos.

## Pendências prioritárias

- [ ] Revisar e consolidar divergências históricas entre `README.md`, `DOCUMENTACAO.md` e `package.json`.
- [ ] Completar/validar `.env.example` sem incluir segredos.
- [ ] Confirmar estado real de produção e Sandbox do Asaas antes de qualquer lançamento comercial.
- [ ] Aplicar/verificar migrations pendentes no ambiente correto, sem assumir que arquivo local significa migration aplicada.
- [x] Validar a migration `0080_marketplace_policy_snapshot.sql` em ambiente local/isolado antes de qualquer aplicação (2026-10-13: Supabase local, pgTAP `supabase/tests/database/` 83/83 — snapshot 46 + identidade/DELETE/marca da RPC 37).
- [x] Corrigir bypass de idempotência: operador alterava `source`/key/fingerprint ou apagava reserva marketplace e o replay criava outra reserva (0080, triggers de identidade e DELETE).
- [x] Autorização positiva do INSERT marketplace (marca transacional da RPC em vez de lista de papéis), forma canônica da política no banco, NUL → 400 e contrato com 201/200/`Idempotency-Replayed` e tabela de erros (2026-10-13).
- [ ] Rodar o pgTAP (`supabase test db --local`) em CI/script do projeto.
- [ ] Esconder o botão "Excluir" para reservas do marketplace na lista de reservas (hoje o banco recusa e a ação mostra mensagem orientando cancelar).
- [ ] Aplicar 0080 em Staging e depois Produção na ordem da seção 12 de `docs/PUBLIC-API-CONTRACT.md` (ToursFlow enviando `marketplacePolicy` antes da rota nova).
- [ ] Migration posterior revogando a assinatura antiga de `create_marketplace_booking` (10 parâmetros) após o deploy da rota nova.
- [ ] Criar ou ampliar testes automatizados para RLS, RPCs, Server Actions críticas e webhooks.
- [x] Webhook Asaas (P1, local): transferência, `PAYMENT_CONFIRMED`, `PAYMENT_DELETED` e refunds com marca + efeito na mesma transação (`0085`, `process_marketplace_transfer_webhook_event`/`process_marketplace_payment_webhook_event`); rota sem insert direto de marca e com validação do retorno (2026-10-20: pgTAP 244/244 do zero e concorrência com duas sessões no Supabase local isolado `nauticflow-asaas-p1-isolated`). Não aplicado em staging/produção.
- [x] Executar no Supabase local isolado o pgTAP da fila paginada (`0083`/`0084`) e o teste ajustado da `0082` (2026-10-20: PASS, banco isolado recriado do zero).
- [x] Webhook Asaas (P1, local): fechamento de refund pelo webhook sem `auth.uid()` (`finalize_marketplace_refund_internal`, ator `system`; wrapper humano mantido) e funções de efeito da 0055/0056/0059/0060 que falhavam sempre por coluna ambígua corrigidas na `0085`.
- [ ] Verificar em staging/produção, antes de aplicar a `0085`, se as funções de efeito da 0055/0056/0059/0060 também falham lá por coluna ambígua (`plpgsql.variable_conflict`), quantos saques/refunds/cobranças ficaram presos por isso e se há marcas em `processed_webhook_events` sem efeito; planejar a reconciliação desses registros (o webhook só reaplica eventos reenviados).
- [x] `finalize_marketplace_withdrawal` com trava (`FOR UPDATE`) e UPDATE condicionado ao status (`0086`, local): desfechos concorrentes chamados direto não aplicam mais os dois ledgers (2026-10-20: RED e GREEN com duas sessões no Supabase local isolado).
- [x] `withdrawal-actions.ts` registra a falha de `mark_marketplace_withdrawal_processing` depois de uma transferência aceita, sem disparar outra; `bookings/[id]/payment/route.ts` não devolve o QR quando `mark_marketplace_payment_provider_created` falha (retry reconcilia a mesma cobrança pelo `externalReference`) (local, Vitest).
- [x] Webhook Asaas, revisão Codex da 0085 (local, `0086`/`0087`): identidade da cobrança em `PAYMENT_DELETED`/refunds; refund nunca correlacionado com pedido de outro `provider_refund_id` nem fechado sem id do provedor; reconciliação com trava e status revalidado (corrida com o fechamento humano reproduzida e corrigida com duas sessões); revisão manual sem id por notificação; marcas do marketplace na tabela própria (`marketplace_processed_webhook_events`), sem disputar a chave do SaaS; `provider_transfer_id` divergente recusado; parsers da rota exigem status coerente com evento/desfecho; evento de objeto local sem campos/referência responde 422; dono `postgres` explícito; script de concorrência só roda no projeto isolado provado e falha com exit 1 em divergência (2026-10-20: pgTAP 287/287, concorrência 48/48, Vitest 153/153).
- [ ] Antes de aplicar `0085`–`0087` fora do local: conferir em staging/produção os grants efetivos de `service_role` (a 0051 registra privilégios mais amplos em produção), o dono das funções e se quem aplica migrations pode `ALTER FUNCTION ... OWNER TO postgres`; rodar a cadeia inteira do zero num banco limpo (aqui 0086/0087 foram aplicadas incrementalmente sobre a 0085).
- [ ] Payments `pending` sem `provider_payment_id` gravado (criação da cobrança cuja gravação falhou -- inclusive antes da 0085, quando `mark_marketplace_payment_provider_created` sempre falhava) recebem `PAYMENT_DELETED`/refund com 5xx em loop (`PROVIDER_PAYMENT_ID_UNCONFIRMED`) até alguém vincular a cobrança; levantar esses casos em produção e decidir o procedimento de vínculo.
- [ ] Refund sem id do refund do provedor no payload agora sempre vai para revisão manual (nunca conclui sozinho). Confirmar no contrato real do Asaas o campo do id do refund (a rota usa o último item de `payment.refunds`); sem `body.id`, notificações distintas do mesmo tipo ainda colapsam numa revisão (`${event}:${payment.id}`).
- [ ] Revisões manuais de refund (`marketplace_refunds` `manual_review`/`settlement_exception`) não têm tela/fluxo de resolução; decidir o fluxo administrativo (não reutilizar a fila de `PAYMENT_RECEIVED`).
- [ ] Webhook responde 422 para evento de objeto local sem campos/referência: o Asaas reenvia e pode pausar a fila depois de falhas repetidas; definir monitoramento/alerta para `asaas_webhook_unprocessable_marketplace_event`.
- [ ] Marcas antigas do marketplace na tabela compartilhada `processed_webhook_events` que coincidam com um `payment.id` do SaaS ainda bloqueiam a renovação dessa cobrança; levantar e reconciliar em produção com autorização (a 0086 só impede colisões novas).
- [x] `dispatchWithdrawalToProvider` lê o saque pela RPC estreita `get_marketplace_withdrawal_dispatch_context` (`0088`, local; `service_role` continua sem SELECT em `amount_cents`/`payout_account_id`), só despacha saque `pending` e registra toda saída sem envio (`marketplace_withdrawal_dispatch_not_sent`) e a recusa do adapter (`marketplace_withdrawal_dispatch_rejected`), sem reenvio nem mudança de status (Vitest com mocks). Pendente: exceção lançada pelo `fetch` (resultado ambíguo) ainda propaga da server action; não há job de retry nem consulta autoritativa ao Asaas para saques `pending` após recusa/ambiguidade.
- [x] Criação de pedido de refund x correlação do webhook: com duas sessões reais (cenário 11 do harness) o webhook já espera a criação em andamento -- o INSERT do pedido trava o payment em `FOR KEY SHARE` (FK `payment_id`), que conflita com o `FOR UPDATE` da RPC do webhook. Sem RED, sem correção; a serialização é implícita (depende da FK). A criação ainda consulta o replay antes das travas consultivas: duas criações simultâneas da mesma chave podem terminar em violação de unicidade em vez de replay (não reproduzido).
- [x] `create_marketplace_refund_request`: replay por `idempotency_key` restrito à empresa e à reserva do chamador (`0088`, local); chave de outra empresa/reserva levanta `IDEMPOTENCY_KEY_CONFLICT` sem dados (antes devolvia id/status/valores do pedido de outra empresa; pgTAP RED/GREEN).
- [x] `mark_marketplace_refund_processing` (`0088`, local): colunas qualificadas (toda chamada falhava com `column reference "id" is ambiguous`, pgTAP) e id divergente só leva pedido em aberto a `manual_review`; pedido `completed`/`failed` devolve o estado real sem regredir (a regressão foi confirmada só por leitura: o erro de ambiguidade a mascarava). Pendente/decisão: registro durável da anomalia (id divergente em pedido já finalizado) -- hoje só o log da server action.
- [x] Harness de concorrência: limpeza transacional; falha ou qualquer linha restante do run (todos os tipos de fixture, perfil e usuário de auth inclusos) termina com exit 3; cenários do núcleo privilegiado separados do wrapper humano autenticado (JWT local) e da criação pelo wrapper. O caminho de falha da limpeza não foi exercitado.
- [ ] Fechar revisão das mudanças atualmente não commitadas antes de iniciar outra tarefa.
- [ ] Manter o contrato público sincronizado com o código e o ToursFlow.
- [ ] Reavaliar as pendências de confiabilidade já registradas na documentação antes de novas features.

## Futuro, sem compromisso ainda

- [ ] Emissão automática de NFS-e quando houver provedor, requisitos fiscais e decisão de produto.
- [ ] Logo personalizada por empresa.
- [ ] Melhorias de suporte e painel admin conforme a base de clientes crescer.

## Regras

1. Não apagar nem reverter alterações locais existentes sem autorização.
2. Antes de alterar banco, identificar migration, ambiente e impacto de RLS.
3. Antes de deploy, rodar typecheck, lint, build e revisão manual de segurança.
4. Mudanças visuais/funcionais normais passam por branch/preview antes de `main`.
5. Marcar tarefa como concluída somente com evidência no código, teste ou ambiente.
