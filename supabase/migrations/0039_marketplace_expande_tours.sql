-- Preparação do NauticFlow para o marketplace ToursFlow (fase 1/7): transforma
-- public.tours no cadastro comercial completo do passeio. 100% aditivo -- nenhuma
-- coluna existente (name, base_price_cents, active, company_id) é alterada ou
-- removida, e nenhuma linha existente perde dado.
--
-- Não confundir com vessels.type (tipo de EMBARCAÇÃO, ex: lancha/escuna): "category"
-- aqui é a categoria da EXPERIÊNCIA vendida (ex: passeio privativo, pôr do sol),
-- um passeio de categoria "por_do_sol" pode usar qualquer tipo de embarcação.
--
-- RENOMEADA de 0032 para 0039 na revisão pré-deploy: uma implementação anterior
-- (removida do repositório a pedido, mas cujas migrations já tinham sido
-- APLICADAS de fato neste banco antes da remoção) já tinha consumido as versões
-- "0032" e "0033" na tabela de controle do Supabase (supabase_migrations.schema_
-- migrations). Reaproveitar esses números faria o `db push` simplesmente PULAR
-- estes arquivos (a versão já consta como aplicada), deixando o app quebrado
-- (selecionando colunas que nunca existiriam). Por isso os números avançam pra
-- depois de 0038, que são os únicos "slots" realmente livres.
--
-- A revisão também encontrou que aquela implementação anterior deixou no banco
-- (mesmo com o arquivo apagado): parte destas mesmas colunas em tours (slug,
-- description, itinerary, duration_minutes, category, destination, price_type,
-- cancellation_policy, marketplace_status), o índice único tours_slug_unique, e
-- os check constraints tours_marketplace_status_check/tours_duration_check
-- (idênticos aos daqui) e tours_price_type_check (DIFERENTE: valores em inglês
-- 'per_person'/'per_group', enquanto o resto do schema é em português). Os
-- ajustes abaixo lidam com cada um desses casos explicitamente -- ver comentários
-- inline. Nenhum dado real foi perdido (só 5 passeios de teste existiam).

alter table public.tours
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists short_description text,
  add column if not exists itinerary text,
  add column if not exists duration_minutes int,
  add column if not exists category text,
  add column if not exists destination text,
  add column if not exists price_type text not null default 'por_pessoa',
  add column if not exists cancellation_policy text,
  add column if not exists important_information text,
  add column if not exists included text,
  add column if not exists not_included text,
  add column if not exists boarding_name text,
  add column if not exists boarding_address text,
  add column if not exists boarding_neighborhood text,
  add column if not exists boarding_city text,
  add column if not exists boarding_state text,
  add column if not exists boarding_zip_code text,
  add column if not exists boarding_reference text,
  add column if not exists boarding_instructions text,
  add column if not exists boarding_latitude numeric(9, 6),
  add column if not exists boarding_longitude numeric(9, 6),
  -- draft: rascunho do operador, nunca visível fora do NauticFlow.
  -- review: operador enviou para aprovação, aguardando o super admin.
  -- published: aprovado, é o único estado que a API pública do item 20 devolve.
  -- paused: já foi publicado, operador tirou de vitrine temporariamente.
  -- rejected: super admin recusou (marketplace_rejection_reason explica o motivo).
  add column if not exists marketplace_status text not null default 'draft',
  add column if not exists published_at timestamptz,
  add column if not exists marketplace_rejection_reason text;

-- price_type: a implementação anterior já tinha criado esta coluna com valores em
-- INGLÊS ('per_person'/'per_group', sem equivalente a "a_partir_de") -- diferente
-- da convenção do resto do schema, sempre em português (status/type sempre
-- 'agendada', 'ativa', 'confirmada' etc).
--
-- CORRIGIDA na 2ª tentativa de deploy: a ordem original era normalizar os dados
-- e SÓ DEPOIS trocar o constraint -- mas o constraint ANTIGO (só aceita 'per_
-- person'/'per_group') ainda estava valendo durante o UPDATE, então gravar
-- 'por_pessoa' já violava ele na hora (erro 23514), antes mesmo de chegar na
-- troca do constraint. Ordem corrigida: solta o constraint antigo PRIMEIRO,
-- normaliza os dados DEPOIS (sem nenhum constraint de price_type valendo nesse
-- meio-tempo), só então cria o novo já validando os dados já corretos.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'tours_price_type_check') then
    alter table public.tours drop constraint tours_price_type_check;
  end if;
