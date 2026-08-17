-- Controle manual de notas fiscais da assinatura do SaaS. NÃO emite nota fiscal
-- de verdade (não há certificado digital / provedor de NFS-e configurado ainda,
-- ver DOCUMENTACAO.md seção 16) -- isto é só um registro: o super admin emite a
-- nota por fora (prefeitura/contador) e anota aqui número, valor, link do PDF e
-- data, pra empresa ter um histórico e não perder o controle de quais meses já
-- foram faturados.
--
-- Rode este script no SQL Editor do Supabase (Project > SQL Editor > New query).

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text,
  amount_cents int not null default 0,
  pdf_url text,
  issued_at date not null default current_date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoices_company on public.invoices (company_id, issued_at desc);

alter table public.invoices enable row level security;

-- super admin gerencia (cria, edita, remove) as notas de qualquer empresa
create policy "super admin - gerencia notas fiscais" on public.invoices
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- a propria empresa so pode VER as proprias notas -- quem registra é sempre o super admin
create policy "empresa - ve as proprias notas fiscais" on public.invoices
  for select to authenticated using (company_id = public.current_company_id());
