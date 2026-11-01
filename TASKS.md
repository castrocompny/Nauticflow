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
- [ ] Recuperação 2026-10-23 (RECONSTRUÇÃO, worktree isolado): `PAYMENT_RECEIVED` em payment `failed` grava exceção durável sem alterar payment/reserva/ledger/saldo/refund; fila admin somente leitura; pagamento não devolve QR se o ID do provider não foi vinculado; logs de saque. `npm test`: 8 arquivos/109 testes; lint: 0 erros, 4 avisos `<img>`; `tsc --noEmit --incremental false`: passou. PgTAP/pg_prove: 4 arquivos/126 testes no DB efêmero com bootstrap artificial (na chain completa local de 2026-10-26 a suíte da 0081 só passa com `supabase/tests/setup/service_role_platform_grants.sql`, ver ADR 0005); concorrência 0081/cleanup-0082 testada em duas sessões. A migration original 0081 não foi recuperada; esta é reconstruída. Não aplicada no banco do projeto nem em serviço remoto.
- [ ] Reserva durável antes de `POST /payments` (0082, RECONSTRUÍDA): claim local bloqueia retries sem `provider_payment_id`; backfill de legado `pending` sem id foi ensaiado em transação no DB efêmero (`claimed_at` preenchido, claim `blocked`, rollback), mas ainda não há teste versionado pré-migration; pagamentos `pending` sem ID do provider não são cancelados nem liberam o slot; após DELETE no provider, o helper só reporta `cancelled` com confirmação explícita (`was_cancelled=true`) da RPC local; resposta falsa/ausente fica `deferred` ou `failed`, coberta por testes unitários. PgTAP/pg_prove: 21 assertions de claim; corrida claim-vs-cleanup passou. A reconciliação manual ainda não existe; `POST /customers` continua sem proteção equivalente; cobrança adicional após payment já vinculado/settled gera `PROVIDER_PAYMENT_ID_MISMATCH` sem exceção durável; revisar legado, permissões e chain completa antes de qualquer aplicação fora do DB efêmero. Produção não está pronta.
- [ ] Reconciliação do snapshot WIP `cde4f8d`: alterações revisadas e integradas apenas à branch local `main` (sem push/rollout). Foram deixadas de fora rotinas que dependem de migrations 0083–0088 não recuperadas (webhooks de transfer/payment/refund, contexto de saque, ação de resolver exceção); refunds permanecem congelados. `externalReference` e busca vazia não são tratados como prova de ausência/idempotência. Falha definitiva da consulta ao Asaas em `PAYMENT_RECEIVED` também é atualmente logada e respondida com 200, sem fila durável; validar essa política antes de habilitar. Na base `187e8f8`, o handler legado `TRANSFER_*` chamava RPCs 0056 sem correlação atômica entre transfer id e saque; a consulta HTTP reduzia conflitos conhecidos, mas não fechava corrida concorrente. (Histórico: a correção local 0089, ainda não commitada nem publicada, troca isso pela RPC `process_marketplace_transfer_webhook_event` com lock de linha e advisory lock -- ver ADR 0005, atualização de 2026-10-26; corrida entre sessões continua sem teste.) Checkout principal e `.serena/` devem permanecer intactos.
- [ ] Corrigir colunas ambíguas de `mark_marketplace_withdrawal_processing` (0056, confirmado por leitura; a correção local 0089 redefine as duas funções e passou no ensaio pgTAP isolado, mas não está publicada) e auditar `finalize_marketplace_withdrawal` pelo mesmo defeito, só depois de definir a reconciliação autoritativa de saques no Asaas (sem `cancel_unsent`, sem reenvio; `externalReference` não garante unicidade).
- [ ] Captura de conflitos `TRANSFER_*` (0090, LOCAL): migration, pgTAP 63/63 em laboratório novo e regressão concluídos só localmente (commits `84f3422`, `b91d1a8`, `833e53f`; nada publicado). Integração na rota **implementada e testada só localmente, commit LOCAL `184f453`, sem publicação** (2026-10-29; ADR 0005, "Integração da 0090 na rota"): HTTP inalterado (inclusive o 422 por `includes`); captura como segunda RPC só com evidência estruturada (pré-checagem ou `P0001` + mensagem exata), timeout de 3 s só na captura, nunca repetida; identificador de tipo incorreto não é capturado; falha/desconhecido mantém o 422 e pode deixar o conflito sem registro durável. Vitest offline com RPCs simuladas: rota 135/135, suíte 211/211 (rodada histórica); controles complementares só no teste, rota inalterada (espera efetiva da captura e taxa não finita `±1e400`): rota 138/138, suíte 214/214; `tsc` e lint sem erros; build não executado nessas rodadas de teste. Prova local real handler→SDK→PostgREST→PostgreSQL (2026-10-30): PASS para `TERMINAL_OUTCOME_CONFLICT` sem política (recusa, 422) e com política de laboratório (`recorded` 1, depois `repeated` 2), sem efeito financeiro (detalhes em `supabase/tests/README.md`). Build Next.js local separado (2026-11-01, commit `0426a46`, laboratório Linux com saída controlada): BUILD PASS, rota `/api/webhooks/asaas` nos manifestos gerados; não prova HTTP de entrada nem deploy (detalhes em `supabase/tests/README.md`). Prova HTTP mínima (2026-11-01, `next start` sobre o build do `0426a46`): PASS só para HTTP/roteamento até o handler nos ramos não financeiros exercitados (15 casos obrigatórios); não prova a integração conflito→captura, Kong nem produção (detalhes em `supabase/tests/README.md`). Observação fora do escopo: `fee` não finito viraria `p_provider_fee_cents = null` (taxa ausente) na conversão financeira existente -- conclusão estática, não reproduzida nem na prova real, sem ocorrência confirmada, não corrigida; decidir antes de mexer. Antes de publicar: política (`capacity`/`window_seconds`) e quem a grava, ordem de deploy (migration e política antes da rota), prova HTTP completa conflito→captura e do Kong/equivalência de plataforma (HTTP mínimo já aprovado), comportamento de reenvio do Asaas e revisão de segurança; build com PASS local para `0426a46`, a repetir antes do deploy do commit publicado (regra do AGENTS.md). Cobertura adicional não executada (timeout e queda reais, pré-checagem real, capacidade esgotada, demais códigos da 0089): exigência antes de publicar a definir e registrar na avaliação de risco/revisão de segurança -- não dispensa testes que ela exigir nem autoriza publicar. Acompanhamento operacional necessário para produção: responsável, canal, prazo, alerta, tela/resolução e retenção. Futuro: contrato para tipo incorreto, troca do `includes`, 500 recorrente de `INVALID_EVENT_KEY`.
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
