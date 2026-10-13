---
tags:
  - nauticflow
  - visao-geral
updated: 2026-09-19
---
← [[00-INDEX]]

# Visão geral

NauticFlow é um SaaS de gestão para operadores de turismo náutico (escunas, lanchas, catamarãs, táxis marítimos — ex: Búzios, Arraial do Cabo, Cabo Frio), vendido por assinatura mensal em 3 planos. Cada empresa cadastrada é um tenant isolado via RLS no Supabase. Ver [[09-planos-e-precos]] pros valores reais.

## Problema que resolve

Operadores administravam reservas em cadernos, planilhas e WhatsApp:
- Overbooking — sem controle único de vagas por saída
- Manifesto de embarque montado à mão, minutos antes da partida
- Nenhuma visibilidade de ocupação pra decidir se vale abrir nova saída
- Comissão de parceiro calculada de memória, sem rastreio
- Histórico de clientes disperso entre atendentes

## Fluxo central

```
Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto/Voucher
```

Detalhe de cada entidade e regras de negócio em [[04-banco-e-supabase]] e [[07-funcionalidades]].

## Papel no ecossistema "...Flow"

NauticFlow é o **sistema operacional do operador** (gestão interna: agenda, reservas, financeiro, equipe). Existe um segundo produto, **ToursFlow**, que é o **marketplace público** onde o turista descobre e reserva passeios. O NauticFlow expõe uma API server-to-server pro ToursFlow consumir catálogo e criar reservas — nunca o inverso (ToursFlow não escreve direto nas tabelas operacionais do NauticFlow fora dessa API). Fronteira de responsabilidade completa, endpoints, autenticação e estado de ativação em [[08-integracao-toursflow]].

## Status atual

Ver [[00-estado-atual]] pro resumo mais recente do que está pronto/em produção/pendente. Em linhas gerais (README + DOCUMENTACAO.md): em desenvolvimento ativo, deploy contínuo na Vercel, produção em `nauticflow.com.br`, em preparação para lançamento comercial junto a operadores da Região dos Lagos (RJ). Cobrança dos planos SaaS (Asaas) já validada de ponta a ponta em Sandbox — ver [[12-riscos-e-pendencias]] pro estado da troca pra produção. Marketplace ToursFlow com schema/backend financeiro completo aplicado em produção, mas pagamentos reais ainda desligados por flag — ver [[08-integracao-toursflow]] e [[12-riscos-e-pendencias]].

## Fonte de verdade

Este vault consolida `DOCUMENTACAO.md` (log de sessões de trabalho, 147 seções até 2026-09-15), `README.md`, `AGENTS.md`, migrations em `supabase/migrations/`, ADRs em `docs/adr/` e o código-fonte. Onde há divergência entre código atual e texto antigo, este vault registra as duas versões — ver [[00-INDEX]] pra convenção de `NÃO CONFIRMADO`.
