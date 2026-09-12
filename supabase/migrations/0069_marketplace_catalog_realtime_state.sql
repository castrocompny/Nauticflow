-- ============================================================================
-- SEGUNDA TENTATIVA de "aba já aberta do ToursFlow atualiza sozinha" -- a
-- primeira ideia (Supabase Realtime Broadcast, canal privado com policy de
-- Authorization pra `anon`) foi descartada ANTES de implementar: Broadcast
-- `private: true` exige cliente autenticado (JWT de sessão), e o visitante
-- público do ToursFlow nunca tem sessão nenhuma no Supabase do NauticFlow --
-- é sempre `anon` puro. Sem prova de que isso funcionaria de ponta a ponta
-- pra um cliente `anon`, a decisão foi trocar pra uma tabela mínima +
-- Postgres Changes (mecanismo que o projeto já usa em produção desde 0026/
-- 0038 pra `vessels`/`clients`/`partners`/`departures`/`reservations`/
-- `tours` -- só que aqueles casos são sempre pra `authenticated` com RLS por
-- empresa; este é o primeiro caso pra `anon` puro, com RLS deliberadamente
-- mínima).
--
-- `public.marketplace_catalog_state` -- SÓ um contador de versão + timestamp,
-- SINGLETON (uma linha só, forçado por `id boolean primary key default true
-- check (id)` -- padrão clássico do Postgres pra "no máximo 1 linha", sem
-- precisar de trigger extra nem de checar contagem em toda escrita).
-- NENHUM dado de passeio/operador/cliente/pagamento passa por aqui -- é
-- estruturalmente impossível vazar informação sensível por essa tabela,
-- porque ela não guarda informação nenhuma além de um número que sobe.
-- ============================================================================

