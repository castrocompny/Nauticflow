-- Trial de 7 dias: anti-abuso por identidade (CPF/CNPJ + e-mail), não mais só
-- por CPF/CNPJ. Evolui public.trial_history (migration 0031) -- não cria uma
-- segunda tabela paralela (menor complexidade, uma fonte de verdade só, ver
-- DOCUMENTACAO.md). Confirmado antes desta migration: trial_history está
-- vazia em produção (auditoria da própria sessão) -- mesmo assim o bloco
-- abaixo RECUSA rodar se encontrar qualquer linha, em vez de assumir isso
-- cegamente -- protege contra a informação estar desatualizada no momento em
-- que esta migration for realmente aplicada.
--
-- REGRA DE PRODUTO: uma identidade só ganha o trial grátis uma vez. Documento
-- já usado (com QUALQUER e-mail) -> sem novo trial. E-mail já usado (com
-- QUALQUER documento) -> sem novo trial. Trocar documento ou e-mail depois
-- NUNCA libera o identificador antigo nem inicia um trial novo por conta
-- disso -- o claim é permanente, nunca atualizado/removido por nenhum fluxo
-- do app.
do $$
begin
  if exists (select 1 from public.trial_history limit 1) then
    raise exception 'trial_history não está vazia -- não prosseguir com a migration 0045 sem revisar os dados existentes manualmente antes (ver DOCUMENTACAO.md).';
  end if;
end $$;

drop table public.trial_history;

create table public.trial_history (
  id uuid primary key default gen_random_uuid(),
  -- HMAC-SHA256 hex (64 chars) do documento/e-mail normalizados -- nunca o
  -- valor bruto (privacidade: mesmo um dump da tabela não recupera o
  -- CPF/CNPJ nem o e-mail sem o pepper, que não mora no banco nenhuma linha
  -- dele -- ver public.trial_identity_secret abaixo). Cada um com unique
  -- index PRÓPRIO (não composto) -- é isso que impede tanto "mesmo
  -- documento, e-mail novo" quanto "documento novo, mesmo e-mail" de ganhar
  -- trial de novo, cobrindo as 4 combinações da regra de produto com uma
  -- constraint só, sem lógica condicional nenhuma no INSERT.
  document_fingerprint text not null,
  email_fingerprint text not null,
  trial_started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index trial_history_document_fingerprint_key on public.trial_history (document_fingerprint);
create unique index trial_history_email_fingerprint_key on public.trial_history (email_fingerprint);

-- mesmo padrão de antes: RLS habilitada, ZERO policies = fechada por padrão
-- pra anon/authenticated; só o gatilho abaixo (security definer, roda como o
-- dono da função) e service_role passam por cima.
alter table public.trial_history enable row level security;

comment on table public.trial_history is
  'Claim permanente de uso do trial de 7 dias, por identidade (documento OU e-mail, cada um com unique index próprio). Nunca atualizado/apagado por nenhum fluxo do app -- trocar documento ou e-mail depois de usar o trial não libera o identificador antigo. Só o gatilho handle_new_user() escreve aqui.';

-- ============================================================================
-- PEPPER do HMAC -- mora só no banco, de propósito (ver
-- src/lib/trial-identity.ts pra explicação completa do porquê o gatilho
-- NUNCA confia num fingerprint pronto vindo de fora: o endpoint
-- auth.signup do Supabase é público e pode ser chamado direto, sem passar
-- pelo Server Action signUp(), então o cálculo do fingerprint TEM que
-- acontecer aqui dentro, a partir do dado bruto, pra não virar um jeito
-- trivial de sempre "parecer" uma identidade nova).
--
-- Nasce SEM valor nenhum nesta migration (nunca hardcode, nunca gerar
-- segredo de verdade num arquivo versionado). Configuração real é uma etapa
-- MANUAL, fora de qualquer migration, feita direto no SQL editor do Supabase
-- (nunca commitada):
--
--   insert into public.trial_identity_secret (pepper)
--   values ('<segredo aleatório, gerado uma vez, nunca reaproveitado de outro sistema>');
--
-- Enquanto não houver linha aqui, handle_new_user() trata como "pepper não
-- configurado" e NUNCA concede trial (fail-closed no benefício -- nunca
-- fail-closed na criação da conta em si, ver função abaixo) -- signup
-- continua funcionando normalmente, só sem o bônus de 7 dias, até alguém
-- configurar isto.
-- ============================================================================

