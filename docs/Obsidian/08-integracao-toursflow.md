---
tags:
  - nauticflow
  - toursflow
  - marketplace
  - integracao
updated: 2026-09-19
---
← [[00-INDEX]]

# Integração NauticFlow ↔ ToursFlow

## 1. Papéis (nunca misturar)

| | NauticFlow | ToursFlow |
|---|---|---|
| O que é | SaaS de gestão operacional (este repositório) | Marketplace público B2C (`toursflow.com.br`, repositório separado) |
| Fonte de verdade | Catálogo, disponibilidade, reservas, capacidade, regras críticas de negócio | Descoberta/vitrine pro turista, futura venda/pagamento |
| Escreve nas tabelas operacionais? | Sim (é o dono) | **Nunca diretamente** — só via API server-to-server autenticada |

Toda integração passa por API HTTP autenticada (leitura pública sem auth + escrita server-to-server com segredo compartilhado). O ToursFlow nunca tem acesso direto ao Postgres do NauticFlow.

## 2. API pública somente-leitura (`/api/public/*`)

Contrato formal em [`../PUBLIC-API-CONTRACT.md`](../PUBLIC-API-CONTRACT.md) (gerado por inspeção de código + chamadas reais em produção, datado de 2026-08-26 — **desatualizado num ponto**: não documenta `availableSpots`, adicionado depois pela seção 133, ver abaixo). Sem autenticação (GET público de verdade), base `https://nauticflow.com.br/api/public/`.

- `GET /tours` — lista paginada (máx. 50/página), filtros `destination`/`category`. Nunca expõe `id`, `company_id`, CNPJ ou dado interno — payload sempre montado campo a campo.
- `GET /tours/[slug]` — detalhe completo. 404 idêntico para slug inexistente ou não publicado (nunca revela qual caso).
- `GET /tours/[slug]/departures` — saídas futuras, não canceladas, já precificadas. Expõe `id` (único endpoint que expõe um uuid de verdade), `soldOut` (boolean) e, desde a seção 133 (2026-09-12), **`availableSpots`** (`max(capacity - booked, 0)`) — `soldOut` passou a ser derivado de `availableSpots <= 0`, nunca mais uma segunda regra separada. **Capacidade real da embarcação nunca é exposta**, só o resultado já subtraído.
- `GET /destinations` / `GET /categories` — filtros de UI.
- Fotos: signed URLs já prontas (`tour-photos`, bucket privado), TTL de 1h.
- Erros: sempre JSON genérico, nunca stack trace.

## 3. Fluxo de publicação do passeio

`draft` → `published` diretamente pelo próprio operador (aprovação manual do super_admin foi **removida** — decisão de produto, seção 67) → `published → draft` (despublicar) sempre livre. `review`/`rejected` continuam válidos no schema (compatibilidade), fora do fluxo novo. Super_admin mantém um mecanismo de **suspensão administrativa** separado (`marketplace_suspended_at`, overlay que tira da vitrine sem mexer na intenção do operador) via `/admin/passeios`.

**Validação automática antes de publicar** (`validate_tour_for_publishing()`, seção 68) — fonte única de verdade em SQL, chamada em 3 lugares (checklist na UI, Server Action, e dentro do próprio trigger de transição — garantia real contra bypass, mesmo via API direta do Supabase): título/descrição/destino/categoria/duração/local de embarque completos, ≥1 foto aprovada + capa aprovada, resolução mínima 800×600 (quando conhecida), não suspenso, sem contato externo/link/telefone/WhatsApp/PIX no texto público (regex determinístico, nunca IA). Edição de passeio já publicado passa pela mesma checagem (trigger `trg_tour_content_while_published`) — bloqueia a alteração inválida, nunca despublica silenciosamente.

Visibilidade pública completa exige: `tour.active=true AND marketplace_status='published' AND marketplace_suspended_at IS NULL AND company.suspended_at IS NULL`.

## 4. Moderação de imagem

Ver [[10-flags-e-variaveis]] para `IMAGE_MODERATION_MODE`. Dois modos, nunca inferidos pela ausência de chave:
- **`manual`** (padrão do lançamento inicial, seção 71): upload nasce `manual_approved` direto, sem chamar rede nenhuma. Super_admin monitora/suspende via `/admin/passeios` se necessário.
- **`openai`** (opcional, seção 69/70): upload nasce `pending`, chamada real a `POST https://api.openai.com/v1/moderations` (modelo `omni-moderation-latest`). `flagged=false→approved`, `flagged=true→rejected`. Qualquer falha técnica (sem chave, timeout, erro de rede) → `moderation_unavailable`, **nunca aprova por fallback**. Testado uma vez contra a API real (seção 70) — recebeu `429` por billing/quota da conta OpenAI, não por bug; o fail-closed funcionou como projetado.

Fotos antigas (`legacy_approved`) e as aprovadas manualmente nunca são remoderadas automaticamente — decisão de produto explícita, evita custo/mudança de catálogo inesperada.

## 5. Reservas — hold, idempotência, preço seguro

