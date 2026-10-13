---
tags:
  - nauticflow
  - funcionalidades
updated: 2026-09-19
---
← [[00-INDEX]] · relacionado: [[04-banco-e-supabase]] · [[08-integracao-toursflow]] · [[02-arquitetura]]

# Funcionalidades

## Módulos (área autenticada `(app)`)

| Módulo | Rota | O que faz |
|---|---|---|
| Dashboard | `/dashboard` | Central de **operação de hoje**: condições do vento + agenda de passeios dos próximos 7 dias (faixa compacta + lista do dia). Ver "Dashboard" abaixo. |
| Reservas | `/reservas` | Reserva de balcão em cascata Cliente→Passeio→Data→Horário; listagem com badge de origem (Balcão/ToursFlow/Parceiro) |
| Agenda | `/agenda` | Visão de calendário das saídas programadas |
| Saídas | `/saidas` | Cadastro de saída avulsa, geração automática via agenda recorrente, "Excluir todas as saídas" |
| Clientes | `/clientes` | Cadastro e histórico |
| Embarcações | `/embarcacoes` | Cadastro por tipo, capacidade oficial e comercial |
| Parceiros | `/parceiros` | Canais de venda, rastreio de origem |
| Passeios | `/passeios` | Catálogo comercial: dados, agenda/disponibilidade, fotos, publicação no marketplace |
| Financeiro | `/financeiro` | Receita da assinatura + saldo/recebimento do marketplace ToursFlow |
| Relatórios | `/relatorios` | Analítico: receita, ocupação, ranking de embarcações/passeios, origem das reservas (absorveu o que saiu do Dashboard) |
| Equipe | `/equipe` | Convite de colaboradores, papéis |
| Configurações | `/configuracoes` | Dados da empresa, localização de clima, alertas de reserva, zona de perigo (excluir conta/empresa) |
| Planos | `/planos` | Ver/trocar/cancelar plano SaaS, cobrança mensal/anual |
| Admin (super_admin) | `/admin` | Painel cross-empresa: métricas, empresas, notas fiscais, moderação de passeios |

## Dashboard — evolução (seções 10, 126-130 do DOCUMENTACAO.md)

Passou por várias iterações até a forma atual: começou com KPIs + gráficos + rankings + "Agenda de hoje" (2026-08-10) → cresceu muito (9 consultas em paralelo) → **simplificado** (2026-09-12): a parte analítica/financeira foi movida inteiramente pra `/relatorios`; Dashboard virou **1 única consulta** trazendo uma janela de 7 dias, mostrando:
1. Saudação
2. **Condições do vento** (`WindConditionsCard`) — vento atual, rajadas, direção, previsão ~6h, sem nenhuma classificação de segurança ("seguro/perigoso" nunca aparece — decisão explícita, a decisão de navegar é sempre do comandante)
3. **Agenda de passeios** — faixa compacta de 7 dias (hoje + 6 seguintes) + lista vertical do dia selecionado, cada saída mostrando horário, passeio, embarcação, ocupação (`OccupancyBar`) e vento associado por horário mais próximo (nunca interpolado, nunca chamada extra ao provider por saída — reaproveita a mesma janela de previsão já buscada uma vez por render)

## Condições do vento (`src/lib/weather/`)

Provider isolado (Open-Meteo, `WEATHER_API_BASE_URL`/`WEATHER_API_KEY` opcionais — ver [[10-flags-e-variaveis]]), cache em memória por processo (TTL 5min, não distribuído entre instâncias serverless). Localização configurada por empresa (`companies.weather_latitude/longitude`, `/configuracoes`) — sem ela, o card pede pra configurar, nunca usa geolocalização do navegador. Deliberadamente **só informativo**, sem threshold de segurança configurável (fica para etapa futura).

## Reservas

- **Reserva de balcão** (`create_counter_reservation`, migration `0072`): fluxo em cascata Cliente (buscar existente ou criar rápido) → Passeio → Data → Horário → Pessoas → Valor (auto-calculado por `price_type`, com override manual) → Origem opcional. Nasce `status='confirmada'`, `source='manual'`, sem hold — consome a mesma capacidade compartilhada com o marketplace.
- **Reserva privativa flexível** (`create_flexible_counter_reservation`, migration `0073`): fluxo Cliente→Passeio→Data→Início→Término→Pessoas→Valor; a saída nasce na hora da reserva (nunca escolhe uma existente); protegida contra overlap de embarcação.
- **Origem da reserva** (`reservations.source`): `manual` (balcão), `marketplace` (ToursFlow), `partner` (reservado, não usado ainda), `website`/`operator`/`agency` (existem no schema, sem produtor de código ainda hoje).
- **Alerta de nova reserva** (seções 138-140): toast + som (Web Audio API, gerado por código) + notificação do navegador (opt-in) quando uma reserva `marketplace`/`partner` chega via Realtime — reserva `manual` (balcão) nunca alerta. Coordenação entre múltiplas abas via `BroadcastChannel` (só uma toca o som). Configurável em `/configuracoes` (staff não tem acesso a essa tela — limitação conhecida).

## Modelos de reserva (`tours.booking_model`, migration `0073`)

