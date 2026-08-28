-- Publicação autônoma do operador + suspensão administrativa separada.
--
-- DECISÃO DE PRODUTO (definitiva, não inventada aqui): a aprovação obrigatória
-- do super admin antes de publicar (migration 0039) deixa de existir. O
-- operador publica/despublica o próprio passeio diretamente. O super admin
-- mantém poder de MODERAÇÃO -- suspender um passeio já publicado -- via um
-- conceito NOVO e SEPARADO de marketplace_status, pra nunca confundir
-- "intenção do operador" (published/draft) com "decisão administrativa"
-- (suspenso ou não). Mesma razão de existir de companies.suspended_at
-- (migration 0016), agora também no nível do passeio.
--
-- 100% aditivo: marketplace_status continua com os mesmos 5 valores
-- (draft/review/published/paused/rejected) -- nenhuma linha existente é
-- alterada. 'review'/'rejected'/'paused' seguem válidos no schema por
-- compatibilidade com dados antigos (nunca removidos do CHECK constraint),
-- mas o novo fluxo do operador não passa mais por eles -- um passeio nesses
-- estados legados simplesmente não aparece publicamente (marketplace_status
-- <> 'published'), exatamente como já acontecia antes.
--
-- NÃO editar as migrations 0039/0042/0043 -- as duas funções abaixo são
-- CREATE OR REPLACE de funções já existentes, o mesmo padrão já usado nas
-- migrations 0042/0043 pra evoluir uma função sem tocar no arquivo antigo.
-- Isso preserva o OID da função (e portanto o GRANT/REVOKE já aplicado em
-- create_marketplace_booking pela 0043 -- REPLACE nunca reseta ACL sozinho).

alter table public.tours
  add column if not exists marketplace_suspended_at timestamptz,
  add column if not exists marketplace_suspended_by uuid references public.profiles (id) on delete set null,
  add column if not exists marketplace_suspension_reason text;

comment on column public.tours.marketplace_suspended_at is
  'Suspensão administrativa do passeio (só super_admin pode setar/limpar -- ver trigger trg_tour_suspension_guard). Separado de marketplace_status de propósito: o operador continua "querendo" o passeio publicado (marketplace_status não muda quando suspenso), mas ele some da vitrine enquanto isto estiver preenchido. NULL = sem suspensão.';
comment on column public.tours.marketplace_suspended_by is
  'Profile do super_admin que aplicou a suspensão -- só histórico/auditoria, nada depende deste valor pra decidir visibilidade.';
comment on column public.tours.marketplace_suspension_reason is
  'Motivo da suspensão, visível só ao operador (no próprio painel) e ao super_admin -- nunca exposto em nenhuma rota pública.';

-- ============================================================================
-- GUARDA: só super_admin escreve nos 3 campos de suspensão. Não dá pra fazer
-- isso por GRANT de coluna (o jeito Postgres "nativo" de restringir campo, já
-- usado em profiles na migration 0003) porque operador e super_admin são o
-- MESMO role de banco (`authenticated`) -- a distinção é de dado de aplicação
-- (profiles.role), então precisa ser um trigger com is_super_admin(), igual
-- já se faz pra marketplace_status (check_tour_marketplace_transition, 0039).
-- ============================================================================

create or replace function public.check_tour_suspension_guard()
returns trigger
language plpgsql
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Somente o super admin pode alterar a suspensão administrativa deste passeio.';
  end if;
  return new;
end;
$$;

create trigger trg_tour_suspension_guard
  before update of marketplace_suspended_at, marketplace_suspended_by, marketplace_suspension_reason on public.tours
  for each row execute function public.check_tour_suspension_guard();

-- ============================================================================
-- VALIDAÇÃO AUTOMÁTICA DE PUBLICAÇÃO — decisão de arquitetura: fonte única de
-- verdade em SQL (não duplicada em TypeScript). A rota/Server Action chama a
-- MESMA função abaixo (via RPC) só pra mostrar o checklist bonito na UI
-- ANTES do operador tentar publicar; o gatilho de transição (mais abaixo)
-- chama exatamente a mesma função de novo como a garantia real contra bypass
-- -- ninguém publica passeio inválido nem chamando a API do Supabase direto,
-- porque a regra vive no banco, não na Server Action.
-- ============================================================================

