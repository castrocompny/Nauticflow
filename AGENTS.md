<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Regras do projeto NauticFlow

Antes de alterar código, leia `README.md`, `DOCUMENTACAO.md` quando a área for relevante, `ARCHITECTURE.md`, `TASKS.md` e o contrato em `docs/PUBLIC-API-CONTRACT.md` quando houver integração.

- Código, migrations, testes e infraestrutura atual têm prioridade sobre documentação histórica.
- Não sobrescreva nem reverta alterações locais não commitadas sem autorização explícita.
- Mantenha o isolamento por `company_id` no RLS e no servidor; IDs vindos do cliente precisam ser validados contra a empresa proprietária.
- Regras críticas de capacidade, vagas, passageiros e agenda devem continuar protegidas no PostgreSQL.
- Antes de alterar banco, identifique a migration, o ambiente e o impacto nas políticas RLS.
- Antes de deploy, rode `npx tsc --noEmit`, `npm run lint`, `npm run build` e faça revisão manual de segurança.
- Mudanças visuais ou funcionalidades normais passam por branch/preview antes de `main`; correção de segurança urgente é exceção controlada.
- Não exponha secrets, service-role keys, stack traces ou dados de produção.

## Sincronização automática de contexto

Ao concluir uma tarefa, compare as mudanças com `ARCHITECTURE.md`, `PRD.md`, `DESIGN.md`, `TASKS.md` e `PROJECT_MEMORY.md`.

- Atualize os documentos relevantes no mesmo trabalho quando mudar arquitetura, API, segurança, banco, fluxo do usuário ou decisão de produto.
- Não altere documentação só por uma correção interna sem impacto durável.
- Atualize `docs/PUBLIC-API-CONTRACT.md` junto com qualquer mudança no contrato consumido pelo ToursFlow.
- Registre apenas fatos duráveis e decisões verificadas; não salve tokens, senhas, dados pessoais ou dumps de produção.
- O Claude Code mantém os documentos do repositório, mas não deve ser considerado conectado ao AI Brain do Hermes. A conversa principal do NauticFlow no Hermes deve revisar mudanças importantes e sincronizar somente fatos novos no AI Brain.