create table public.marketplace_catalog_state (
  id boolean primary key default true check (id),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.marketplace_catalog_state (id, version) values (true, 0);

alter table public.marketplace_catalog_state enable row level security;

-- Achado já documentado várias vezes neste projeto (0043/0064/0067/etc.):
-- Supabase concede privilégio de tabela por padrão em tabela nova,
-- independente de qualquer GRANT explícito no arquivo -- revoga TUDO
-- primeiro, então concede só o que deve sobrar.
revoke all on public.marketplace_catalog_state from anon, authenticated, public;
grant select on public.marketplace_catalog_state to anon, authenticated;

-- SÓ leitura, pra QUALQUER um (inclusive anon puro, sem sessão -- é
-- exatamente o visitante público do ToursFlow). Nenhuma policy de INSERT/
-- UPDATE/DELETE é criada -- combinado com o REVOKE acima, escrita nesta
-- tabela só é possível pela função SECURITY DEFINER abaixo, nunca por um
-- cliente direto (nem autenticado, nem admin via client normal).
create policy "estado do catalogo -- leitura publica" on public.marketplace_catalog_state
  for select to anon, authenticated
  using (true);

-- ============================================================================
-- BUMP TRANSACIONAL -- preferência explícita do usuário: incrementar a
-- versão de dentro do próprio banco (trigger), nunca depender de lembrar de
-- chamar isso manualmente em cada Server Action do NauticFlow. Uma função
-- central, SECURITY DEFINER, chamada pelos triggers abaixo -- nunca
-- executável diretamente por ninguém além do dono/triggers do mesmo dono.
-- ============================================================================
create or replace function public.bump_marketplace_catalog_version()
returns void
language sql
security definer
set search_path = public
as $$
  update public.marketplace_catalog_state
    set version = version + 1, updated_at = now()
    where id = true;
$$;

revoke all on function public.bump_marketplace_catalog_version() from public, anon, authenticated, service_role;

-- ============================================================================
-- TRIGGER em public.tours -- decide EXATAMENTE quais mudanças incrementam a
-- versão, espelhando por completo a regra de visibilidade real da API
-- pública (GET /api/public/tours, src/app/api/public/tours/route.ts):
-- marketplace_status='published' AND active=true AND marketplace_suspended_
-- at IS NULL AND a empresa dona não está suspensa.
--
-- Eventos que INCREMENTAM (pedido explícito):
--   (a) draft -> published (ou qualquer outra transição PRA 'published');
--   (b) published -> draft (ou qualquer transição SAINDO de 'published');
--   (c) edição de conteúdo público-relevante enquanto o passeio já está
--       'published' (sem mudar o status em si).
--
-- Eventos que NÃO incrementam (pedido explícito):
--   - edição de rascunho nunca publicado (marketplace_status permanece algo
--     diferente de 'published' o tempo todo da transação);
--   - qualquer coluna interna sem reflexo na API pública (ex.:
--     marketplace_rejection_reason, marketplace_refund_policy -- motor de
--     reembolso, nunca exposto na vitrine).
--
-- LIMITAÇÃO REGISTRADA, de propósito fora do escopo pedido (não expandido
-- silenciosamente): a visibilidade pública também pode mudar por `active`
-- (embarcação/passeio desativado), `marketplace_suspended_at` (suspensão
-- administrativa) ou `companies.suspended_at` (empresa suspensa) -- nenhum
-- dos três está coberto por este trigger. Uma aba aberta do ToursFlow não
-- atualiza sozinha nesses três casos (raros, sempre via ação de super_admin
-- ou desativação manual da embarcação/passeio) -- ela ainda mostra o dado
-- certo na PRÓXIMA navegação/F5 (Etapa 1, no-store, já garante isso
-- incondicionalmente), só não dispara o "empurrão" automático de Realtime
-- pra esses três casos específicos.
-- ============================================================================
create or replace function public.bump_marketplace_catalog_on_tour_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- transição de/para 'published' -- o que importa é ENTRAR ou SAIR desse
  -- estado, não o valor exato de old/new (ex.: published -> paused também
  -- precisa avisar o ToursFlow, exatamente como published -> draft).
  if new.marketplace_status is distinct from old.marketplace_status
     and (old.marketplace_status = 'published' or new.marketplace_status = 'published') then
    perform public.bump_marketplace_catalog_version();
    return new;
  end if;

  -- edição de conteúdo público-relevante COM o passeio já publicado (sem
  -- mudar o status em si) -- lista de colunas espelha 1:1 o que
  -- NauticFlowTourListItemDTO/NauticFlowTourDetailDTO (ToursFlow, src/data/
  -- sources/nauticflow-source.ts) realmente consome.
  if new.marketplace_status = 'published' and (
    new.name is distinct from old.name or
    new.slug is distinct from old.slug or
    new.short_description is distinct from old.short_description or
    new.description is distinct from old.description or
    new.destination is distinct from old.destination or
    new.category is distinct from old.category or
    new.duration_minutes is distinct from old.duration_minutes or
    new.price_type is distinct from old.price_type or
    new.base_price_cents is distinct from old.base_price_cents or
    new.itinerary is distinct from old.itinerary or
    new.cancellation_policy is distinct from old.cancellation_policy or
    new.important_information is distinct from old.important_information or
    new.included is distinct from old.included or
    new.not_included is distinct from old.not_included or
    new.boarding_name is distinct from old.boarding_name or
    new.boarding_address is distinct from old.boarding_address or
    new.boarding_neighborhood is distinct from old.boarding_neighborhood or
    new.boarding_city is distinct from old.boarding_city or
    new.boarding_state is distinct from old.boarding_state or
    new.boarding_zip_code is distinct from old.boarding_zip_code or
    new.boarding_reference is distinct from old.boarding_reference or
    new.boarding_instructions is distinct from old.boarding_instructions or
    new.boarding_latitude is distinct from old.boarding_latitude or
    new.boarding_longitude is distinct from old.boarding_longitude
  ) then
    perform public.bump_marketplace_catalog_version();
  end if;

  return new;
end;
$$;

revoke all on function public.bump_marketplace_catalog_on_tour_change() from public, anon, authenticated, service_role;

create trigger trg_bump_marketplace_catalog_on_tour_change
  after update on public.tours
  for each row execute function public.bump_marketplace_catalog_on_tour_change();

-- ============================================================================
-- TRIGGER em public.tour_photos -- "mudança de foto/capa que afete passeio
-- published" (pedido explícito). A API pública só expõe fotos com
-- moderation_status aprovado (approved/legacy_approved/manual_approved) e só
-- a capa (is_cover=true) na listagem -- qualquer INSERT/UPDATE/DELETE que
-- mexa em is_cover/moderation_status/storage_path/position É, por
-- definição, potencialmente visível na vitrine, SE o passeio dono já está
-- published. Cobre as 3 operações (insert de foto nova, update de
-- capa/moderação/posição, delete de foto) com um único trigger AFTER pra
-- cada uma.
-- ============================================================================
create or replace function public.bump_marketplace_catalog_on_tour_photo_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tour_id uuid;
  v_status text;
begin
  v_tour_id := coalesce(new.tour_id, old.tour_id);
  select marketplace_status into v_status from public.tours where id = v_tour_id;

  if v_status = 'published' then
    perform public.bump_marketplace_catalog_version();
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.bump_marketplace_catalog_on_tour_photo_change() from public, anon, authenticated, service_role;

create trigger trg_bump_marketplace_catalog_on_tour_photo_change
  after insert or update or delete on public.tour_photos
  for each row execute function public.bump_marketplace_catalog_on_tour_photo_change();

-- ============================================================================
-- REALTIME -- entra na mesma publication já usada desde 0026/0038, e ganha
-- REPLICA IDENTITY FULL igual a todas as outras tabelas com Realtime deste
-- projeto (mesmo padrão, ver 0029/0038) -- não estritamente necessário pra
-- este caso (a policy de SELECT já é `using (true)`, sem depender da linha
-- antiga pra decidir visibilidade), mas mantém a tabela consistente com o
-- resto do projeto e remove qualquer dúvida sobre o payload do evento vir
-- completo.
-- ============================================================================
alter publication supabase_realtime add table public.marketplace_catalog_state;
alter table public.marketplace_catalog_state replica identity full;
