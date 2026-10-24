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
- [ ] Recuperação 2026-10-23 (RECONSTRUÇÃO, worktree isolado): `PAYMENT_RECEIVED` em payment `failed` grava exceção durável sem alterar payment/reserva/ledger/saldo/refund; fila admin somente leitura; pagamento não devolve QR se o ID do provider não foi vinculado; logs de saque. `npm test`: 8 arquivos/109 testes; lint: 0 erros, 4 avisos `<img>`; `tsc --noEmit --incremental false`: passou. PgTAP/pg_prove: 4 arquivos/126 testes no DB efêmero; concorrência 0081/cleanup-0082 testada em duas sessões. A migration original 0081 não foi recuperada; esta é reconstruída. Não aplicada no banco do projeto nem em serviço remoto.
- [ ] Reserva durável antes de `POST /payments` (0082, RECONSTRUÍDA): claim local bloqueia retries sem `provider_payment_id`; backfill de legado `pending` sem id foi ensaiado em transação no DB efêmero (`claimed_at` preenchido, claim `blocked`, rollback), mas ainda não há teste versionado pré-migration; pagamentos `pending` sem ID do provider não são cancelados nem liberam o slot; após DELETE no provider, o helper só reporta `cancelled` com confirmação explícita (`was_cancelled=true`) da RPC local; resposta falsa/ausente fica `deferred` ou `failed`, coberta por testes unitários. PgTAP/pg_prove: 21 assertions de claim; corrida claim-vs-cleanup passou. A reconciliação manual ainda não existe; `POST /customers` continua sem proteção equivalente; cobrança adicional após payment já vinculado/settled gera `PROVIDER_PAYMENT_ID_MISMATCH` sem exceção durável; revisar legado, permissões e chain completa antes de qualquer aplicação fora do DB efêmero. Produção não está pronta.
- [ ] Reconciliação do snapshot WIP `cde4f8d`: alterações revisadas e integradas apenas à branch local `main` (sem push/rollout). Foram deixadas de fora rotinas que dependem de migrations 0083–0088 não recuperadas (webhooks de transfer/payment/refund, contexto de saque, ação de resolver exceção); refunds permanecem congelados. `externalReference` e busca vazia não são tratados como prova de ausência/idempotência. Falha definitiva da consulta ao Asaas em `PAYMENT_RECEIVED` também é atualmente logada e respondida com 200, sem fila durável; validar essa política antes de habilitar. O handler legado `TRANSFER_*` ainda chama RPCs 0056 sem correlação atômica entre transfer id e saque; a consulta HTTP reduz conflitos conhecidos, mas não fecha corrida concorrente — exige constraint/RPC e teste antes de qualquer habilitação. Checkout principal e `.serena/` devem permanecer intactos.
- [ ] Corrigir colunas ambíguas de `mark_marketplace_withdrawal_processing` (0056, confirmado por leitura) e auditar `finalize_marketplace_withdrawal` pelo mesmo defeito, só depois de definir a reconciliação autoritativa de saques no Asaas (sem `cancel_unsent`, sem reenvio; `externalReference` não garante unicidade).
- [ ] Fila de exceções de pagamento: decidir se haverá ação de encerramento (hoje nenhuma) e paginação por cursor; refunds seguem congelados.
- [ ] Recuperar integralmente as migrations 0083–0088 e testes correspondentes antes de qualquer alteração/validação do fluxo de saques, transfers ou refunds.
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
