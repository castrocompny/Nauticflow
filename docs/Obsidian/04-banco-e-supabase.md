---
tags:
  - nauticflow
  - banco
  - supabase
updated: 2026-09-19
---
← [[00-INDEX]] · relacionado: [[02-arquitetura]] · [[06-seguranca]] · [[08-integracao-toursflow]] · [[11-decisoes-tecnicas]]

# Banco e Supabase

## Modelo de dados (núcleo operacional)

Tabelas principais: `companies`, `profiles`, `subscriptions`, `plans`, `vessels`, `tours`, `clients`, `partners`, `departures`, `reservations`, `passengers`, `manifests`. Todas isoladas por `company_id` via RLS, exceto `plans` (pública). Fluxo: **Embarcação → Passeio → Saída (departure) → Reserva → Passageiros → Manifesto/Voucher**.

Tabelas do marketplace/financeiro (adicionadas nas fases ToursFlow): `payments`, `marketplace_ledger_entries`, `marketplace_payout_accounts`, `marketplace_refunds`, `marketplace_withdrawals`, `marketplace_fee_config`, `tour_photos`, `tour_schedule_rules`, `tour_flexible_booking_rules`, `marketplace_catalog_state` (singleton), `trial_history`, `trial_identity_secret`, `api_rate_limits`, `admin_audit_log`, `invoices`.

## Regras de negócio garantidas no banco (nunca só no app)

- **`commercial_capacity`** da embarcação = capacidade oficial − tripulação.
- **Capacidade da saída**: `check_departure_capacity()`/`trg_reservation_capacity` — trava a linha da `departure` com `SELECT ... FOR UPDATE` antes de checar vagas, serializando tentativas concorrentes. Conta como ocupado: `confirmada` OU `pendente` com hold ainda válido (`hold_expires_at > now()`, desde a fundação de reservas do marketplace, migration `0042`). Exclui corretamente a própria linha num `UPDATE` (transição `pendente→confirmada` nunca conta duas vezes).
- **Passageiros**: não pode passar do `people_count` da reserva.
- **Janela de horário de saída (08:00–19:00, nunca no passado)**: existiu de 2026-08-10 (`0014_horario_saida_no_banco.sql`) até ser **removida** em 2026-09-12 (migration `0073`, ver [[07-funcionalidades]] "Modelos de reserva") — regra histórica, nunca uma trava de segurança; hoje só "não pode ser no passado" continua.
- **IDOR (dono das referências estrangeiras)**: `reservations`/`passengers` (`0015`), `departures.vessel_id`/`tour_id` (`0019`) — nunca aceita FK de outra empresa, checado por trigger além do app. Ver [[06-seguranca]].
- **`profiles`**: GRANT em nível de coluna, só `name`/`email` são atualizáveis — impede troca de `company_id`/`role` via API direta.
- **Overlap de embarcação**: `check_departure_vessel_overlap()`/`trg_departure_vessel_overlap` (migration `0074`) — nenhuma embarcação pode ter duas saídas com período sobreposto (`[início, fim)`), via `pg_advisory_xact_lock(hashtext('vessel_schedule'), vessel_id)`. `departure_effective_end()` calcula o término real (ends_at → duração do tour → fim do dia civil em Brasília como fallback conservador).
- **Passeio arquivado não recebe reserva de balcão nova**: `TOUR_ARCHIVED` em `create_counter_reservation`/`create_flexible_counter_reservation` (migration `0075`).
- **Reserva privativa (`flexible_private`)**: exclusividade — segunda reserva ativa na mesma `departure` privativa é recusada (migration `0073`).

## Multi-tenancy e autorização

RLS por `company_id = current_company_id()` em toda tabela sensível. `current_company_id()`/`is_super_admin()` são `security definer` com `search_path` fixo. Padrão recorrente descoberto em várias auditorias: **o Supabase concede `EXECUTE`/`INSERT`/`UPDATE`/`DELETE` por padrão, a nível de projeto, para `anon`/`authenticated`/`service_role` em toda função/tabela nova do schema `public`** — um `GRANT` restrito por si só não protege nada sem um `REVOKE ALL ... FROM public, anon, authenticated[, service_role]` explícito antes. Esse achado se repetiu em: `0043` (RPCs do marketplace), `0064` (tabela `tour_schedule_rules`), e é checado explicitamente em toda migration nova desde então. Ver [[06-seguranca]].

## Realtime (Postgres Changes)

Habilitado progressivamente: `vessels`/`clients`/`partners`/`departures`/`reservations` (`0026`, depois `REPLICA IDENTITY FULL` em `0029` — necessário pra RLS conseguir avaliar `UPDATE`/`DELETE`), `tours` (`0038`). Uso mais recente: `marketplace_catalog_state` (`0069`) é o primeiro caso de Realtime aberto pra `anon` puro (sem sessão) — usado pelo ToursFlow pra saber que o catálogo mudou. Ver [[08-integracao-toursflow]] e [[07-funcionalidades]].

