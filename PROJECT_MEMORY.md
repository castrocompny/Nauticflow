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

## Estado técnico observado

- Repositório: `D:\\Projetos\\Projeto Nauticflow\\Nauticflow`.
- `package.json` confirma Next.js 16.3.x, React 19.1.x, Supabase, TypeScript e Tailwind; README/documentação antiga ainda citam Next 14/React 18 em partes.
- O repositório tinha alterações locais não commitadas durante esta análise: `DOCUMENTACAO.md`, rota de reservas do marketplace, webhook Asaas e duas migrations novas. Não sobrescrever nem interpretar essas mudanças sem revisão do diff.
- A API pública tem contrato próprio em `docs/PUBLIC-API-CONTRACT.md`, incluindo campos, paginação, URLs assinadas, erros e timezone UTC.

## Não registrar

Não salvar tokens, chaves do Asaas/Supabase, senhas, dados pessoais de operadores/clientes ou dumps de produção.