Rota `POST /api/marketplace/bookings` — server-to-server (nunca o navegador do turista), fora de `/api/public/*` de propósito. Ver [[04-banco-e-supabase]] para o schema (`hold_expires_at`, `idempotency_key`, `check_departure_capacity`). Resumo do fluxo de negócio:
- Hold de 15 minutos; vaga conta como ocupada enquanto `confirmada` OU (`pendente` com hold válido).
- Preço **sempre** calculado no servidor a partir de `departures.price_cents` — nunca aceito do request.
- `create_marketplace_booking()` (RPC atômica): cliente + reserva nascem numa única transação, nunca cria cliente órfão em corrida de retry.
- Autenticação: `Authorization: Bearer <TOURSFLOW_API_SECRET>` (timing-safe) + `X-ToursFlow-Client-Key` (HMAC do IP do visitante, calculado no **servidor do ToursFlow** — o NauticFlow nunca recebe IP em claro). Ver [[10-flags-e-variaveis]].
- Reserva vinda do marketplace é a **mesma** `reservations` que o operador já usa — nenhuma tabela paralela.
- E2E real ToursFlow→NauticFlow validado com sucesso em produção (seção 66).

## 6. Financeiro do marketplace — processo de negócio

(Schema completo em [[04-banco-e-supabase]].) Fluxo desenhado: ToursFlow cria booking/hold → solicita payment → NauticFlow cria/recupera customer Asaas próprio do turista (nunca o mesmo customer da assinatura SaaS do operador) → cobrança PIX real → QR Code → cliente paga → webhook Asaas → liquida payment (revalida capacidade atomicamente antes de confirmar — nunca overbooking, nunca dinheiro do cliente perdido) → confirma reserva → comissão 10% plataforma / 90% operador (snapshot congelado na confirmação, nunca retroativo) → retenção D+1 (24h após `service_at_snapshot`, imutável) → saldo `available` → saque via chave Pix (nunca dado bancário, sempre `unverified` nesta fase) → reembolso em duas fases (pedido interno reserva o efeito no ledger → confirmação real no provider fecha).

Decisões de arquitetura completas: [`../adr/0001-hold-expirado-vs-pagamento-confirmado.md`](../adr/0001-hold-expirado-vs-pagamento-confirmado.md) até [`../adr/0009-booking-models-fixed-flexible.md`](../adr/0009-booking-models-fixed-flexible.md) — resumo na seção 10 abaixo.

## 7. Gates de ativação financeira (processo formal, cauteloso)

Antes de qualquer dinheiro real se mover, o projeto passou por uma sequência de gates explícitos, cada um só avançando com autorização própria:

| Gate | Objetivo | Resultado |
|---|---|---|
| A (seção 90) | Preflight — revisão de toda a cadeia SQL 0052-0060, ACLs, variáveis de ambiente | Infraestrutura pronta, nada ativado |
| A.1 (seção 91-92) | Validar autenticação real contra Asaas **Sandbox** | Falhou na 1ª tentativa (credencial inválida); passou na 2ª com credencial nova — customer/cobrança PIX/QR Code/cleanup testados de ponta a ponta no Sandbox |
| B.1 (seção 93) | Aplicar migrations 0052-0060 em produção + mesclar em `main` | Concluído — banco e código ativos em produção |
| B.2A (seção 94) | Rotacionar `SUPABASE_SERVICE_ROLE_KEY` exposto + auditar credenciais/webhook Asaas produção | Concluído — API Key produção habilitada, permissão de saque habilitada, webhook configurado com 14 eventos |
| B.2B (seção 95-96) | Validar produção sem dinheiro real; decidir sobre habilitar pagamentos | **Pausado deliberadamente** pelo usuário — camada Bearer ToursFlow↔NauticFlow validada, mas `X-ToursFlow-Client-Key` e auth real contra Asaas Produção ainda pendentes |

## 8. ⚠️ Estado atual de ativação (crítico — leia antes de propor qualquer trabalho de marketplace)

**O marketplace está totalmente construído (schema completo 0052-0062 aplicado em produção, ledger, comissão 10% configurada via `set_marketplace_global_fee_config`, webhook Asaas de produção configurado com os 14 eventos corretos, camada de autenticação Bearer ToursFlow↔NauticFlow validada por comportamento HTTP real) mas SEM NENHUM PAGAMENTO REAL ATIVO.**

Confirmado pela última vez na seção 99 do `DOCUMENTACAO.md` (2026-09-08) e reafirmado na seção 147 (2026-09-15, texto da landing): `MARKETPLACE_PAYMENTS_ENABLED` e `MARKETPLACE_WITHDRAWAL_PAYOUT_ENABLED` permanecem **OFF/ausentes em todos os ambientes, inclusive Production**. `TOURSFLOW_API_SECRET` **está** configurado em Production (confirmado por comportamento HTTP real na seção 96, corrigindo uma afirmação anterior incorreta de que estaria ausente).

Do lado do ToursFlow: o botão "Confirmar reserva" da interface pública continua **inativo** por uma flag própria dele, `BOOKING_CHECKOUT_ENABLED` (hoje `false`, ADR-013 do repositório do ToursFlow) — decisão de prontidão comercial, não limitação técnica. Um turista real hoje só vê "Reserva online chega em breve... fale com o operador".