end $$;

update public.tours set price_type = 'por_pessoa' where price_type = 'per_person';
update public.tours set price_type = 'por_grupo' where price_type = 'per_group';
alter table public.tours alter column price_type set default 'por_pessoa';

alter table public.tours
  add constraint tours_price_type_check
    check (price_type in ('por_pessoa', 'por_grupo', 'a_partir_de'));

alter table public.tours
  add constraint tours_category_check
    check (category is null or category in (
      'passeio_privativo', 'por_do_sol', 'praias', 'ilhas', 'passeio_compartilhado', 'outro'
    )),
  add constraint tours_boarding_latitude_check
    check (boarding_latitude is null or (boarding_latitude between -90 and 90)),
  add constraint tours_boarding_longitude_check
    check (boarding_longitude is null or (boarding_longitude between -180 and 180));

-- tours_marketplace_status_check e tours_duration_check: a implementação anterior
-- já tinha criado estes dois com definição IDÊNTICA à daqui (mesmos valores
-- permitidos) -- só pula a criação pra não colidir por nome (Postgres não tem
-- "ADD CONSTRAINT IF NOT EXISTS").
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tours_marketplace_status_check') then
    alter table public.tours
      add constraint tours_marketplace_status_check
        check (marketplace_status in ('draft', 'review', 'published', 'paused', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tours_duration_check') then
    alter table public.tours
      add constraint tours_duration_check
        check (duration_minutes is null or duration_minutes > 0);
  end if;
end $$;

-- ============================================================================
-- SLUG — endereço amigável do passeio (ex: /passeios/buzios/passeio-de-lancha).
-- Gerado automaticamente a partir do nome + um sufixo do próprio id, o que já
-- garante unicidade global sem precisar de fila de tentativas (dois operadores
-- podem cadastrar "Passeio de Lancha" que não colidem, pois cada um carrega um
-- sufixo diferente). Uma vez publicado, o slug fica travado: editar o nome do
-- passeio depois de publicado NUNCA muda a URL (trg_tour_slug só recalcula
-- quando o próprio slug vem vazio/nulo, nunca a partir do nome sozinho).
-- ============================================================================

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(
        translate(
          lower(coalesce(input, '')),
          'áàâãäéèêëíìîïóòôõöúùûüçñýÿ',
          'aaaaaeeeeiiiiooooouuuucnyy'
        ),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-+', '-', 'g'
    )
  );
$$;

-- coluna gerada (calculada pelo próprio Postgres, sempre em sincronia com
-- "destination") pra filtrar por destino de forma indexada e sem acento na futura
-- API pública -- ex: GET /api/public/tours?destination=buzios bate direto no
-- índice abaixo, sem precisar carregar todos os passeios publicados e comparar em
-- JavaScript (ver DOCUMENTACAO.md, seção de performance da API pública).
alter table public.tours
  add column if not exists destination_slug text generated always as (public.slugify(destination)) stored;

create index if not exists idx_tours_destination_slug on public.tours (destination_slug);

-- passeios já existentes recebem um slug agora (nunca ficam sem, pra unique
-- constraint abaixo poder ser aplicada em toda a tabela de uma vez)
update public.tours
set slug = public.slugify(name) || '-' || substr(id::text, 1, 6)
where slug is null or btrim(slug) = '';

alter table public.tours alter column slug set not null;

-- tours_slug_unique: a implementação anterior já criou este índice único direto
-- (create unique index, não via "add constraint"), então já existe com este
-- nome exato -- "if not exists" evita a colisão, e como o índice já faz
-- exatamente o que se precisa (unicidade em slug), não precisa recriar nada.
create unique index if not exists tours_slug_unique on public.tours (slug);

create or replace function public.set_tour_slug()
returns trigger
language plpgsql
as $$
declare
  v_base text;
begin
  -- trava: depois de publicado ao menos uma vez, o slug não muda mais (URL estável
  -- pro ToursFlow/SEO). Editar nome/descrição continua livre, só não mexe na URL.
  if tg_op = 'UPDATE' and old.published_at is not null and new.slug is distinct from old.slug then
    raise exception 'Não é possível alterar o endereço (slug) de um passeio que já foi publicado.';
  end if;

  if new.slug is null or btrim(new.slug) = '' then
    v_base := public.slugify(new.name);
    if v_base = '' then
      v_base := 'passeio';
    end if;
    new.slug := v_base || '-' || substr(new.id::text, 1, 6);
  else
    new.slug := public.slugify(new.slug);
  end if;

  return new;
end;
$$;

create trigger trg_tour_slug
  before insert or update of name, slug on public.tours
  for each row execute function public.set_tour_slug();

-- marca published_at na primeira vez que o passeio entra em "published" (não
-- reseta ao pausar/republicar -- published_at é "primeira publicação", não
-- "está publicado agora"; isso também é o que trava o slug acima pra sempre)
create or replace function public.set_tour_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.marketplace_status = 'published' and old.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_tour_published_at
  before update of marketplace_status on public.tours
  for each row execute function public.set_tour_published_at();

-- ============================================================================
-- GUARDA DE TRANSIÇÃO — achado na revisão pré-deploy: a policy de RLS "passeios da
-- empresa" (migration 0000) é `for all using(company_id=current_company_id())`, ou
-- seja, ela autoriza UPDATE em QUALQUER coluna de um passeio da própria empresa,
-- incluindo marketplace_status. Sem esta trava, um operador (company_admin/staff)
-- conseguiria chamar `supabase.from('tours').update({marketplace_status:'published'})`
-- direto pelo navegador e pular a moderação do super admin -- a MESMA classe de falha
-- do bypass crítico de billing já corrigido na migration 0030 (RLS por dono da linha
-- não é RLS por valor de coluna). As Server Actions em src/app/(app)/passeios/actions.ts
-- (submitTourForReview/withdrawTourFromReview/pauseTour/resumeTour) só tentam
-- exatamente estas transições -- o app legítimo nunca é bloqueado por isto.
-- ============================================================================

create or replace function public.check_tour_marketplace_transition()
returns trigger
language plpgsql
as $$
begin
  if new.marketplace_status = old.marketplace_status then
    return new;
  end if;

  -- super admin modera (aprova/recusa/qualquer transição) via /admin/passeios
  if public.is_super_admin() then
    return new;
  end if;

  -- operador comum só pode: enviar pra revisão, retirar da revisão, pausar o que
  -- está publicado, ou reativar o que está pausado. Nunca pular direto pra
  -- "published"/"rejected" por conta própria.
  if (old.marketplace_status in ('draft', 'rejected') and new.marketplace_status = 'review')
     or (old.marketplace_status = 'review' and new.marketplace_status = 'draft')
     or (old.marketplace_status = 'published' and new.marketplace_status = 'paused')
     or (old.marketplace_status = 'paused' and new.marketplace_status = 'published')
  then
    return new;
  end if;

  raise exception 'Transição de status de publicação não permitida para este usuário (% -> %).',
    old.marketplace_status, new.marketplace_status;
end;
$$;

create trigger trg_tour_marketplace_transition_guard
  before update of marketplace_status on public.tours
  for each row execute function public.check_tour_marketplace_transition();

-- ============================================================================
-- ÍNDICES — usados pelos filtros da futura API pública (item 20 do pedido)
-- ============================================================================

create index if not exists idx_tours_marketplace_status on public.tours (marketplace_status);
create index if not exists idx_tours_destination on public.tours (lower(destination));
create index if not exists idx_tours_category on public.tours (category);

-- ============================================================================
-- MODERAÇÃO — o super admin precisa ver/aprovar/recusar passeios de QUALQUER
-- empresa (fila de revisão em /admin/passeios), igual já acontece com vessels e
-- profiles desde a migration 0016. Sem isso, approveTour/rejectTour (que rodam
-- com o client de sessão normal do super admin, não service_role) não enxergam
-- nem conseguem atualizar passeios de outras empresas.
-- ============================================================================

create policy "super admin - ve todos os passeios" on public.tours
  for select to authenticated using (public.is_super_admin());

create policy "super admin - modera passeios" on public.tours
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