create table public.trial_identity_secret (
  id int primary key default 1,
  pepper text not null,
  constraint trial_identity_secret_singleton check (id = 1)
);

alter table public.trial_identity_secret enable row level security;

comment on table public.trial_identity_secret is
  'Pepper do HMAC de fingerprint de identidade do trial (public.trial_fingerprint). No máximo 1 linha (id sempre 1). Configurado manualmente via SQL direto em produção, NUNCA por migration -- ver comentário acima. RLS sem nenhuma policy: nem anon, nem authenticated, nem service_role via PostgREST conseguem ler isto -- só funções security definer (que rodam como o dono, com bypassrls) enxergam o valor.';

-- ============================================================================
-- VALIDAÇÃO REAL de CPF/CNPJ (dígito verificador, não só contagem de
-- dígitos) + normalização + fingerprint -- funções puras, sem acesso a
-- tabela nenhuma (exceto trial_fingerprint, que lê o pepper). O MESMO
-- algoritmo de validação existe também em TypeScript
-- (src/lib/trial-identity.ts) -- usado lá só pra UX (mensagem de erro cedo
-- no formulário de cadastro), nunca como autoridade; as duas implementações
-- precisam continuar idênticas, documentado nos dois arquivos.
-- ============================================================================

create or replace function public.trial_normalize_document(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g'), '');
$$;

create or replace function public.trial_normalize_email(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_raw, ''))), '');
$$;

-- true quando os dígitos são todos iguais (000...0, 111...1, ...) -- esses
-- valores passam no cálculo ingênuo de dígito verificador por coincidência
-- matemática (quirk conhecido do algoritmo de CPF/CNPJ), então precisam de
-- bloqueio explícito à parte.
create or replace function public.trial_is_repeated_digit_sequence(p_digits text)
returns boolean
language sql
immutable
as $$
  select p_digits ~ '^(\d)\1+$';
$$;