-- --------------------------------------------------------------------------
-- FOTOS: estado de moderação + metadata de resolução (aditivo em tour_photos)
--
-- ORDEM DELIBERADA (evita marcar foto antiga como 'pending' por acidente):
--   1. coluna nasce NULLABLE, sem default ainda;
--   2. TUDO que já existe agora vira 'legacy_approved' explicitamente;
--   3. só DEPOIS o default passa a ser 'pending' (novos uploads a partir daqui);
--   4. só então NOT NULL + CHECK.
-- Se a ordem fosse invertida (default 'pending' antes do backfill), qualquer
-- linha tocada por outro processo no meio do caminho correria risco de nascer
-- 'pending' por engano -- inofensivo aqui (é uma migration, roda numa
-- transação), mas é o motivo de seguir esta ordem específica de qualquer forma.
-- --------------------------------------------------------------------------
-- moderation_status: 'approved'/'rejected'/'moderation_unavailable' agora são
-- gravados de verdade por um provider real (OpenAI Moderation API, ver
-- src/lib/image-moderation.ts) -- não é mais arquitetura vazia. width/height:
-- capturados no NAVEGADOR no momento do upload (grátis, o arquivo já está em
-- memória lá) -- decisão explícita de NÃO baixar/reprocessar imagens no
-- servidor a cada publicação só pra medir resolução (custaria caro e
-- escalaria mal; a moderação em si já baixa a foto uma vez, ver módulo).
-- NULL nas duas colunas pra fotos antigas (sem essa captura ainda existir) --
-- tratado como "não dá pra checar resolução", nunca como erro.
alter table public.tour_photos
  add column if not exists moderation_status text,
  add column if not exists moderation_provider text,
  add column if not exists moderation_checked_at timestamptz,
  add column if not exists moderation_reason_code text,
  add column if not exists width int,
  add column if not exists height int;

