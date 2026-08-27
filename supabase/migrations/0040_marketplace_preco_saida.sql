-- Preparação NauticFlow → ToursFlow (fase 2/7): preço oficial da saída.
--
-- RENOMEADA de 0033 para 0040 na revisão pré-deploy (mesmo motivo da migration
-- 0039: a versão "0033" já constava como aplicada na tabela de controle do
-- Supabase, de uma implementação anterior removida do repositório -- ver nota
-- completa em 0039). Conteúdo desta migration em si não mudou: departures.
-- price_cents/price_type foram checados na revisão e confirmados como
-- genuinamente inexistentes hoje em produção -- nenhum ajuste de conteúdo
-- necessário, só o número do arquivo.
--
-- Decisão de arquitetura (confirmada contra o schema existente antes de implementar):
-- tours.base_price_cents (migration 0000) já existia como preço-base/fallback do
-- passeio -- mantido como está, sem nenhuma alteração. O que faltava era o preço
-- efetivamente vendável de CADA saída, que pode variar por data (alta/baixa
-- temporada, dia de semana etc.). Como capacity/status já vivem em departures (e
-- não em tours), preço por saída segue o mesmo padrão já estabelecido na tabela.
--
-- Aditivo e nullable de propósito: saídas antigas continuam funcionando exatamente
-- como antes (o fluxo de reservas em src/app/(app)/reservas/actions.ts não lê nem
-- grava estas colunas -- total_cents continua sendo digitado à mão na reserva, sem
-- mudança nenhuma de comportamento). price_cents/price_type só passam a ser
-- exigidos no momento em que o operador tentar enviar o PASSEIO pra revisão do
-- marketplace (checado em código, não em constraint de banco, pra não travar saídas
-- operacionais comuns que nunca vão pro ToursFlow).
alter table public.departures
  add column if not exists price_cents int,
  add column if not exists price_type text;

alter table public.departures
  add constraint departures_price_cents_check check (price_cents is null or price_cents >= 0),
  add constraint departures_price_type_check check (price_type is null or price_type in ('por_pessoa', 'por_grupo', 'a_partir_de'));

comment on column public.departures.price_cents is
  'Preço oficial desta saída específica em centavos. NULL = ainda não precificada para o marketplace (o passeio não pode ser publicado enquanto houver saídas futuras sem preço). Nunca decidido pelo frontend do ToursFlow -- fonte de verdade é sempre esta coluna.';
comment on column public.departures.price_type is
  'Tipo de preço desta saída. NULL = herda tours.price_type (o passeio-pai) -- resolução de fallback é responsabilidade de quem lê (API pública/painel), não do banco.';

create index if not exists idx_departures_departs_at_status on public.departures (departs_at, status);
