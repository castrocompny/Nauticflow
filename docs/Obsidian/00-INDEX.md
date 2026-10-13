---
tags:
  - nauticflow
  - index
updated: 2026-09-19
---
# NauticFlow — Memória técnica (Obsidian)

Este vault é a **memória técnica oficial e persistente** do NauticFlow. Ele consolida `DOCUMENTACAO.md` (log narrativo de sessões, 147 seções até 2026-09-15), `README.md`, `AGENTS.md`, `supabase/migrations/`, `docs/adr/` e o código-fonte real, numa camada organizada por tema em vez de cronológica.

**Se você é uma sessão futura do Claude Code (ou humano) chegando aqui pela primeira vez**: leia [[00-estado-atual]] primeiro (2 minutos, resume o que está pronto/em produção/desligado por flag/pendente), depois [[01-visao-geral]]. `DOCUMENTACAO.md`, na raiz do repo, continua sendo a fonte narrativa completa e detalhada de cada decisão — este vault não a substitui, a organiza.

## Comece por aqui

- [[00-estado-atual]] — o que está pronto, em produção, desligado por flag, ou pendente. **Leia antes de propor qualquer trabalho novo.**
- [[01-visao-geral]] — o que é o NauticFlow, problema que resolve, papel no ecossistema "...Flow".

## Produto e arquitetura

- [[02-arquitetura]] — camadas, fluxo de dados, trust boundaries, diagramas.
- [[03-stack-e-infraestrutura]] — framework/linguagem/banco/deploy/observabilidade, histórico de hospedagem, divergência Next 14→16.
- [[07-funcionalidades]] — cada módulo/tela (Dashboard, Reservas, Agenda, Saídas, Clientes, Embarcações, Parceiros, Passeios, Financeiro, Relatórios, Equipe, `/admin`, Landing) e seu estado atual.
- [[14-arquivos-importantes]] — arquivos/pastas essenciais e a responsabilidade de cada um.

## Dados e segurança

- [[04-banco-e-supabase]] — tabelas, RLS, multi-tenancy, triggers de negócio, Realtime, e resumo das 77 migrations.
- [[05-autenticacao-e-autorizacao]] — cadastro, bootstrap via gatilho, papéis, convite de equipe, 2FA.
- [[06-seguranca]] — hardening consolidado: IDOR corrigido, CVEs, rate limiting, headers, incidentes reais e como foram fechados.
- [[10-flags-e-variaveis]] — toda env var (nome + função, nunca valor) e as 3 flags não documentadas do marketplace.

## Marketplace e comercial

- [[08-integracao-toursflow]] — fronteira NauticFlow↔ToursFlow, API pública, publicação, moderação, financeiro do marketplace, gates de ativação, **estado atual crítico de pagamentos**, resumo das 9 ADRs.
- [[09-planos-e-precos]] — planos Start/Profissional/Premium, valores confirmados no código, trial.

## Governança do conhecimento

- [[11-decisoes-tecnicas]] — decisões de produto/arquitetura não-triviais, log com status (ativa/superseded).
- [[12-riscos-e-pendencias]] — tudo em aberto hoje, por categoria, com fonte.
- [[13-roadmap]] — próximos passos concretos em checklist, sem nada inventado.
- [[15-historico-e-changelog]] — mapa de navegação pelas 147 seções de `DOCUMENTACAO.md`, agrupado por período.

## Convenções deste vault

- **`NÃO CONFIRMADO`** (literal, maiúsculo) marca qualquer afirmação que não pôde ser verificada na fonte disponível nesta rodada — nunca chutado. Se você confirmar depois, atualize a nota e remova a marca.
- **Divergência código vs. documentação**: quando o código atual e um texto antigo discordam, as duas versões ficam registradas lado a lado (evidência do código + o que a doc antiga dizia) — nunca "corrigida" silenciosamente. Lista consolidada em [[00-estado-atual]].
- **Nenhum segredo é escrito aqui** — nomes de variáveis de ambiente e sua função, nunca valores, tokens, chaves ou senhas.
- **Histórico nunca é apagado**: decisões substituídas são marcadas "superseded"/"histórica" e apontam pra decisão atual, não são removidas.
- Links internos usam `[[wikilinks]]` pelo nome do arquivo sem `.md`. Links pra fora do vault (ADRs, `PUBLIC-API-CONTRACT.md`, migrations) usam caminho relativo Markdown normal.

## Manter esta memória atualizada (parte da Definition of Done)

Sempre que houver mudança técnica relevante no NauticFlow:
1. Ler a documentação relevante deste vault primeiro (evita repetir auditoria/investigação já feita — em especial [[06-seguranca]] e [[08-integracao-toursflow]] seção 8).
2. Implementar a mudança.
3. Atualizar a(s) nota(s) correspondente(s) aqui — não só `DOCUMENTACAO.md`.
4. Registrar nova decisão em [[11-decisoes-tecnicas]] se for o caso.
5. Registrar risco/pendência nova em [[12-riscos-e-pendencias]] ou [[13-roadmap]] se for o caso.
6. Manter [[00-estado-atual]] sincronizado — é a nota mais lida por sessões futuras.

Documentar faz parte de terminar a tarefa, não uma etapa opcional depois.
