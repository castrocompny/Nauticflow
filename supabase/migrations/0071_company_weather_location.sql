-- ============================================================================
-- CONDIÇÕES DO VENTO -- Etapa 1 (só informativo, ver DOCUMENTACAO.md).
--
-- INSPEÇÃO FEITA ANTES desta migration (pedido explícito, não presumido):
-- `public.companies` (0000_init_schema.sql) tem só `id, name, cnpj, city,
-- phone, email, created_at` -- NENHUM campo de latitude/longitude.
-- `public.tours` tem `boarding_latitude`/`boarding_longitude` (0039), mas
-- são coordenadas do PONTO DE EMBARQUE DE UM PASSEIO específico, não da
-- empresa -- uma empresa pode ter vários passeios com pontos de embarque
-- diferentes (praias/píeres distintos), ou nenhum passeio cadastrado ainda.
-- Reaproveitar `boarding_latitude` de "algum" passeio pra representar "a
-- localização da empresa" seria ambíguo e frágil (qual passeio? e se não
-- houver nenhum?). Não existe, portanto, nenhuma estrutura adequada
-- reaproveitável para uma localização de REFERÊNCIA da empresa (única,
-- estável, independente de ter passeio cadastrado) -- migration nova e
-- mínima, exatamente como a instrução previa para este caso.
--
-- Por que company-scoped e não geolocalização do navegador: o operador
-- pode acessar o NauticFlow de casa/escritório enquanto a operação
-- acontece em outro lugar (ex.: Búzios) -- o vento relevante é o de onde
-- as embarcações operam, não de onde o navegador está.
-- ============================================================================

alter table public.companies
  add column if not exists weather_latitude numeric(9, 6),
  add column if not exists weather_longitude numeric(9, 6),
  add column if not exists weather_location_name text;

alter table public.companies
  add constraint companies_weather_latitude_check
    check (weather_latitude is null or (weather_latitude between -90 and 90)),
  add constraint companies_weather_longitude_check
    check (weather_longitude is null or (weather_longitude between -180 and 180));

comment on column public.companies.weather_latitude is
  'Latitude de referência pra consultar condições do vento (Dashboard) -- independente de boarding_latitude de qualquer passeio específico. NULL = empresa ainda não configurou.';
comment on column public.companies.weather_longitude is
  'Longitude de referência pra condições do vento. Ver weather_latitude.';
comment on column public.companies.weather_location_name is
  'Nome de exibição da localização de referência (ex.: "Búzios") -- só rótulo, nunca usado pra geocodificar nem validado contra weather_latitude/longitude.';

-- Nenhuma policy nova necessária: "propria empresa - update" (0000, for
-- update to authenticated using/with check id = current_company_id()) já
-- é uma policy de LINHA, cobre automaticamente colunas novas da mesma
-- tabela -- mesmo mecanismo que já deixa updateSettings() (configuracoes/
-- actions.ts) editar name/cnpj/city/phone hoje, sem GRANT nem policy
-- extra nenhuma.
