-- Preparação NauticFlow → ToursFlow (fase 5/7): infraestrutura de pagamento --
-- SOMENTE a tabela. Nenhum checkout, cobrança de turista ou split é implementado
-- aqui (fora de escopo desta etapa). O objetivo único é não deixar RESERVA e
-- PAGAMENTO misturados no mesmo registro desde já, para quando o checkout do
-- turista existir de fato não precisar de uma migration de reestruturação.
--
-- CORRIGIDA na revisão pré-deploy: a implementação anterior (removida do
-- repositório, mas já aplicada de fato neste banco -- ver nota na migration 0039)
-- já tinha criado `public.payments`, só que com um desenho ligeiramente diferente
-- (method/asaas_payment_id/paid_at em vez de provider/provider_payment_id/
-- currency/updated_at). A tabela está VAZIA (0 linhas, nada em jogo). Em vez de
-- recriar (o que falharia -- "relation already exists"), completa com ADD COLUMN
-- só o que falta, preservando as colunas antigas (aditivo, como o resto da sessão).
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
  amount_cents int not null check (amount_cents >= 0),
  created_at timestamptz not null default now()
);

alter table public.payments
  add column if not exists provider text not null default 'asaas',
  add column if not exists provider_payment_id text,
  add column if not exists currency text not null default 'BRL',
  add column if not exists updated_at timestamptz not null default now();

create index if not exists payments_company_id_idx on public.payments (company_id);
create index if not exists payments_reservation_id_idx on public.payments (reservation_id);
-- evita registrar o mesmo pagamento do provedor duas vezes (mesma ideia de
-- idempotência da migration 0037, aplicada aqui pro dia em que isto for usado)
create unique index if not exists payments_provider_payment_id_unique
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

alter table public.payments enable row level security;

-- A implementação anterior tinha deixado uma policy "pagamentos da empresa"
-- (authenticated, todas as operações) -- ou seja, qualquer company_admin/staff já
-- conseguiria ler/escrever esta tabela direto pelo navegador hoje. Como nada no
-- código da aplicação usa `payments` ainda, e a intenção explícita desta etapa
-- (acordada no pedido original: "somente infraestrutura") é deixar fechada até
-- existir lógica real de verdade por trás, essa policy é removida aqui -- mesmo
-- padrão de trial_history (0031): RLS habilitada e SEM NENHUMA policy, só
-- service_role acessa por enquanto.
drop policy if exists "pagamentos da empresa" on public.payments;

create or replace function public.touch_payments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.touch_payments_updated_at();

-- ============================================================================
-- Empresa como futura recebedora (Asaas Split) -- só as colunas. Onboarding
-- financeiro, criação de wallet e o próprio Split ficam para uma etapa futura,
-- só depois que o checkout do turista existir. Não altera em nada o fluxo atual
-- de cobrança da assinatura SaaS (companies.asaas_customer_id, migration 0012).
--
-- CORRIGIDA na 2ª tentativa de deploy: a primeira versão desta migration tentava
-- normalizar 'none' -> NULL antes de trocar o constraint, e quebrou porque a
-- implementação anterior já tinha criado `asaas_receiver_status` como NOT NULL
-- (default 'none') -- o UPDATE pra NULL violava essa restrição (erro 23502),
-- revertido automaticamente sem efeito (as 3 empresas continuaram com 'none').
--
-- Decisão (confirmada): preservar o contrato que já existe em produção, sem
-- tocar em nenhum dado existente:
--   none    = operador ainda não iniciou configuração de recebimento/Split
--   pending = configuração/onboarding em andamento
--   active  = operador configurado e apto a receber
-- Nada de NULL, nada de 'pending'/'approved'/'rejected' (versão anterior deste
-- arquivo, nunca chegou a ser aplicada). `add column if not exists` já cobre os
-- dois cenários (coluna nova = nasce not null default 'none'; coluna já
-- existente = não é tocada, mantém NOT NULL/default/valores como estão).
-- ============================================================================
alter table public.companies
  add column if not exists asaas_wallet_id text,
  add column if not exists asaas_receiver_status text not null default 'none';

-- a implementação anterior já criou este constraint com exatamente estes
-- valores -- só cria se ainda não existir (cenário de instalação nova, sem essa
-- implementação anterior por trás)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_asaas_receiver_status_check') then
    alter table public.companies
      add constraint companies_asaas_receiver_status_check
        check (asaas_receiver_status in ('none', 'pending', 'active'));
  end if;
end $$;