create or replace function public.trial_validate_cpf(p_digits text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_sum int;
  v_d1 int;
  v_d2 int;
  v_remainder int;
begin
  if p_digits is null or length(p_digits) <> 11 then
    return false;
  end if;
  if public.trial_is_repeated_digit_sequence(p_digits) then
    return false;
  end if;

  v_sum := 0;
  for i in 0..8 loop
    v_sum := v_sum + substr(p_digits, i + 1, 1)::int * (10 - i);
  end loop;
  v_remainder := v_sum % 11;
  v_d1 := case when v_remainder < 2 then 0 else 11 - v_remainder end;
  if v_d1 <> substr(p_digits, 10, 1)::int then
    return false;
  end if;

  v_sum := 0;
  for i in 0..9 loop
    v_sum := v_sum + substr(p_digits, i + 1, 1)::int * (11 - i);
  end loop;
  v_remainder := v_sum % 11;
  v_d2 := case when v_remainder < 2 then 0 else 11 - v_remainder end;
  if v_d2 <> substr(p_digits, 11, 1)::int then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.trial_validate_cnpj(p_digits text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_weights_1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  v_weights_2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  v_sum int;
  v_d1 int;
  v_d2 int;
  v_remainder int;
begin
  if p_digits is null or length(p_digits) <> 14 then
    return false;
  end if;
  if public.trial_is_repeated_digit_sequence(p_digits) then
    return false;
  end if;

  v_sum := 0;
  for i in 1..12 loop
    v_sum := v_sum + substr(p_digits, i, 1)::int * v_weights_1[i];
  end loop;
  v_remainder := v_sum % 11;
  v_d1 := case when v_remainder < 2 then 0 else 11 - v_remainder end;
  if v_d1 <> substr(p_digits, 13, 1)::int then
    return false;
  end if;

  v_sum := 0;
  for i in 1..13 loop
    v_sum := v_sum + substr(p_digits, i, 1)::int * v_weights_2[i];
  end loop;
  v_remainder := v_sum % 11;
  v_d2 := case when v_remainder < 2 then 0 else 11 - v_remainder end;
  if v_d2 <> substr(p_digits, 14, 1)::int then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.trial_validate_document(p_digits text)
returns boolean
language plpgsql
immutable
as $$
begin
  if p_digits is null then
    return false;
  end if;
  if length(p_digits) = 11 then
    return public.trial_validate_cpf(p_digits);
  end if;
  if length(p_digits) = 14 then
    return public.trial_validate_cnpj(p_digits);
  end if;
  return false;
end;
$$;

-- Lê o pepper de trial_identity_secret e devolve o HMAC-SHA256 hex de
-- (p_prefix || p_normalized). NULL quando o pepper ainda não foi
-- configurado -- sinal pro chamador tratar como "sem trial" (fail-closed no
-- benefício, nunca aprovado por omissão -- mesmo espírito já usado pra
-- moderation_unavailable na migration 0044). SECURITY DEFINER pra poder ler
-- trial_identity_secret mesmo sendo chamada de dentro de um contexto que já
-- é security definer (handle_new_user) -- redundante mas explícito.
create or replace function public.trial_fingerprint(p_prefix text, p_normalized text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pepper text;
begin
  if p_normalized is null then
    return null;
  end if;
  select pepper into v_pepper from public.trial_identity_secret where id = 1;
  if v_pepper is null then
    return null;
  end if;
  return encode(hmac(p_prefix || p_normalized, v_pepper, 'sha256'), 'hex');
end;
$$;

-- ACL — DEFESA EM PROFUNDIDADE (achado da revisão pré-deploy, mesmo padrão da
-- migration 0044/0043): o Supabase concede EXECUTE em toda função nova do
-- schema public direto pra anon/authenticated, independente de PUBLIC --
-- revogado explicitamente de TODA função auxiliar nova, mesmo as que
-- teoricamente não vazam nada sozinhas (trial_normalize_*, is_repeated_*),
-- pra nenhuma delas depender do privilégio padrão do Postgres pra estar
-- segura. Nenhuma delas precisa ser RPC pública -- só chamadas internamente
-- (por handle_new_user ou por outra função desta mesma migration).
revoke all on function public.trial_fingerprint(text, text) from public, anon, authenticated;
revoke all on function public.trial_validate_document(text) from public, anon, authenticated;
revoke all on function public.trial_validate_cpf(text) from public, anon, authenticated;
revoke all on function public.trial_validate_cnpj(text) from public, anon, authenticated;
revoke all on function public.trial_normalize_document(text) from public, anon, authenticated;
revoke all on function public.trial_normalize_email(text) from public, anon, authenticated;
revoke all on function public.trial_is_repeated_digit_sequence(text) from public, anon, authenticated;

-- Tabelas novas: RLS habilitada + zero policies já fecha tudo pra
-- anon/authenticated (mesmo padrão de trial_history desde a migration 0031,
-- nunca desafiado) -- REVOKE de privilégio de tabela é redundante com isso,
-- mas explícito mesmo assim, pelo mesmo motivo acima (não depender só do
-- default). service_role continua com bypassrls por natureza do papel (igual
-- todo o resto do projeto que usa o client admin) -- não é uma exposição
-- nova, é o mesmo nível de confiança já usado pra API pública.
revoke all on table public.trial_history from public, anon, authenticated;
revoke all on table public.trial_identity_secret from public, anon, authenticated;

-- ============================================================================
-- handle_new_user() -- evolui a versão da migration 0031. Único trecho novo:
-- o bloco de trial (documento -> também exige e-mail; INSERT direto com
-- catch de unique_violation em vez de SELECT EXISTS + INSERT separados --
-- fecha a corrida concorrente da versão anterior, onde duas requisições
-- simultâneas com o mesmo documento podiam passar pelo EXISTS antes de
-- qualquer uma delas inserir). Resto da função (criação de company/profile,
-- pulo para usuário convidado) idêntico à 0031.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_plan_id uuid;
  v_company_name text;
  v_user_name text;
  v_city text;
  v_cnpj text;
  v_terms_accepted boolean;
  v_document_digits text;
  v_email_normalized text;
  v_document_fp text;
  v_email_fp text;
  v_trial_until timestamptz;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  if nullif(new.raw_user_meta_data->>'invited_to_company_id', '') is not null then
    return new;
  end if;

  v_company_name := coalesce(nullif(new.raw_user_meta_data->>'company', ''), 'Minha empresa');
  v_user_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);
  v_city := nullif(new.raw_user_meta_data->>'city', '');
  v_cnpj := nullif(new.raw_user_meta_data->>'cnpj', '');
  v_terms_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);

  insert into public.companies (name, city, cnpj) values (v_company_name, v_city, v_cnpj) returning id into v_company_id;

  insert into public.profiles (id, company_id, role, name, email, terms_accepted_at)
  values (new.id, v_company_id, 'company_admin', v_user_name, new.email, case when v_terms_accepted then now() else null end);

  select id into v_plan_id from public.plans where code = 'profissional';
  if v_plan_id is not null then
    -- documento: recalculado aqui a partir do dado BRUTO da metadata (nunca
    -- confia num fingerprint pronto). e-mail: SEMPRE new.email (auth.users,
    -- o e-mail de verdade da conta) -- nunca da metadata, que é
    -- livremente escolhida por quem chama auth.signup.
    v_document_digits := public.trial_normalize_document(v_cnpj);
    v_email_normalized := public.trial_normalize_email(new.email);

    if v_document_digits is null or not public.trial_validate_document(v_document_digits) or v_email_normalized is null then
      -- documento ausente/inválido (não deveria acontecer -- campo
      -- obrigatório e validado na tela, mas o endpoint público do Supabase
      -- pode ser chamado direto, ignorando o Server Action) ou sem e-mail
      -- (não deveria acontecer nunca -- auth.users sempre tem e-mail neste
      -- fluxo) -- sem trial, direto pro "vencido" (mesmo efeito que
      -- getSubscriptionStatus já trata hoje).
      v_trial_until := now();
    else
      v_document_fp := public.trial_fingerprint('trial:document:v1:', v_document_digits);
      v_email_fp := public.trial_fingerprint('trial:email:v1:', v_email_normalized);

      if v_document_fp is null or v_email_fp is null then
        -- TRIAL_IDENTITY_PEPPER ainda não configurado em produção -- sem
        -- trial (fail-closed no benefício), mas a conta é criada
        -- normalmente do mesmo jeito.
        v_trial_until := now();
      else
        begin
          -- INSERT direto, sem SELECT antes -- a garantia de "só uma
          -- identidade ganha o trial" vem do unique index de cada coluna,
          -- não de timing da aplicação. Duas ativações concorrentes com o
          -- mesmo documento (e-mails diferentes) ou o mesmo e-mail
          -- (documentos diferentes): a segunda sempre bate no
          -- unique_violation, mesmo que as duas leituras anteriores
          -- tivessem visto "documento livre".
          --
          -- ACHADO DA REVISÃO PRÉ-DEPLOY (confirmado por leitura, não só
          -- suposição): este bloco begin/exception envolve SÓ este INSERT --
          -- nenhuma outra instrução deste trigger (insert de company,
          -- profile, subscription) está dentro dele. Em PL/pgSQL o escopo de
          -- um EXCEPTION é estritamente as instruções literalmente dentro do
          -- próprio bloco, então um unique_violation capturado aqui só pode
          -- vir desta linha -- não existe caminho pra um conflito em
          -- profiles/companies/subscriptions (ou qualquer outra tabela) ser
          -- confundido com "trial já usado".
          insert into public.trial_history (document_fingerprint, email_fingerprint)
          values (v_document_fp, v_email_fp);
          v_trial_until := now() + interval '7 days';
        exception
          when unique_violation then
            v_trial_until := now();
        end;
      end if;
    end if;

    insert into public.subscriptions (company_id, plan_id, status, paid_until)
    values (v_company_id, v_plan_id, 'ativa', v_trial_until);
  end if;

  return new;
end;
$$;

-- Documentando a intenção explicitamente, mesmo sendo redundante: funções
-- que `returns trigger` (esta e as três novas de tours na migration 0044) já
-- são estruturalmente impossíveis de chamar via RPC direto -- o Postgres
-- recusa `SELECT`/PostgREST `/rpc/...` nelas fora de contexto de gatilho,
-- com ou sem GRANT. Revogado mesmo assim, mesmo raciocínio do resto desta
-- seção: nenhuma função nova depende do privilégio padrão do Postgres pra
-- estar segura.
revoke all on function public.handle_new_user() from public, anon, authenticated;