## Migrations — resumo por fase

Aplicação: **manual no SQL Editor** originalmente; desde a seção 14 (`npx supabase db push`, CLI como devDependency) quando linkado. Numeração tem gaps históricos conhecidos, não-bloqueantes: `0000b`/`0000c` (bootstrap manual, fora do padrão de nome, puladas pelo CLI) e `0032`/`0033` (renumeradas pra `0039`/`0040` numa revisão pré-deploy — nunca existiram como tais).

### Fundação (0000–0031)
| # | Objetivo |
|---|---|
| 0000 | Schema inicial completo |
| 0000b/0000c | Bootstrap manual da conta do dono (conta que ficou sem empresa) + confirmação manual de e-mail |
| 0001 | Status "pendente" em `reservations` |
| 0002 | Gatilho `handle_new_user`/`on_auth_user_created` — corrige cadastro "pela metade" |
| 0003 | Correções críticas da auditoria pré-lançamento — GRANT restrito de coluna em `profiles`, concorrência |
| 0004 | Limite de embarcações do Start: 1 → 2 |
| 0005 | Registro de aceite de Termos/Privacidade (LGPD) |
| 0006 | Índices de performance (Dashboard/Agenda/Financeiro/Relatórios) |
| 0007 | Billing SaaS — `paid_until`, trial 7 dias, bloqueio de acesso vencido |
| 0008 | Cidade no cadastro |
| 0009 | CNPJ/CPF no cadastro |
| 0010 | Recria gatilho de cadastro que sumiu sozinho em produção |
| 0011 | Trial grátis passa a dar plano Profissional |
| 0012 | Integração Asaas (cobrança recorrente) |
| 0013 | Convidar colaboradores |
| 0014 | Horário de saída (08:00–19:00) validado também no banco — **removida em 0073** |
| 0015 | 🔒 IDOR — valida dono das FKs em `reservations`/`passengers` |
| 0016 | Painel /admin melhorado — suspensão, log de auditoria, RLS cross-empresa |
| 0017 | Controle manual de notas fiscais |
| 0018 | 🔒 Corrige escalação de privilégio crítica no convite (`invited_at`) |
| 0019 | 🔒 IDOR — valida dono das FKs em `departures.vessel_id`/`tour_id` |
| 0020 | Planos anuais (ciclo YEARLY no Asaas) |
| 0021 | Tipo de embarcação "táxi marítimo" |
| 0022 | Dedup de passeios duplicados + índice único parcial |
| 0023–0025 | Correções sucessivas do gatilho de convite (timing de `invited_at`) |
| 0026, 0029 | Realtime operacional + REPLICA IDENTITY FULL |
| 0027–0028 | Diagnóstico temporário do Realtime (removido) |
| 0030 | 🔒 Fecha bypass crítico em `link_asaas_subscription` (virava Premium de graça) |
| 0031 | Bloqueia reaproveitamento infinito do trial por documento |

### Preparação e fundação do marketplace ToursFlow (0034–0048)
| # | Objetivo |
|---|---|
| 0034 | Fotos oficiais do passeio (`tour_photos`, Storage privado) |
| 0035 | `reservations.source` estruturado (manual/operator/website/marketplace/partner/agency) |
| 0036 | Infra de pagamento — só a tabela `payments`, sem integração real |
| 0037 | Idempotência do webhook Asaas (`processed_webhook_events`) |
| 0039 | (renomeada de 0032) `tours` expandido pra cadastro comercial completo |
| 0040 | (renomeada de 0033) Preço oficial por saída (`departures.price_cents`) |
| 0041 | 🔒 Fecha exposição pública legada de implementação anterior removida |
| 0042 | Fundação de reservas do ToursFlow — hold, idempotência, rate limit em Postgres |
| 0043 | 🔒 Fecha EXECUTE de RPC do marketplace exposto por padrão a `anon`/`authenticated` |
| 0044 | Publicação autônoma do operador + suspensão administrativa + validação automática de publicação |
| 0045 | Trial anti-abuso por identidade (CPF/CNPJ **e** e-mail, fingerprint HMAC calculado no banco) |
| 0046–0047 | Hotfix `hmac()` (cast bytea + schema `extensions` qualificado) |
| 0048 | Hotfix de ACL (`content_violation`/authenticated) |

### Hardening de segurança (0049–0051)
| # | Objetivo |
|---|---|
| 0049 | Revoga EXECUTE da RPC legada `bootstrap_company` |
| 0050 | Revoga grants diretos de `api_rate_limits` |
| 0051 | Revoga grants diretos de `payments`/`processed_webhook_events` |

