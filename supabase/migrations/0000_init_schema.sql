-- NauticFlow — schema inicial completo.
-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query) do projeto
-- que está em NEXT_PUBLIC_SUPABASE_URL no .env.local. Ele cria tudo do zero: tabelas, triggers
-- de negócio (capacidade de saída, limite de passageiros, capacidade comercial da embarcação),
-- RLS multi-tenant (isolamento por empresa) e a função bootstrap_company usada no cadastro.
--
-- Reconstruído a partir do código do app (não havia migrations no repositório). Se este projeto
-- já tiver alguma dessas tabelas, rode por partes e ajuste o que já existir.

create extension if not exists pgcrypto;

-- ============================================================================
-- TABELAS
-- ============================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text,
  city text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  max_vessels int,
  max_users int,
  price_cents int,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  role text not null default 'company_admin' check (role in ('super_admin', 'company_admin', 'staff')),
  name text,
  email text,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  plan_id uuid references public.plans (id),
  status text not null default 'ativa',
  created_at timestamptz not null default now()
);

create table public.vessels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  type text not null check (type in ('escuna', 'lancha', 'jet_ski', 'catamara', 'outro')),
  official_capacity int not null check (official_capacity > 0),
  default_crew int not null default 0 check (default_crew >= 0),
  commercial_capacity int not null default 0,
  gross_tonnage numeric,
  registration text,
  status text not null default 'ativa' check (status in ('ativa', 'manutencao', 'inativa')),
  created_at timestamptz not null default now()
);

create table public.tours (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  base_price_cents int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  cpf text,
  phone text,
  email text,
  city text,
  created_at timestamptz not null default now(),
  unique (company_id, cpf)
);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  type text not null default 'agencia' check (type in ('hotel', 'pousada', 'agencia', 'outro')),
  contact text,
  commission_rate numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.departures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  vessel_id uuid not null references public.vessels (id) on delete restrict,
  tour_id uuid not null references public.tours (id) on delete restrict,
  departs_at timestamptz not null,
  capacity int not null,
  status text not null default 'agendada' check (status in ('agendada', 'em_andamento', 'encerrada', 'cancelada')),
  created_at timestamptz not null default now(),
  unique (vessel_id, departs_at)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  departure_id uuid not null references public.departures (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  partner_id uuid references public.partners (id) on delete set null,
  people_count int not null check (people_count > 0),
  total_cents int not null default 0,
  status text not null default 'confirmada' check (status in ('confirmada', 'cancelada', 'pendente')),
  origin_name text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.passengers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  name text not null,
  document text,
  nationality text,
  birth_date date,
  emergency_contact text,
  status text not null default 'confirmado' check (status in ('confirmado', 'embarcado', 'ausente')),
  created_at timestamptz not null default now()
);

