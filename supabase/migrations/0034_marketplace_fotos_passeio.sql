-- Preparação NauticFlow → ToursFlow (fase 3/7): fotos oficiais do passeio.
--
-- Reaproveita tours (não cria uma segunda entidade de "produto"). Uma linha por
-- foto, com capa e ordem -- o mesmo padrão de "tabela filha com position" já
-- existe implicitamente em passengers/reservations (1 reserva -> N passageiros).
--
-- CORRIGIDA na revisão pré-deploy: a implementação anterior (removida do
-- repositório, mas já aplicada de fato neste banco antes da remoção -- ver nota
-- na migration 0039) já tinha criado a tabela `tour_photos` com o MESMO desenho
-- (mesmas colunas, mesmos índices, inclusive o mesmo nome
-- "tour_photos_one_cover_per_tour"), então os comandos abaixo viraram
-- idempotentes (IF NOT EXISTS) em vez de recriar do zero. A tabela está VAZIA (0
-- linhas) -- nenhum dado real em jogo.
--
-- MAIS IMPORTANTE: essa mesma implementação anterior tinha criado uma policy de
-- RLS liberando `anon` (visitante sem login) pra ler fotos de passeios publicados
-- DIRETO da tabela (e uma policy equivalente no Storage, liberando o download do
-- arquivo em si) -- ou seja, contornando por completo a API pública com DTO
-- explícito (item 20) que este projeto decidiu construir. Isso é removido nesta
-- mesma migration (ver seção final).

create table if not exists public.tour_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  tour_id uuid not null references public.tours (id) on delete cascade,
  storage_path text not null,
  is_cover boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tour_photos_company_id_idx on public.tour_photos (company_id);
create index if not exists tour_photos_tour_id_idx on public.tour_photos (tour_id);
-- no máximo uma foto de capa por passeio (índice único parcial, mesmo padrão de
-- tours_company_active_name_unique na migration 0022) -- a implementação anterior
-- já tinha criado este índice com este nome exato, daí o "if not exists"
create unique index if not exists tour_photos_one_cover_per_tour on public.tour_photos (tour_id) where is_cover;

alter table public.tour_photos enable row level security;

-- a implementação anterior já tinha uma policy equivalente ("fotos de passeio da
-- empresa", no singular) fazendo exatamente isto -- não recria pra não duplicar
-- policies idênticas na mesma tabela.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tour_photos'
      and policyname in ('fotos de passeio da empresa', 'fotos de passeios da empresa')
  ) then
    create policy "fotos de passeios da empresa" on public.tour_photos
      for all to authenticated
      using (company_id = public.current_company_id())
      with check (company_id = public.current_company_id());
  end if;
end $$;

grant select, insert, update, delete on public.tour_photos to authenticated;

-- mesma defesa em profundidade contra IDOR cross-tenant já usada em
-- check_reservation_fk_company/check_departure_fk_company (migrations 0015/0019):
-- confere no banco que o tour_id apontado pertence à MESMA empresa da foto, mesmo
-- que a checagem na Server Action já faça isso -- nunca confiar só na camada de cima.
create or replace function public.check_tour_photo_fk_company()
returns trigger
language plpgsql
as $$
declare
  v_tour_company uuid;
begin
  select company_id into v_tour_company from public.tours where id = new.tour_id;
  if v_tour_company is null or v_tour_company <> new.company_id then
    raise exception 'Passeio não pertence à empresa informada.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tour_photo_fk_company on public.tour_photos;
create trigger trg_tour_photo_fk_company
  before insert or update of tour_id, company_id on public.tour_photos
  for each row execute function public.check_tour_photo_fk_company();

-- ============================================================================
-- STORAGE — bucket privado (a implementação anterior já criou o bucket
-- "tour-photos" com public=false, e uma policy "tour photos - acesso da empresa"
-- equivalente à combinação das 4 policies abaixo -- por isso os comandos de bucket
-- e das 4 policies de empresa viraram idempotentes/condicionais).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tour-photos', 'tour-photos', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('tour photos - acesso da empresa', 'tour_photos_select_own_company')
  ) then
    create policy "tour_photos_select_own_company" on storage.objects
      for select to authenticated
      using (bucket_id = 'tour-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);
    create policy "tour_photos_insert_own_company" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'tour-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);
    create policy "tour_photos_update_own_company" on storage.objects
      for update to authenticated
      using (bucket_id = 'tour-photos' and (storage.foldername(name))[1] = public.current_company_id()::text)
      with check (bucket_id = 'tour-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);
    create policy "tour_photos_delete_own_company" on storage.objects
      for delete to authenticated
      using (bucket_id = 'tour-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);
  end if;
end $$;

-- ============================================================================
-- ACHADO CRÍTICO DA REVISÃO PRÉ-DEPLOY: a implementação anterior tinha deixado
-- LIGADA a leitura pública (para `anon`, sem login) de fotos de passeios
-- publicados -- tanto na tabela quanto no arquivo em si no Storage:
--
--   policy "fotos de passeios publicados - leitura publica" em public.tour_photos
--   policy "fotos de passeio publicado - leitura anonima" em storage.objects
--
-- Isso ignora por completo a API pública com DTO explícito (item 20 do pedido) e
-- a URL assinada de curta duração que ela usa -- qualquer pessoa na internet
-- conseguiria montar a URL de download do arquivo puro do Storage assim que
-- QUALQUER passeio virasse "published" (nenhum está hoje, mas o gatilho está
-- pronto pra disparar assim que o super admin aprovar o primeiro). Removido
-- abaixo -- consistente com a decisão já documentada de manter o bucket
-- inteiramente privado nesta fase e servir fotos só via signed URL sob demanda.
-- ============================================================================

drop policy if exists "fotos de passeios publicados - leitura publica" on public.tour_photos;
drop policy if exists "fotos de passeio publicado - leitura anonima" on storage.objects;
