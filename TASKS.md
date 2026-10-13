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