create table public.manifests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  departure_id uuid not null references public.departures (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index on public.profiles (company_id);
create index on public.subscriptions (company_id);
create index on public.vessels (company_id);
create index on public.tours (company_id);
create index on public.clients (company_id);
create index on public.partners (company_id);
create index on public.departures (company_id);
create index on public.departures (vessel_id);
create index on public.reservations (company_id);
create index on public.reservations (departure_id);
create index on public.reservations (client_id);
create index on public.reservations (partner_id);
create index on public.passengers (company_id);
create index on public.passengers (reservation_id);
create index on public.manifests (company_id);
create index on public.manifests (departure_id);

-- ============================================================================
-- FUNÇÕES DE APOIO
-- ============================================================================

-- security definer: le o profile do usuario logado ignorando RLS (evita recursao
-- quando outras tabelas usam esta funcao dentro das proprias politicas de RLS).
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- ============================================================================
-- TRIGGERS DE NEGÓCIO
-- ============================================================================

-- capacidade comercial da embarcacao = capacidade oficial menos tripulacao padrao
create or replace function public.set_vessel_commercial_capacity()
returns trigger
language plpgsql
as $$
begin
  new.commercial_capacity := greatest(new.official_capacity - new.default_crew, 0);
  return new;
end;
$$;

create trigger trg_vessel_commercial_capacity
  before insert or update of official_capacity, default_crew on public.vessels
  for each row execute function public.set_vessel_commercial_capacity();

-- capacidade da saida: usa a capacidade comercial da embarcacao quando nao informada,
-- e recusa quando o valor informado excede a capacidade comercial da embarcacao.
create or replace function public.set_departure_capacity()
returns trigger
language plpgsql
as $$
declare
  v_commercial int;
begin
  select commercial_capacity into v_commercial from public.vessels where id = new.vessel_id;

  if new.capacity is null then
    new.capacity := v_commercial;
  elsif new.capacity > v_commercial then
    raise exception 'A capacidade informada excede a capacidade comercial da embarcação (%).', v_commercial;
  end if;

  return new;
end;
$$;

create trigger trg_departure_capacity
  before insert or update of capacity, vessel_id on public.departures
  for each row execute function public.set_departure_capacity();

-- recusa reserva (confirmada) que exceda a capacidade da saida
create or replace function public.check_departure_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity int;
  v_booked int;
begin
  if new.status <> 'confirmada' then
    return new;
  end if;

  select capacity into v_capacity from public.departures where id = new.departure_id;

  select coalesce(sum(people_count), 0) into v_booked
    from public.reservations
    where departure_id = new.departure_id
      and status = 'confirmada'
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_booked + new.people_count > v_capacity then
    raise exception 'Capacidade excedida: % vaga(s) disponível(is), % solicitada(s).',
      greatest(v_capacity - v_booked, 0), new.people_count;
  end if;

  return new;
end;
$$;

create trigger trg_reservation_capacity
  before insert or update of people_count, status, departure_id on public.reservations
  for each row execute function public.check_departure_capacity();

-- recusa passageiro alem do people_count da reserva
create or replace function public.check_passenger_limit()
returns trigger
language plpgsql
as $$
declare
  v_limit int;
  v_count int;
begin
  select people_count into v_limit from public.reservations where id = new.reservation_id;

  select count(*) into v_count from public.passengers
    where reservation_id = new.reservation_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_count + 1 > v_limit then
    raise exception 'Limite de passageiros atingido para esta reserva (%).', v_limit;
  end if;

  return new;
end;
$$;

create trigger trg_passenger_limit
  before insert on public.passengers
  for each row execute function public.check_passenger_limit();

-- ============================================================================
-- CADASTRO: cria empresa + perfil + assinatura para quem acabou de se registrar
-- ============================================================================

create or replace function public.bootstrap_company(company_name text, plan_code text, user_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_plan_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.';
  end if;

  insert into public.companies (name) values (company_name) returning id into v_company_id;

  insert into public.profiles (id, company_id, role, name, email)
  values (auth.uid(), v_company_id, 'company_admin', user_name, auth.email())
  on conflict (id) do update
    set company_id = excluded.company_id,
        role = excluded.role,
        name = excluded.name;

  select id into v_plan_id from public.plans where code = plan_code limit 1;
  if v_plan_id is not null then
    insert into public.subscriptions (company_id, plan_id, status) values (v_company_id, v_plan_id, 'ativa');
  end if;
end;
$$;

grant execute on function public.bootstrap_company(text, text, text) to authenticated;

-- ============================================================================
-- DADOS DE REFERÊNCIA: planos (bate com a página de preços)
-- ============================================================================

insert into public.plans (code, name, max_vessels, max_users, price_cents) values
  ('start', 'Start', 1, 1, 14700),
  ('profissional', 'Profissional', 10, 5, 29700),
  ('premium', 'Premium', null, null, 59700)
on conflict (code) do nothing;

-- ============================================================================
-- RLS — isolamento por empresa
-- ============================================================================

alter table public.companies enable row level security;
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.vessels enable row level security;
alter table public.tours enable row level security;
alter table public.clients enable row level security;
alter table public.partners enable row level security;
alter table public.departures enable row level security;
alter table public.reservations enable row level security;
alter table public.passengers enable row level security;
alter table public.manifests enable row level security;

create policy "propria empresa - select" on public.companies
  for select to authenticated using (id = public.current_company_id());
create policy "propria empresa - update" on public.companies
  for update to authenticated using (id = public.current_company_id()) with check (id = public.current_company_id());

create policy "planos - leitura publica" on public.plans
  for select to authenticated using (true);

create policy "proprio perfil - select" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "proprio perfil - update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "assinatura da empresa - select" on public.subscriptions
  for select to authenticated using (company_id = public.current_company_id());

create policy "embarcacoes da empresa" on public.vessels
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "passeios da empresa" on public.tours
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "clientes da empresa" on public.clients
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "parceiros da empresa" on public.partners
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "saidas da empresa" on public.departures
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "reservas da empresa" on public.reservations
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "passageiros da empresa" on public.passengers
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "manifestos da empresa" on public.manifests
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ============================================================================
-- GRANTS — libera as operações a nível de tabela (RLS acima controla as linhas)
-- ============================================================================

grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on
  public.companies, public.profiles, public.subscriptions, public.vessels,
  public.tours, public.clients, public.partners, public.departures,
  public.reservations, public.passengers, public.manifests
to authenticated;

grant select on public.plans to authenticated;