### Financeiro do marketplace (0052–0062) — schema aplicado em produção, pagamentos ainda desligados por flag
| # | Objetivo |
|---|---|
| 0052 | Fase 4A — fundação segura de pagamento (guard de wallet, `create_marketplace_payment_attempt`) |
| 0053 | Fase 4B — ledger financeiro append-only, D+1, saque/reembolso (versão inicial) |
| 0054 | Chave Pix do operador (`marketplace_payout_accounts`), mascaramento, painel financeiro read-only |
| 0055 | Cancelamento/no-show/outcome + motor de reembolso em duas fases |
| 0056 | Saque Pix — adapter Asaas, modo mock/sandbox |
| 0057 | Comissão global do marketplace (10%, snapshot de basis points) |
| 0058 | Operação administrativa oficial pra configurar a comissão (`set_marketplace_global_fee_config`) |
| 0059 | Pix do cliente — cobrança real Asaas, QR Code, webhook, confirmação atômica |
| 0060 | Fechamento — cancelamento de Pix pending após hold expirado, correlação de refund |
| 0061 | Iniciação real de reembolso no provider (fecha gap do ADR 0007) |
| 0062 | Hotfix de rollback em `mark_marketplace_refund_processing` |

**Estado**: todas aplicadas em produção (confirmado seção 99 do DOCUMENTACAO.md, 2026-09-08). Comissão global 10% configurada. **Pagamentos e saques reais permanecem OFF** por flag — ver [[10-flags-e-variaveis]] e [[12-riscos-e-pendencias]].

### Automação de agenda do operador (0063–0068)
| # | Objetivo |
|---|---|
| 0063 | `tour_schedule_rules` — agenda recorrente, geração automática de `departures`, cron de auto-extensão |
| 0064 | 🔒 Hardening de ACL de `tour_schedule_rules` (grants default do projeto reabriam escrita direta) |
| 0065 | 🐛 Fix `42702` — ambiguidade de coluna em `ON CONFLICT (vessel_id, departs_at)`, resolvido referenciando a constraint pelo nome |
| 0066 | 🐛 Fix de fuso — `AT TIME ZONE '-03:00'` (offset numérico, parsing POSIX com sinal invertido) trocado por `'America/Sao_Paulo'` (nome IANA) |
| 0067 | 🐛 Fix `42501` — trigger de política de reembolso sem `SECURITY DEFINER` bloqueava `createTourDraft()` em produção |
| 0068 | 🐛 Fix — as funções LIVE de produção tinham regredido pro corpo original da 0063 (antes de 0065/0066); recriadas com o corpo final correto |

**Nota histórica importante**: 0067 e 0068 corrigiram bugs reais encontrados **em produção**, não em staging — a automação de agenda só foi liberada de fato (seção 119) depois dessas duas correções.

### Funcionalidades recentes (0069–0076)
| # | Objetivo |
|---|---|
| 0069 | `marketplace_catalog_state` (singleton) + triggers — Realtime pra `anon`, catálogo ToursFlow atualiza sem ISR |
| 0070 | `clear_company_departures`/`preview_company_departures_cleanup` — "Excluir todas as saídas" atômico |
| 0071 | Localização de clima da empresa (`companies.weather_latitude/longitude`) |
| 0072 | `create_counter_reservation` — RPC atômica de reserva de balcão + cliente rápido |
| 0073 | Modelos de reserva `fixed_schedule`/`flexible_private`, remoção da janela 08:00–19:00, overlap de embarcação (base) |
| 0074 | Regra canônica de overlap de embarcação (`check_departure_vessel_overlap`) — corrige overbooking real (NF-001) |
| 0075 | Passeio arquivado não recebe reserva de balcão nova (NF2-001) |
| 0076 | Grant faltante em `departure_effective_end` pra `service_role` |

Fonte completa de cada migration (SQL): `supabase/migrations/*.sql` — o cabeçalho comentado de cada arquivo já documenta o objetivo em detalhe.

## Padrões de proteção usados consistentemente

- **Atomicidade**: RPCs `SECURITY DEFINER` fazem tudo numa única transação (nunca múltiplas chamadas PostgREST coordenadas pelo app) — ex.: `save_recurring_schedule`, `create_counter_reservation`, `clear_company_departures`.
- **Concorrência**: `pg_advisory_xact_lock` por `company_id` (saque, refund) ou por `vessel_id` (overlap) quando um simples índice único não basta; `SELECT ... FOR UPDATE` pra capacidade.
- **`company_id`/`role` nunca aceitos como parâmetro** em RPC `authenticated`-scoped — sempre derivados de `auth.uid()` dentro da função.
- **Idempotência** via `idempotency_key` + índice único parcial (nunca só "SELECT antes de INSERT").
- **Snapshot financeiro imutável**: valores de comissão/preço/política de cancelamento gravados uma única vez na confirmação do pagamento, protegidos por trigger de imutabilidade — mudança futura na config nunca afeta venda já confirmada.