-- Compatibilidade: fotos que já existiam quando esta migration roda (inclusive
-- as do passeio real de integração, teste-integracao-toursflow-90f2bc) recebem
-- 'legacy_approved' -- explicitamente diferente de 'approved' (marca "nunca
-- passou por moderação nenhuma, aceito por já existir"), mas conta em TUDO
-- exatamente como 'approved' (ver validate_tour_for_publishing e as rotas
-- públicas). Nenhuma foto existente vira 'rejected'/'pending' por causa desta
-- migration, e nenhuma é reenviada pra OpenAI automaticamente aqui (evita
-- custo inesperado e mudança de catálogo -- remoderação histórica, se um dia
-- for necessária, fica como processo opcional separado).
update public.tour_photos set moderation_status = 'legacy_approved' where moderation_status is null;

-- ACHADO/CORREÇÃO NESTA REVISÃO: no lançamento inicial NÃO existe provider
-- pago ligado (decisão de produto -- ver DOCUMENTACAO.md) -- o operador
-- publica normalmente e o super_admin faz moderação MANUAL (suspender o
-- passeio via marketplace_suspended_at, acima, se identificar algo
-- inadequado). O código (addTourPhoto/runPhotoModeration, ver
-- src/lib/image-moderation.ts) decide o status de cada foto nova de forma
-- EXPLÍCITA a partir de IMAGE_MODERATION_MODE ("manual" -> já nasce
-- 'manual_approved'; "openai" -> nasce 'pending' e passa pela moderação
-- real) -- nunca depende deste default pra isso. O default abaixo
-- ('pending') é só rede de segurança pra um insert que por algum motivo
-- esqueça de setar o campo -- nesse caso a foto fica de fora da publicação
-- (fail-closed, mesmo espírito de moderation_unavailable) até o operador usar
-- o botão de nova tentativa, nunca aprovada por omissão.
alter table public.tour_photos alter column moderation_status set default 'pending';
alter table public.tour_photos alter column moderation_status set not null;

alter table public.tour_photos
  add constraint tour_photos_moderation_status_check
    check (moderation_status in ('pending', 'approved', 'rejected', 'moderation_unavailable', 'legacy_approved', 'manual_approved'));

comment on column public.tour_photos.moderation_status is
  'pending = upload novo em modo openai, moderação ainda não concluiu ou ainda não rodou. approved = moderação real (provider) concluiu e liberou. rejected = moderação real recusou (ver moderation_reason_code). moderation_unavailable = falha técnica na moderação (timeout/erro do provider) -- nunca tratado como aprovado. legacy_approved = existia antes desta coluna existir, tratada como aprovada em tudo, nunca remoderada automaticamente. manual_approved = liberada sem provider, enquanto IMAGE_MODERATION_MODE=manual for a política ativa -- conta como aprovada em tudo, mas nunca reprocessada automaticamente se o modo mudar para openai no futuro.';
comment on column public.tour_photos.width is 'Resolução capturada no navegador no momento do upload. NULL = foto antiga, anterior a esta captura -- nunca bloqueia validação de resolução, só pula a checagem.';
comment on column public.tour_photos.moderation_reason_code is
  'Categoria genérica normalizada (ex: sexual, violence_graphic, hate) quando rejected -- nunca a resposta completa do provider, nunca score numérico, nunca texto sensível.';

-- --------------------------------------------------------------------------
-- REGRAS DE CONTEÚDO PÚBLICO — função pura, sem acesso a tabela,Reaproveitada
-- em DOIS lugares (validate_tour_for_publishing abaixo E o gatilho que protege
-- edição de passeio já publicado, mais adiante) -- uma request textual só um
-- lugar, nunca duplicada. Determinístico (regex), NUNCA "IA"/NLP -- exatamente
-- o que a auditoria pediu: sem provider de moderação semântica, só proteções
-- objetivas (link, e-mail, telefone, WhatsApp, Instagram, PIX, convite pra
-- reservar fora do ToursFlow). Regex de telefone exige o agrupamento típico
-- (DDD de 2 dígitos + 4-5 + 4 dígitos) de propósito -- não confunde com
-- número de endereço ("Rua X, nº 120") nem CEP (8 dígitos, agrupamento
-- diferente). Limitação conhecida e documentada (não esta função): não
-- detecta contato disfarçado em imagem (QR Code, texto sobreposto) -- isso
-- exigiria OCR/visão computacional, fica para o futuro provider.
-- --------------------------------------------------------------------------

-- p_boarding_instructions/p_boarding_reference incluídos de propósito: são
-- campos livres (não estruturados como endereço/CEP) e a API pública
-- devolve os dois em boarding.instructions/boarding.reference (ver
-- src/lib/public-api.ts) -- sem isto, dava pra colar um telefone ali e
-- contornar a checagem que só olhava a descrição.
create or replace function public.check_tour_public_content_violation(
  p_name text,
  p_description text,
  p_short_description text,
  p_itinerary text,
  p_included text,
  p_not_included text,
  p_important_information text,
  p_boarding_instructions text default null,
  p_boarding_reference text default null
) returns text
language plpgsql
immutable
as $$
declare
  v_text text;
begin
  if p_name ~* '(https?://|www\.|\.com\.br\b|\.com\b|whatsapp|\bwpp\b|\binstagram\b)' then
    return 'EXTERNAL_CONTACT_IN_TITLE';
  end if;
  if p_name ~ '\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\M' then
    return 'EXTERNAL_CONTACT_IN_TITLE';
  end if;

  v_text := coalesce(p_description, '') || ' ' || coalesce(p_short_description, '') || ' ' ||
            coalesce(p_itinerary, '') || ' ' || coalesce(p_included, '') || ' ' ||
            coalesce(p_not_included, '') || ' ' || coalesce(p_important_information, '') || ' ' ||
            coalesce(p_boarding_instructions, '') || ' ' || coalesce(p_boarding_reference, '');

  if v_text ~* '(https?://|www\.[a-z0-9-]+\.[a-z]{2,}|\.com\.br\b|\.com\b)' then
    return 'EXTERNAL_LINK_IN_DESCRIPTION';
  end if;
  if v_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return 'EMAIL_IN_DESCRIPTION';
  end if;
  if v_text ~* '(whatsapp|\bwpp\b|\bzap\b)' then
    return 'WHATSAPP_IN_DESCRIPTION';
  end if;
  if v_text ~* '\binstagram\b' then
    return 'SOCIAL_MEDIA_IN_DESCRIPTION';
  end if;
  if v_text ~* '\bpix\b' then
    return 'PIX_IN_DESCRIPTION';
  end if;
  if v_text ~* '(reserve direto|reserve pelo|reserva direta)' then
    return 'DIRECT_BOOKING_BYPASS';
  end if;
  if v_text ~ '\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\M' then
    return 'PHONE_IN_DESCRIPTION';
  end if;

  return null;
end;
$$;

-- --------------------------------------------------------------------------
-- VALIDADOR CENTRAL — retorna TODOS os problemas de uma vez (não só o
-- primeiro), separados por severity 'error'/'warning', com code+field+message
-- pra UI montar o checklist sem reimplementar nenhuma regra. SECURITY INVOKER
-- (padrão, sem "security definer") de propósito -- roda com o RLS de quem
-- chamou, então um operador só consegue validar (e o gatilho abaixo só
-- consegue publicar) o próprio passeio; chamado de dentro do gatilho de
-- transição, herda automaticamente a sessão de quem disparou o UPDATE.
-- --------------------------------------------------------------------------

create or replace function public.validate_tour_for_publishing(p_tour_id uuid)
returns table (code text, field text, message text, severity text)
language plpgsql
stable
as $$
declare
  v_tour record;
  v_cover record;
  v_content_violation text;
  v_approved_photo_count int;
  v_future_departure_count int;
  v_duplicate_count int;
begin
  select t.*, c.suspended_at as company_suspended_at
    into v_tour
    from public.tours t
    join public.companies c on c.id = t.company_id
    where t.id = p_tour_id;

  if not found then
    return query select 'TOUR_NOT_FOUND'::text, null::text, 'Passeio não encontrado.'::text, 'error'::text;
    return;
  end if;

  if v_tour.marketplace_suspended_at is not null then
    return query select 'ADMIN_SUSPENDED', null::text, 'Este passeio está com a publicação suspensa pelo administrador.', 'error';
  end if;
  if v_tour.company_suspended_at is not null then
    return query select 'COMPANY_SUSPENDED', null::text, 'A conta do operador está suspensa.', 'error';
  end if;
  if not v_tour.active then
    return query select 'TOUR_INACTIVE', null::text, 'Este passeio está inativo.', 'error';
  end if;

  if v_tour.name is null or btrim(v_tour.name) = '' then
    return query select 'MISSING_TITLE', 'name', 'Informe o título do passeio.', 'error';
  elsif length(btrim(v_tour.name)) < 5 then
    return query select 'TITLE_TOO_SHORT', 'name', 'O título é muito curto.', 'error';
  elsif length(v_tour.name) > 120 then
    return query select 'TITLE_TOO_LONG', 'name', 'O título é muito longo.', 'error';
  end if;

  if v_tour.short_description is null or btrim(v_tour.short_description) = '' then
    return query select 'MISSING_SHORT_DESCRIPTION', 'short_description', 'Informe a descrição curta.', 'error';
  end if;

  if v_tour.description is null or length(btrim(v_tour.description)) < 40 then
    return query select 'DESCRIPTION_TOO_SHORT', 'description', 'A descrição completa precisa ter pelo menos 40 caracteres.', 'error';
  end if;

  if v_tour.destination is null or btrim(v_tour.destination) = '' then
    return query select 'MISSING_DESTINATION', 'destination', 'Informe o destino.', 'error';
  end if;

  if v_tour.category is null then
    return query select 'MISSING_CATEGORY', 'category', 'Selecione a categoria.', 'error';
  end if;

  if v_tour.duration_minutes is null or v_tour.duration_minutes <= 0 then
    return query select 'MISSING_DURATION', 'duration_minutes', 'Informe a duração do passeio.', 'error';
  end if;

  if v_tour.price_type is null then
    return query select 'MISSING_PRICE_TYPE', 'price_type', 'Selecione o tipo de preço.', 'error';
  end if;

  if v_tour.boarding_name is null or btrim(v_tour.boarding_name) = ''
     or v_tour.boarding_address is null or btrim(v_tour.boarding_address) = ''
     or v_tour.boarding_city is null or btrim(v_tour.boarding_city) = '' then
    return query select 'MISSING_BOARDING_INFO', 'boarding', 'Preencha o local de embarque (nome, endereço e cidade).', 'error';
  end if;

  if v_tour.boarding_latitude is not null and (v_tour.boarding_latitude < -90 or v_tour.boarding_latitude > 90) then
    return query select 'INVALID_LATITUDE', 'boarding_latitude', 'Latitude inválida.', 'error';
  end if;
  if v_tour.boarding_longitude is not null and (v_tour.boarding_longitude < -180 or v_tour.boarding_longitude > 180) then
    return query select 'INVALID_LONGITUDE', 'boarding_longitude', 'Longitude inválida.', 'error';
  end if;

  -- conteúdo textual: mesma regra usada na edição de passeio já publicado
  -- (trg_tour_content_while_published, mais abaixo) -- uma função só, os dois
  -- lugares chamam.
  v_content_violation := public.check_tour_public_content_violation(
    v_tour.name, v_tour.description, v_tour.short_description, v_tour.itinerary,
    v_tour.included, v_tour.not_included, v_tour.important_information,
    v_tour.boarding_instructions, v_tour.boarding_reference
  );
  if v_content_violation is not null then
    return query select
      v_content_violation,
      case when v_content_violation = 'EXTERNAL_CONTACT_IN_TITLE' then 'name' else 'description' end,
      case v_content_violation
        when 'EXTERNAL_CONTACT_IN_TITLE' then 'Remova informações de contato ou links externos do título.'
        when 'EXTERNAL_LINK_IN_DESCRIPTION' then 'Remova links externos da descrição.'
        when 'EMAIL_IN_DESCRIPTION' then 'Remova o e-mail da descrição.'
        when 'WHATSAPP_IN_DESCRIPTION' then 'Remova menções a WhatsApp da descrição.'
        when 'SOCIAL_MEDIA_IN_DESCRIPTION' then 'Remova menções a redes sociais externas da descrição.'
        when 'PIX_IN_DESCRIPTION' then 'Remova menções a PIX da descrição.'
        when 'DIRECT_BOOKING_BYPASS' then 'Remova convites para reservar fora do ToursFlow.'
        when 'PHONE_IN_DESCRIPTION' then 'Remova telefones da descrição.'
        else 'Revise o conteúdo do passeio.'
      end,
      'error';
  end if;

  -- fotos
  select count(*) into v_approved_photo_count
    from public.tour_photos
    where tour_id = p_tour_id and moderation_status in ('approved', 'legacy_approved', 'manual_approved');
  if v_approved_photo_count = 0 then
    return query select 'NO_APPROVED_PHOTO', 'photos', 'Adicione pelo menos uma foto aprovada.', 'error';
  end if;

  select * into v_cover from public.tour_photos where tour_id = p_tour_id and is_cover = true limit 1;
  if not found then
    return query select 'NO_COVER_PHOTO', 'photos', 'Defina uma foto de capa.', 'error';
  else
    if v_cover.moderation_status = 'rejected' then
      return query select 'COVER_PHOTO_REJECTED', 'photos', 'Esta imagem não atende às regras de publicação. Remova ou substitua a imagem para continuar.', 'error';
    elsif v_cover.moderation_status = 'pending' then
      return query select 'COVER_PHOTO_PENDING', 'photos', 'Uma imagem ainda está sendo verificada. Tente novamente em alguns minutos.', 'error';
    elsif v_cover.moderation_status = 'moderation_unavailable' then
      return query select 'COVER_PHOTO_MODERATION_UNAVAILABLE', 'photos', 'Não foi possível verificar esta imagem agora. Tente novamente em alguns minutos.', 'error';
    elsif v_cover.width is not null and v_cover.height is not null and (v_cover.width < 800 or v_cover.height < 600) then
      return query select 'LOW_RESOLUTION_COVER', 'photos', 'A foto de capa está com resolução abaixo do mínimo recomendado (800x600).', 'error';
    end if;
  end if;

  -- warnings (nunca bloqueiam publicação)
  select count(*) into v_future_departure_count
    from public.departures
    where tour_id = p_tour_id and status <> 'cancelada' and departs_at > now();
  if v_future_departure_count = 0 then
    return query select 'NO_FUTURE_DEPARTURES', 'departures', 'Este passeio ainda não tem nenhuma saída futura cadastrada.', 'warning';
  end if;

  select count(*) into v_duplicate_count
    from public.tours t2
    where t2.company_id = v_tour.company_id
      and t2.id <> p_tour_id
      and lower(btrim(t2.name)) = lower(btrim(v_tour.name))
      and t2.destination is not distinct from v_tour.destination
      and t2.category is not distinct from v_tour.category;
  if v_duplicate_count > 0 then
    return query select 'POSSIBLE_DUPLICATE_TOUR', null::text, 'Já existe outro passeio muito parecido nesta empresa.', 'warning';
  end if;

  return;
end;
$$;

-- ============================================================================
-- NOVA REGRA DE TRANSIÇÃO — substitui a função da migration 0039. Operador da
-- própria empresa (RLS já garante "própria empresa" -- isto aqui só decide
-- QUAIS status, não DE QUEM):
--
--   -> published: permitido a partir de QUALQUER status anterior (draft,
--      rejected, paused, review -- linhas legadas incluídas), DESDE que o
--      passeio não esteja com marketplace_suspended_at preenchido E passe em
--      validate_tour_for_publishing (nenhum 'error') -- ESTA é a garantia
--      contra bypass: mesmo um UPDATE direto via API do Supabase, ignorando
--      Server Action e UI inteiras, passa por aqui.
--   published -> draft: despublicar, sempre permitido -- nunca bloqueado por
--      suspensão nem pela validação (sair do ar não deveria exigir nada).
--   qualquer outra transição: continua negada pro operador.
--
-- super_admin continua podendo fazer QUALQUER transição de marketplace_status
-- (comportamento idêntico ao de 0039) -- a moderação de verdade agora é via
-- marketplace_suspended_at (trigger acima), não mais via bloquear 'published'.
-- ============================================================================

create or replace function public.check_tour_marketplace_transition()
returns trigger
language plpgsql
as $$
declare
  v_has_error boolean;
begin
  if new.marketplace_status = old.marketplace_status then
    return new;
  end if;

  if public.is_super_admin() then
    return new;
  end if;

  if new.marketplace_status = 'published' then
    if old.marketplace_suspended_at is not null then
      raise exception 'Este passeio está com a publicação suspensa pelo administrador.';
    end if;

    select exists(select 1 from public.validate_tour_for_publishing(new.id) where severity = 'error') into v_has_error;
    if v_has_error then
      raise exception 'PUBLISH_VALIDATION_FAILED';
    end if;

    return new;
  end if;

  if old.marketplace_status = 'published' and new.marketplace_status = 'draft' then
    return new;
  end if;

  raise exception 'Transição de status de publicação não permitida para este usuário (% -> %).',
    old.marketplace_status, new.marketplace_status;
end;
$$;

-- ============================================================================
-- EDIÇÃO DE PASSEIO JÁ PUBLICADO — achado da auditoria: sem isto, o operador
-- podia editar um passeio JÁ publicado e colar um telefone na descrição sem
-- nenhuma checagem (o gatilho acima só dispara quando marketplace_status
-- MUDA, e aqui ele não muda -- continua 'published'). Preferência adotada
-- (das duas oferecidas): BLOQUEAR a alteração inválida, nunca despublicar
-- silenciosamente -- o operador mantém o controle explícito de quando algo
-- sai do ar. Reaproveita a MESMA função de conteúdo do validador acima (zero
-- duplicação da regex). Só dispara pra passeio que CONTINUA publicado -- editar
-- um rascunho aceita qualquer conteúdo (a barreira de verdade é no momento de
-- publicar, via check_tour_marketplace_transition acima).
-- ============================================================================

create or replace function public.check_tour_content_while_published()
returns trigger
language plpgsql
as $$
declare
  v_violation text;
begin
  if new.marketplace_status <> 'published' then
    return new;
  end if;

  v_violation := public.check_tour_public_content_violation(
    new.name, new.description, new.short_description, new.itinerary,
    new.included, new.not_included, new.important_information,
    new.boarding_instructions, new.boarding_reference
  );
  if v_violation is not null then
    raise exception '%', v_violation;
  end if;

  return new;
end;
$$;

create trigger trg_tour_content_while_published
  before update of name, description, short_description, itinerary, included, not_included,
    important_information, boarding_instructions, boarding_reference, marketplace_status
  on public.tours
  for each row execute function public.check_tour_content_while_published();

-- ============================================================================
-- BOOKING: create_marketplace_booking (0042/0043) ganha uma checagem de
-- defesa em profundidade contra company suspensa -- mesmo padrão já usado no
-- projeto inteiro pra nunca confiar só na camada de cima (a rota já vai
-- checar isto também, ver route.ts). Corpo idêntico ao da 0043, só com o
-- bloco novo logo após resolver v_company_id -- ANTES de tocar em client ou
-- reservation, então uma company suspensa nunca chega nem perto de criar
-- nenhum dos dois. Fica DEPOIS da checagem de idempotência de propósito: um
-- replay de uma reserva que já existia antes da suspensão continua
-- devolvendo a mesma reserva original -- suspender a empresa não deveria
-- quebrar retroativamente uma reserva que já tinha sido criada.
-- ============================================================================

create or replace function public.create_marketplace_booking(
  p_departure_id uuid,
  p_quantity int,
  p_total_cents int,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_cpf text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_hold_minutes int
) returns table (
  booking_id uuid,
  hold_expires_at timestamptz,
  people_count int,
  total_cents int,
  is_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_client_id uuid;
  v_existing record;
  v_new_id uuid;
  v_hold timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('marketplace_booking'), hashtext(p_idempotency_key));

  select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint
    into v_existing
    from public.reservations r
    where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
    return;
  end if;

  select company_id into v_company_id from public.departures where id = p_departure_id;
  if v_company_id is null then
    raise exception 'DEPARTURE_NOT_FOUND';
  end if;

  if exists (select 1 from public.companies where id = v_company_id and suspended_at is not null) then
    raise exception 'COMPANY_NOT_AVAILABLE';
  end if;

  begin
    if p_customer_cpf is not null then
      insert into public.clients (company_id, name, cpf, phone, email)
      values (v_company_id, p_customer_name, p_customer_cpf, p_customer_phone, p_customer_email)
      on conflict (company_id, cpf) do update set cpf = excluded.cpf
      returning id into v_client_id;
    else
      insert into public.clients (company_id, name, phone, email)
      values (v_company_id, p_customer_name, p_customer_phone, p_customer_email)
      returning id into v_client_id;
    end if;

    v_hold := now() + make_interval(mins => p_hold_minutes);

    insert into public.reservations (
      company_id, departure_id, client_id, people_count, total_cents,
      status, source, origin_name, created_by, partner_id,
      hold_expires_at, idempotency_key, request_fingerprint
    ) values (
      v_company_id, p_departure_id, v_client_id, p_quantity, p_total_cents,
      'pendente', 'marketplace', 'ToursFlow', null, null,
      v_hold, p_idempotency_key, p_request_fingerprint
    )
    returning id into v_new_id;

    return query select v_new_id, v_hold, p_quantity, p_total_cents, false;
    return;
  exception
    when unique_violation then
      if sqlerrm not like '%reservations_marketplace_idempotency_key_unique%' then
        raise;
      end if;

      select r.id, r.hold_expires_at, r.people_count, r.total_cents, r.request_fingerprint
        into v_existing
        from public.reservations r
        where r.source = 'marketplace' and r.idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;
      if v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;

      return query select v_existing.id, v_existing.hold_expires_at, v_existing.people_count, v_existing.total_cents, true;
      return;
  end;
end;
$$;

-- ============================================================================
-- ACL — DEFESA EM PROFUNDIDADE (achado da revisão pré-deploy). O Supabase
-- concede EXECUTE em toda função NOVA do schema public direto pra
-- `anon`/`authenticated`/`service_role`, independente do pseudo-role PUBLIC
-- -- achado confirmado em produção (pg_proc.proacl, leitura direta) na
-- migration 0043, mesmo projeto: "revoke ... from public" sozinho NÃO bastou
-- pra create_marketplace_booking/check_rate_limit. Esta seção reafirma
-- explicitamente o ACL de toda função criada/substituída nesta migration --
-- não confia em teoria nenhuma, nem que CREATE OR REPLACE preserva grant
-- (que preserva, mas fica reafirmado aqui mesmo assim).
-- ============================================================================

-- create_marketplace_booking: CREATE OR REPLACE preserva a OID e portanto o
-- ACL que a 0043 já tinha aplicado (mesma assinatura, confirmada acima) --
-- reafirmado aqui de qualquer forma, defesa em profundidade real, não
-- suposição.
revoke execute on function public.create_marketplace_booking(
  p_departure_id uuid, p_quantity integer, p_total_cents integer,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_customer_cpf text, p_idempotency_key text, p_request_fingerprint text,
  p_hold_minutes integer
) from public, anon, authenticated;

grant execute on function public.create_marketplace_booking(
  p_departure_id uuid, p_quantity integer, p_total_cents integer,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_customer_cpf text, p_idempotency_key text, p_request_fingerprint text,
  p_hold_minutes integer
) to service_role;

-- validate_tour_for_publishing: SECURITY INVOKER, PRECISA continuar chamável
-- por `authenticated` -- getPublicationChecklist()/publishTour() (Server
-- Actions) chamam com o client de sessão do próprio operador, e é a RLS de
-- tours/companies/tour_photos/departures (escopada por company_id, ver
-- migration 0000) que garante que um operador só valida o PRÓPRIO passeio
-- (tour de outra empresa vira "not found" pra ele, RLS esconde a linha antes
-- da função ver qualquer coisa). `anon` nunca tem motivo legítimo pra chamar
-- isto direto -- mesmo que hoje seja inofensivo (RLS fecha tudo pra anon,
-- que não tem policy nenhuma de select em tours), revogado por princípio de
-- menor privilégio, não por já ter achado um jeito de explorar.
revoke execute on function public.validate_tour_for_publishing(uuid) from public, anon;
grant execute on function public.validate_tour_for_publishing(uuid) to authenticated;

-- Helpers/gatilhos: nenhum precisa ser chamado via RPC por ninguém -- só
-- internamente (uma função chamando a outra, ou o próprio Postgres disparando
-- o gatilho dentro de um INSERT/UPDATE). check_tour_suspension_guard/
-- check_tour_marketplace_transition/check_tour_content_while_published já são
-- estruturalmente impossíveis de invocar via RPC (retornam `trigger` --
-- Postgres recusa chamá-las fora de contexto de gatilho, com ou sem GRANT) --
-- revogado mesmo assim, só pra documentar a intenção de forma explícita, sem
-- depender do privilégio padrão pra nenhuma delas.
revoke execute on function public.check_tour_public_content_violation(
  p_name text, p_description text, p_short_description text, p_itinerary text,
  p_included text, p_not_included text, p_important_information text,
  p_boarding_instructions text, p_boarding_reference text
) from public, anon, authenticated;
revoke execute on function public.check_tour_suspension_guard() from public, anon, authenticated;
revoke execute on function public.check_tour_marketplace_transition() from public, anon, authenticated;
revoke execute on function public.check_tour_content_while_published() from public, anon, authenticated;