- **`fixed_schedule`** (default): horário fixo, agenda recorrente ou saídas avulsas, capacidade compartilhada entre várias reservas.
- **`flexible_private`**: passeio privativo, disponibilidade configurável (dias/janela/duração min-max), exclusivo (uma reserva ativa por saída), **nunca publicável no marketplace** (bloqueado em `validate_tour_for_publishing` + filtro independente nas 3 rotas públicas).

Removida a janela global de horário comercial (08:00–19:00) que existia desde 2026-08-10 — regra de negócio, não de segurança, incompatível com um passeio às 05:30 ou 22:00.

## Automação de agenda (`tour_schedule_rules`, migrations 0063-0068)

Operador configura uma regra recorrente (dias da semana, horários, horizonte 30/60/90 dias, overrides de preço/capacidade) na própria página do passeio — a RPC gera as `departures` automaticamente. Editar/pausar a regra **nunca apaga saída com reserva** (protegida), mas fecha pra venda nova (`marketplace_sales_enabled=false`) quando deixa de bater com a regra atual. Cron diário (`/api/cron/extend-schedules`, `CRON_SECRET`) estende o horizonte automaticamente. "Datas específicas" continua existindo em paralelo, sem regra recorrente.

Fluxo simplificado no `/passeios/[id]`: **Configure a agenda** é o primeiro bloco da página (embarcação + preço-base + dias + horários, 1 passo), gera 90 dias de saídas automaticamente; "Adicionar saída avulsa" em `/saidas` virou ação secundária.

## Publicação de passeio (marketplace)

`draft → published` é **autônomo do operador** (não precisa de aprovação manual do super_admin — decisão de produto revertida em 2026-08-27, seção 67). Antes de publicar, `validate_tour_for_publishing()` roda no banco (fonte única de verdade, chamada também dentro do próprio gatilho — nunca contornável) verificando: título, descrições, destino, categoria, duração, tipo de preço, local de embarque, pelo menos 1 foto aprovada com capa definida, ausência de contato externo/link no texto (regex determinística, nunca "IA"), agenda futura vendável. `super_admin` pode suspender administrativamente (`marketplace_suspended_at`, overlay que não mexe em `marketplace_status`) via `/admin/passeios`. Excluir passeio = arquivar (`active=false`), nunca hard delete — reservas/histórico preservados.

## Moderação de fotos

`IMAGE_MODERATION_MODE` (ver [[10-flags-e-variaveis]]): `manual` (padrão do lançamento — libera direto, super_admin monitora) ou `openai` (OpenAI Moderation API real, fail-closed em qualquer erro/timeout/ausência de chave — nunca aprova por fallback).

## Equipe e papéis

Ver [[05-autenticacao-e-autorizacao]] pro detalhe de auth. `staff` só vê operacional; `company_admin` tudo; convite via Edge Function própria (Resend), não mais o e-mail nativo do Supabase.

## Financeiro

- **SaaS**: receita da assinatura, ver [[09-planos-e-precos]].
- **Marketplace**: card "Recebimento" com 4 saldos (bloqueado/disponível/em saque/sacado) + chave Pix mascarada + formulário de cadastro/troca. Sem botão de saque na UI ainda (decisão de simplicidade — a RPC existe, a superfície não foi exposta). Ver [[08-integracao-toursflow]].

## Notas fiscais

Registro manual de controle (não emite nota real — sem certificado digital/provedor de NFS-e configurado). Super_admin registra número/valor/PDF/data em `/admin/[id]`; a empresa vê só leitura em `/configuracoes`.

## Painel Super Admin (`/admin`)

Métricas (total empresas, MRR normalizado por ciclo, pagando/trial/vencidas/suspensas), busca+paginação, ordenação por urgência, alerta "vence em breve", detalhe de empresa (`/admin/[id]`: uso vs. limite do plano, histórico de assinaturas, trocar plano, suspender/reativar, excluir definitivamente, notas fiscais), gráficos (novas empresas/mês, funil, distribuição por plano), 2FA/TOTP obrigatório (ver [[05-autenticacao-e-autorizacao]]), log de auditoria (`admin_audit_log`). Não implementado ainda: impersonar empresa, exportar CSV, indicador de risco de churn — baixa prioridade, base de clientes pequena.

## Landing pública (`/`)

Redesenhada em 2026-09-14/15 (seção 141+) em torno do posicionamento "plataforma de automação": hero com vídeo real de demonstração (gravação real do app + reconstrução fiel do ToursFlow, nunca dados de produção reais), seção "Ecossistema" explicando a relação com o ToursFlow (com separação clara do que está ativo vs. "em breve"), stepper interativo do fluxo de venda, abas de modelo de reserva, demonstração de capacidade, simulação de alerta. Preços com clareza matemática mensal/anual (ver [[09-planos-e-precos]]). Sem depoimentos falsos (removidos de propósito). Crédito institucional da Castro Compny no rodapé.

## Realtime nas telas operacionais

`RealtimeRefresh` (Postgres Changes + `router.refresh()` com debounce) em Clientes, Embarcações, Parceiros, Saídas, Agenda, Reservas, Passeios — múltiplos colaboradores veem mudanças um do outro sem reload.
