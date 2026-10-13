---
tags:
  - nauticflow
  - planos
  - precos
  - billing
updated: 2026-09-19
---
← [[00-INDEX]]

# Planos e Preços

Fonte real confirmada no código: `src/components/marketing/plans.ts` (`MKT_PLANS`), consumida pela landing pública. Comentário no próprio arquivo: *"Valores literais conforme a tabela oficial — nao estimar nem arredondar. Anual = 10x o mensal (2 meses gratis)."*

## Tabela oficial (confirmada no código, 2026-09-19)

| Plano | Mensal | Anual | Economia/ano | % economia | Embarcações | Usuários | Destaque |
|---|---|---|---|---|---|---|---|
| Start | R$147 | R$1.470 | R$294 | 16,67% (exibido como 17%) | até 2 | 1 | — |
| Profissional | R$297 | R$2.970 | R$594 | 16,67% (exibido como 17%) | até 10 | 5 | "Mais popular" (`featured: true`) |
| Premium | R$597 | R$5.970 | R$1.194 | 16,67% (exibido como 17%) | ilimitadas | ilimitados | — |

**Estes valores batem exatamente com os "historicamente conhecidos"** (Start R$147/mês·R$1.470/ano, Profissional R$297/mês·R$2.970/ano, Premium R$597/mês·R$5.970/ano, ~16,67% de economia anual) — confirmados por leitura direta de `plans.ts`, não presumidos.

### Fórmula (verificada seção 146 do `DOCUMENTACAO.md`, 2026-09-15)

- Anual = 10× o mensal (equivalente a "2 meses grátis").
- Economia = (mensal × 12) − anual.
- % economia exata = economia ÷ (mensal × 12) = 16,67% em todo plano (exibido arredondado para 17%, nunca os valores em R$).
- Equivalente mensal no ciclo anual = anual ÷ 12 (Start R$122,50 · Profissional R$247,50 · Premium R$497,50).

| Plano | Mensal ×12 | Anual | Equiv./mês | Economia | Desconto |
|---|---|---|---|---|---|
| Start | R$1.764 | R$1.470 | R$122,50 | R$294 | 17% |
| Profissional | R$3.564 | R$2.970 | R$247,50 | R$594 | 17% |
| Premium | R$7.164 | R$5.970 | R$497,50 | R$1.194 | 17% |

A landing (`src/components/marketing/pricing.tsx`) calcula tudo isso **em runtime** a partir de `price`/`priceYear` (as duas âncoras reais em `plans.ts`) — nunca um número reescrito à mão. No modo Mensal, o preço grande é o mensal de verdade + nudge pro anual. No modo Anual, o preço grande vira o equivalente mensal, com o total anual real sempre visível abaixo ("R$1.470 cobrados por ano") — o botão "Assinar" sempre mostra o valor total que será cobrado agora, nunca o equivalente mensal escondendo o total.

## Features por plano (do código)

- **Start**: agenda e controle de saídas, reservas com voucher automático, manifesto de embarque, cadastro de clientes/parceiros, dashboard de receita/ocupação.
- **Profissional**: tudo do Start + até 10 embarcações, 5 usuários com controle de acesso, ranking de desempenho/parceiros, suporte prioritário.
- **Premium**: tudo do Profissional + embarcações/usuários ilimitados, controle de acesso avançado, suporte prioritário.

## Cobrança

Via Asaas. Ciclo mensal → `cycle: "MONTHLY"` (sem trava de permanência, confirmado em `src/app/(app)/billing-actions.ts`). Ciclo anual → `cycle: "YEARLY"`, cobrança **integral, uma vez por ano** (não parcelado). Trial: **7 dias grátis no plano Profissional** para todo cadastro novo, com anti-abuso por identidade (CPF/CNPJ + e-mail) — ver [[05-autenticacao-e-autorizacao]] para o mecanismo. Ambiente Asaas real em uso hoje (billing SaaS): confira [[03-stack-e-infraestrutura]]/[[12-riscos-e-pendencias]] para o estado sandbox-vs-produção — **não é o mesmo escopo** das flags de pagamento do marketplace ToursFlow (ver [[08-integracao-toursflow]]).

## Contato comercial (público, não é secret)

`MKT_CONTACT` em `plans.ts`: WhatsApp `(65) 99240-7699` (`https://wa.me/5565992407699`), e-mail `castrocompny@gmail.com`.

## Ver também

[[07-funcionalidades]] para a tela `/planos` (cancelamento, troca de plano, ciclo). [[10-flags-e-variaveis]] para as variáveis `ASAAS_*`. Este preço é da **assinatura SaaS do NauticFlow** — não confundir com a comissão de 10% do marketplace ToursFlow, ver [[08-integracao-toursflow]].