Todas as tabelas financeiras (`marketplace_ledger_entries`, `payments` pix, `marketplace_withdrawals`, `marketplace_refunds`) tinham **0 linhas** na última confirmação por leitura direta do banco de produção (seção 96). R$ 0,00 movimentado até a última seção lida.

`NÃO CONFIRMADO` para qualquer estado além de 2026-09-15 (seção 147) — antes de assumir que os pagamentos continuam desligados, confira se existe seção mais recente no `DOCUMENTACAO.md` que atualize isso, e cruze com [[12-riscos-e-pendencias]].

## 9. Realtime do catálogo (NauticFlow → ToursFlow)

Tabela singleton `marketplace_catalog_state` (migration `0069`, seção 120) + triggers que incrementam sua `version` quando um passeio publicado muda (campos públicos) ou quando suas fotos mudam. `anon`/`authenticated` só têm `SELECT` — primeiro uso de Postgres Changes para `anon` puro neste projeto (Realtime Broadcast privado foi descartado por exigir JWT de sessão, que o visitante do ToursFlow nunca tem). Elimina o atraso de até 5 minutos de ISR entre publicar/editar no NauticFlow e o ToursFlow refletir — uma aba do ToursFlow já aberta recebe o empurrão e roda `router.refresh()`. Prova real de entrega de evento a um cliente `anon` sem sessão foi feita via script Node/WebSocket. **Não cobre** mudanças em `tours.active`/`marketplace_suspended_at`/`company.suspended_at` (fora do escopo pedido) — nesses casos raros, só a próxima navegação/F5 reflete (a garantia de "nunca servir catálogo velho" em requisição nova não depende deste mecanismo, é garantida do lado ToursFlow por `no-store`).

## 10. ADRs (decisões de arquitetura completas)

| ADR | Título | Resumo |
|---|---|---|
| [0001](../adr/0001-hold-expirado-vs-pagamento-confirmado.md) | Hold expirado vs. pagamento confirmado | Iniciar pagamento com hold vencido → recusa (`HOLD_EXPIRED`). Confirmação de pagamento chegando com hold vencido (Fase 4C) → revalida capacidade atomicamente, nunca confirma cegamente (overbooking é pior que perder uma venda). Adendo: no máximo uma tentativa de pagamento ativa (`pending`/`paid`) por reserva, via unique index. |
| [0002](../adr/0002-marketplace-ledger-payout-refund.md) | Ledger, D+1, saque e reembolso | Rejeita Split Asaas imediato (repassaria dinheiro antes do serviço acontecer). Ledger = eventos semânticos com `bucket` explícito, append-only de verdade. D+1 baseado em `service_at_snapshot` imutável, nunca em `departs_at` ao vivo (mutável, vetor de manipulação). |
| [0003](../adr/0003-marketplace-payout-destination-and-release-policy.md) | Destino de saque (chave Pix) | Chave Pix nunca credencial bancária. Validar formato ≠ validar titularidade — toda conta nasce `unverified`. |
| [0004](../adr/0004-marketplace-cancellation-no-show-refund-policy.md) | Cancelamento/no-show/outcome | `reservations.outcome` não duplica `status`. Mudar um outcome já definido exige `super_admin`. Motor de reembolso em duas fases (pedido interno → confirmação real). |
| [0005](../adr/0005-marketplace-withdrawal-and-pix-payout.md) | Saque e payout Pix | `asaas_wallet_id` era do modelo Split rejeitado (0002) — destino real é `marketplace_payout_accounts`. `verification_status` separado de `status` (corrente/substituída). |
| [0006](../adr/0006-marketplace-global-commission.md) | Comissão global (10%) | 1000 basis points, inteiro (nunca float). Vale só para novas confirmações, nunca retroativo — snapshot congelado por venda. |
| [0007](../adr/0007-marketplace-pix-payment-settlement.md) | Cobrança Pix, QR Code, liquidação | `clients.asaas_customer_id` (turista) nunca confundido com `companies.asaas_customer_id` (operador/SaaS). Deduplicação de customer/cobrança por `externalReference`. |
| [0008](../adr/0008-operator-schedule-automation.md) | Automação de agenda | `tour_schedule_rules` é só uma camada de automação — `departures` continua a única unidade vendável, indistinguível de uma criada manualmente. |
| [0009](../adr/0009-booking-models-fixed-flexible.md) | Modelos de reserva | `category`/`price_type`/`booking_model` são ortogonais, nunca inferidos um do outro. `fixed_schedule` (default) vs. `flexible_private`. |

## 11. Ver também

[[12-riscos-e-pendencias]] para o estado de risco agregado (ativação financeira, TTL de flags, migrations não reconciliadas no histórico do CLI). [[13-roadmap]] para o que falta antes do primeiro Pix real. [[07-funcionalidades]] para a experiência do operador nas telas de Passeios/Financeiro. [[06-seguranca]] para hardening de segurança do marketplace (IDOR, ACL de RPCs, rate limiting).
