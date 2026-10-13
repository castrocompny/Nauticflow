# NauticFlow — Memória operacional

## Fonte de verdade

Código, migrations, testes, contrato da API e estado real da infraestrutura têm prioridade. `DOCUMENTACAO.md` é valioso, mas contém histórico extenso e trechos que podem estar desatualizados; não usar sozinho para afirmar o estado atual.

## Decisões duráveis

- Isolamento entre empresas é responsabilidade do banco com RLS, reforçada no servidor.
- Regras críticas de capacidade, vagas, passageiros e agenda devem existir no PostgreSQL.
- O fluxo central é Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto/Voucher.
- ToursFlow é marketplace separado que consome a API pública do NauticFlow.
- Produção e Sandbox do Asaas são ambientes diferentes; não afirmar cobrança real sem confirmar configuração e webhook de produção.
- Migrations devem ser aplicadas/verificadas conscientemente no ambiente correto.
- Mudanças normais devem passar por preview antes de `main`; segurança urgente pode exigir exceção.
- Política do marketplace: ToursFlow é dono; o NauticFlow persiste snapshot imutável na reserva, gravado só no INSERT pela RPC e protegido por trigger + CHECK (migration 0080). A política fica fora do fingerprint de idempotência; replay com política diferente é `409 MARKETPLACE_POLICY_CONFLICT`; reserva sem snapshot nunca recebe um depois do fato.
- Idempotência do marketplace depende de a reserva continuar `source='marketplace'` com a mesma key/fingerprint (índice parcial). Por isso a 0080 congela `source`, `idempotency_key`, `request_fingerprint` e `company_id` dessas reservas e bloqueia DELETE (só cancelamento lógico; exclusão da empresa inteira continua em cascata). Campos operacionais (status, outcome, valores, saída, cliente) seguem editáveis.
- Criação de reserva marketplace é autorizada por marca transacional (GUC local `nauticflow.marketplace_booking_insert` = txid + Idempotency-Key, definida e limpa só pelo núcleo `create_marketplace_booking_internal`) + `current_user` = dono do núcleo. Nova RPC que precise criar reserva marketplace deve passar pelo núcleo, nunca inserir direto.
- Snapshot da política é canônico: a rota apara com `trim()` e conta code points (`Array.from`); o banco exige a mesma forma (mesmo conjunto de whitespace do JS). NUL em qualquer string do corpo é `400`.
- A assinatura antiga de `create_marketplace_booking` (10 parâmetros) continua liberada para `service_role` durante a transição da 0080; revogar só em migration posterior, depois do deploy da rota nova.

## Estado técnico observado

- Repositório: `D:\\Projetos\\Projeto Nauticflow\\Nauticflow`.
- `package.json` confirma Next.js 16.3.x, React 19.1.x, Supabase, TypeScript e Tailwind; README/documentação antiga ainda citam Next 14/React 18 em partes.
- O repositório tinha alterações locais não commitadas durante esta análise: `DOCUMENTACAO.md`, rota de reservas do marketplace, webhook Asaas e duas migrations novas. Não sobrescrever nem interpretar essas mudanças sem revisão do diff.
- A API pública tem contrato próprio em `docs/PUBLIC-API-CONTRACT.md`, incluindo campos, paginação, URLs assinadas, erros e timezone UTC.

## Não registrar

Não salvar tokens, chaves do Asaas/Supabase, senhas, dados pessoais de operadores/clientes ou dumps de produção.
