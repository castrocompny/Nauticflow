# Testes de banco (pgTAP) -- ensaio local isolado

Os testes de `database/` rodam só num Postgres local descartável. Nada aqui
valida produção, staging ou um projeto Supabase novo.

## `setup/` não é migration de produto

`setup/service_role_platform_grants.sql` existe só para o ensaio local. Nunca
copie esse arquivo para `supabase/migrations/` do repositório e nunca o aplique
em ambiente remoto.

Ele existe porque nenhuma migration concede ao `service_role` privilégios em
`payments`, `marketplace_withdrawals`, `processed_webhook_events` e
`subscriptions`: esses privilégios vêm dos default privileges da plataforma
(a 0053 concede SELECT só no ledger). A imagem local recente dá ao
`service_role` apenas `Dxtm` (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) em tabelas
criadas por `postgres`. Passar com o bootstrap prova só que a chain funciona
quando esses privilégios existem; não prova que um ambiente qualquer os tenha.

## Lacunas da chain

As migrations 0083–0088 não constam neste checkout; a origem dessa lacuna não
foi determinada.
O ensaio aplica 0001–0082 e 0089. A 0090 foi aplicada sozinha, depois, só no
laboratório offline `nf-bootstrap-offline-a01` (2026-10-29); desde então esse
banco não tem mais o schema das rodadas anteriores. Na rodada 2 os objetos da
0090 ali existentes foram atualizados por script local registrado (colunas
`*_class`, checks, chave de agrupamento e função), não pela reaplicação do
arquivo. `0000b_*`/`0000c_*` são puladas pelo CLI
(nome fora do padrão).

## 0090 em laboratório novo (`nf-0090-fresh-20261029-a01`, 2026-10-29)

Pré-requisitos aplicados do zero, em banco novo e isolado (sem rede, sem
portas): migrations do Auth e do Storage pelas próprias imagens, uma vez;
`revoke-api-privileges.sql` (ordem inferida); as 82 migrations do checkout;
`setup/service_role_platform_grants.sql`; a 0090 inteira (rc 0).

- Primeira rodada: FAIL, 59/60 na suíte da 0090. O teste 45 procurava `bad`,
  `chave@` e `aaaa…` no JSON da linha inteira, e um UUID aleatório terminado
  em `…a4bade` casou com `%bad%`. Falso positivo do teste, não da migration.
- Correção (só no teste): o predicado olha apenas `event_key`,
  `notification_id` e `provider_transfer_id`, comparando com os valores exatos
  que as fixtures enviam como inválidos/excessivos. Três controles novos
  (UUID com `bad`, identificadores aceitos com `bad`, um vazamento plantado em
  cada campo); plano 60 → 63.
- Rodada oficial seguinte: PASS 63/63 (0090), 18/18, 22/22, 40/40 e 17/17.
  Corpo da RPC (md5 `aae74be0daa44c7d31c03241e1c47fd6`), catálogo e contagens
  iguais antes e depois; a 0090 não mudou.
- O FAIL e o diagnóstico ficam preservados junto do PASS nas evidências do
  laboratório.
- Evidências da rodada aprovada:
  `D:/Projetos/_recovery/nf-0090-fresh-20261029-a01/round-t45-20261029T182603Z-afdc72eb/`.
- Encerramento registrado naquela execução: `pg_ctl stop -m fast -w` como
  `postgres` (`stop.txt`; o rc 137 do `docker exec` veio do container parar
  com o exec aberto); o log contém `received fast shutdown request` e
  `database system is shut down`; estado final do container `exited`, exit 0,
  sem OOM. Container `nf-0090-fresh-20261029-a01-db` e volume
  `nf-0090-fresh-20261029-a01-pgdata` preservados (nenhuma remoção;
  `final-resources.txt` lista os containers, o volume consta montado em
  `preflight.txt`).

Aquele laboratório prova só o banco local: não cobre HTTP/PostgREST, a rota, o
Asaas nem equivalência com o Supabase remoto (a rota com PostgREST real está na
seção seguinte).

## Prova local real da rota com PostgREST (`nf-0090-pgrst-…-990d319d`, 2026-10-30 UTC)

Resultado registrado: **PASS** (funcional e encerramento). Evidências:
`D:/Projetos/_recovery/nf-0090-pgrst-20261030T010017Z-990d319d/`
(`MANIFEST.sha256`, 389 arquivos, sha256
`73345af7b9d96f0471c85fb8a0e713c9269b4de85cd934aebdc3c7e524ba492e`; exclui
`creds/`). Executado LOCALMENTE, com dados e credenciais fictícios; nada
alcançou Asaas, produção, staging ou dinheiro.

O que roda de verdade: `POST()` da rota do commit `184f453` (route.ts sha256
`41ebef80…`) chamado diretamente com `Request` real → SDK
`@supabase/supabase-js` → HTTP → PostgREST 16.1 → PostgreSQL 17.6. Substituídos
só `security-log` (registro local) e `verifyAsaasPaymentSettled`/
`revalidatePath` (falham se chamados; nenhuma chamada). Um adaptador de `fetch`
aceita só a origem do PostgREST novo e remove `/rest/v1` (papel do Kong, **não
testado**). Não é E2E do Next.js: não prova HTTP de entrada, roteamento,
build nem deploy.

Preparação:
- 85 arquivos SQL com rc 0: `revoke-api-privileges.sql`, chain de 82
  migrations conferida contra o HEAD, `setup/service_role_platform_grants.sql`
  (grants de plataforma só de teste) e a 0090 aplicada uma única vez. Migradores
  de Auth e Storage uma vez cada. Corpo da RPC da 0090: md5
  `aae74be0daa44c7d31c03241e1c47fd6`.
- `pg_hba` só do banco novo: linha `local all authenticator scram-sha-256`
  (o container do Postgres não tem usuário `postgrest` para o mapa `peer`);
  original preservado no container. O PostgREST autentica por senha pelo socket.
- Ajuste registrado: o primeiro `docker create` do banco falhou com acesso
  negado ao arquivo de credencial do próprio laboratório (restrição de ACL);
  depois da correção da ACL desses arquivos o create passou (`logs/create.txt`).
  O detalhe dos comandos de ACL não está nos artefatos do laboratório.

Isolamento (`gate/GATE.txt`, antes de qualquer migration do produto):
PostgreSQL sem rede; PostgREST e executor em rede nova `internal`, sem portas
publicadas; sem `docker.sock` nem credenciais reais montadas. Controle positivo:
HTTP 200 do PostgREST novo dentro da rede interna. Controle negativo: TCP direto
(não a guarda de `fetch`) da rede interna para um alvo local exclusivo deu
`ENETUNREACH`, e o mesmo alvo respondeu 200 pela rede dele. Sem rota padrão na
rede interna. O DNS embutido do Docker não foi exercitado: não é prova
universal de isolamento.

Entregas (uma chamada `POST` cada, mesmo corpo `TRANSFER_FAILED` para saque
fictício `completed`):
- **A, sem política:** 0089 respondeu HTTP 400 `P0001`
  `TERMINAL_OUTCOME_CONFLICT`; captura `P0001` `CONFLICT_CAPTURE_POLICY_MISSING`;
  rota 422/corpo preservados, log de recusa, nada capturado.
- **B, política de laboratório** (capacidade 5, janela de 365 dias): resposta
  financeira antes do envio da captura; `recorded`, UUID, contagem 1,
  argumentos exatos; fotografia `single`/`both`/`completed` visível em sessão
  observadora independente; janela com 1 vaga.
- **C, repetição:** `repeated`, mesmo UUID, contagem 2; só `occurrence_count`
  e `last_observed_at` mudaram; fotografia inicial e vaga preservadas.
- Nas três: saque, ledger e marcas iguais ao baseline; marca da tentativa
  FAILED ausente; nenhum destino fora da allowlist.

Exercitou só `TERMINAL_OUTCOME_CONFLICT` e a recusa por política ausente; não
generalizar para os outros códigos. Fora desta prova: timeout/queda reais (o
abort do cliente não prova cancelamento no banco), pré-checagem real,
capacidade esgotada, Kong, Next.js. Política e credenciais do laboratório não
são configuração de produção.

Encerramento registrado: PostgREST e alvo negativo por SIGTERM (exit 0, sem
OOM); PostgreSQL por `pg_ctl stop -m fast -w` como `postgres`, log com
`database system is shut down`, container exit 0, sem OOM (o rc 137 do
`docker exec` é separado do exit do container). Artefatos finais: 12
containers encerrados, 2 volumes e 2 redes preservados; recursos preexistentes
inalterados.

## Build Next.js local do commit `0426a46` (`nf-next-build-net-…-fec37981`, 2026-11-01 UTC)

As provas acima (Vitest com mocks e a rota com PostgREST) **não executaram o
build**; isso continua verdadeiro para elas. O build foi executado depois,
nesta rodada separada. Resultado registrado: **BUILD PASS LOCAL**. Evidências:
`D:/Projetos/_recovery/nf-next-build-net-20261101T193119Z-fec37981/`
(`SHA256SUMS`, 70 arquivos, sha256
`2abfde554b4ed3949c4487005593435d430c44bb7cbe7bcf6517962a0768d296`). A rodada
anterior, bloqueada por Engine parado, está em
`nf-next-build-net-20261101T192537Z-66709870/`.

Fonte e dependências:
- Commit `0426a46fb288eeb1946e7f23551c7dc0c70efbe6`. 226 arquivos selecionados
  (`src`, `public`, configs do Next/Tailwind/PostCSS/TS/Sentry e
  `vitest.config.ts`; sem `.env*`, `.serena`, `supabase/`, `.next` ou
  tsbuildinfo), 226/226 iguais aos blobs do commit. `package.json` `94e712c2…`
  e `package-lock.json` `c4533bc64eba890d784d5a3861d0d7874faba59098540ac43164797dddb07717`
  (blob LF), inalterado após a instalação.
- Ajuste registrado: o primeiro `git archive` saiu com CRLF por
  `core.autocrlf=true` do gitconfig do sistema; foi rejeitado (preservado como
  `REJECTED-crlf-…`) e refeito com `-c core.autocrlf=false` (tar
  `1d8000cdf7817feb616bab3e5c3e262be06c441de0993b237a254773a4306ab7`, LF)
  antes do build.
- Imagem em cache `postgres-meta:v0.97.0`, ID
  `sha256:e7da2ab376a7ff7b1e0c8dc98176dddab1f3646dded244d74e26c4e50a1d58c2`,
  `--pull never`. Runtime medido: Node 22.23.2, npm 10.9.8, Linux x64, glibc 2.36.
- `npm ci --ignore-scripts --no-audit --no-fund`: rc 0, 573 pacotes, lockfile
  preservado, bindings GNU confirmados (`@next/swc-linux-x64-gnu` 16.3.6,
  sharp, lightningcss, rolldown).

Build (`npm run build`): Next 16.3.6/Turbopack, rc 0, sem OOM; compilação e
verificação TypeScript concluídas; `.next` ausente antes da execução e
artefatos com horário dentro da janela do build. `BUILD_ID`
`rKqwMfItH6YYn6vFDdYOU`. A rota `/api/webhooks/asaas` consta nos quatro
manifestos exportados (`app-path-routes-manifest.json`,
`server/app-paths-manifest.json`,
`server/app/api/webhooks/asaas/route/app-paths-manifest.json`,
`routes-manifest.json`) e no arquivo compilado
`server/app/api/webhooks/asaas/route.js` (sha256
`528cc02e369a03a1d5b08f45f3ccb7d7ce05edf5f6fd2926d6c73166636a5ef5`); cópias
em `ev/artifacts/`. No ambiente só havia dois valores Supabase fictícios
(`*.invalid`), `NEXT_TELEMETRY_DISABLED=1` e o proxy; sem credenciais reais
nem token Sentry.

Isolamento:
- executor em rede `internal` nova, sem rota padrão, sem portas publicadas e
  sem socket Docker;
- proxy CONNECT próprio, em container separado do build, com política por fase
  (nome e porta exatos antes de resolver, recusa de IP literal e de endereço
  resolvido não público, TLS sem interceptação);
- instalação: somente `registry.npmjs.org:443`; build: somente
  `fonts.googleapis.com:443` e `fonts.gstatic.com:443`;
- DNS do executor direcionado a um sink local (NXDOMAIN, sem encaminhamento);
- controles positivos e negativos registrados em `ev/12-gate-prep.jsonl` e
  `ev/18-gate-build.jsonl`. O autoteste do classificador do proxy deu FAIL na
  primeira execução (bug do próprio script do laboratório), foi corrigido e
  retestado com PASS antes de qualquer uso. Não é prova de isolamento
  universal: conexão direta a IP literal falha por falta de rota, mas não fica
  registrada.
- Exceção de permissão: `NET_BIND_SERVICE` acrescentada só ao auxiliar de DNS
  novo, para escutar na porta 53.

Ressalvas: 36 diagnósticos `DYNAMIC_SERVER_USAGE` (uso de `cookies`) não
impediram o build, e a tabela final classifica essas rotas como dinâmicas.
Durante o build houve duas consultas DNS a `o1.ingest.sentry.io`, respondidas
com NXDOMAIN, sem conexão. Presença nos manifestos não é teste HTTP: nenhum
`next start`, requisição de entrada, Kong, deploy ou webhook. Vitest/pgTAP não
foram rodados nesta rodada, e este PASS não se estende a eles.

Encerramento: serviços por SIGTERM (exit 0) e executores de execução única
terminados sozinhos. Preservados os 20 containers `nfnb-fec37981-*`, o volume
`nfnb-fec37981-work` e as 2 redes. O inventário final registrou os sete
containers preexistentes ativos; isso não atesta imutabilidade dos dados
nem ausência de atividade nessas stacks.

## Prova HTTP mínima de entrada e roteamento (`nf-next-http-…-7e830e47`, 2026-11-01 UTC)

Resultado registrado: **PASS**, só para HTTP/roteamento e para os ramos não
financeiros exercitados. Executado em 2026-11-01 UTC com o worktree em HEAD
`93b15db`. O artefato executado é o build do `0426a46` (seção anterior),
reaproveitado sem rebuild; os insumos do build são idênticos entre `0426a46` e
`93b15db`. `BUILD_ID` `rKqwMfItH6YYn6vFDdYOU`, Next 16.3.6. Evidências:
`D:/Projetos/_recovery/nf-next-http-20261101T203310Z-7e830e47/` (`SHA256SUMS`,
55 arquivos conferidos, sha256
`27b0d5016ab956b01145fc6efc49691a1a2b3ffd427ea4a2056c0c52d204346e`).

Caminho exercitado: cliente HTTP (Node core, sem cookies, sem seguir
redirects) → `npm run start` (`next start`, produção) → proxy → route module →
handler. Isso vale só para os casos abaixo.

Artefatos e cópia:
- 27 checks de artefatos registrados como positivos (`ev/05-gateb.jsonl`),
  feitos com o volume do build montado só para leitura. O proxy compilado é
  `.next/server/middleware.js`, registrado como `/_middleware` de runtime
  `nodejs`. O literal Supabase fictício está nas chamadas compiladas do proxy
  e da rota, e `ASAAS_WEBHOOK_TOKEN` é lido em runtime.
- Completude registrada: 644 referências de chunks em 100 stubs, sem arquivos
  faltantes; a contagem não significa 644 chunks únicos.
- Ressalva metodológica: o check `proxy:getUser-call-present` só procura a
  string `getUser`, e o trecho registrado é uma mensagem do SDK, não o ponto
  de chamada `auth.getUser()`. Não é prova independente da chamada nem de
  execução do Auth. O comportamento do proxy é demonstrado pelas respostas
  HTTP. Não houve teste de Auth com sessão.
- Cópia para o volume novo `nfnh-7e830e47-run`, de onde o servidor executou.
  Manifesto de conteúdo da árvore `/app` (inclusive `node_modules` e `.next`):
  40.491 arquivos, 44 links (alvos registrados sem seguir, nenhum fora da
  raiz) e 4.121 diretórios, sha256
  `6d9f5e9a88ce58016882389b0a9f82759a0f38d3bcc68d77e01c0e3086cdef02`.
  Original e cópia são idênticos antes e depois da execução; 226/226 fontes e
  o lockfile conferem. A comparação cobre só essa árvore `/app`, não o volume
  inteiro.

Isolamento (14 checks de rede positivos, `ev/12-gates-eval.jsonl`):
- rede nova `nfnh-7e830e47-int`, `internal`, sem saída, sem proxy, sem portas
  publicadas e sem socket Docker;
- cliente e servidor registraram ausência de rota padrão e IPv6 desligado;
- TEST-NET:443 e gateway:80 foram sondados nos dois (`ENETUNREACH` e
  `EHOSTUNREACH`); gateway:53 foi sondado só pelo cliente;
- DNS do cliente e do servidor direcionado a um sink local (NXDOMAIN, sem
  encaminhamento). Exceção de permissão: `NET_BIND_SERVICE` só no sink, para
  a porta 53;
- consultas DNS: 0 no startup, 5 nos gates (todas com prefixo
  `nf-lab-gate-`), 0 durante a matriz e 0 depois dela.
- Ausência de DNS, isoladamente, não comprova ausência universal de
  conexões; considerar também os controles de rede registrados.

Falha de preparação registrada: a primeira subida do servidor saiu com exit 1
porque o npm recusou `/dev/null` usado ao mesmo tempo como `userconfig` e
`globalconfig` ("double-loading config"). Isso ocorreu antes do Next iniciar,
sem nenhuma requisição HTTP e sem consulta DNS. Foi corrigido com dois
arquivos npmrc vazios e distintos, num container novo.

Matriz (`ev/13-matrix.jsonl`, rc 0): **15 casos obrigatórios aprovados**,
mais o caso K opcional aprovado.
- 401 para token ausente ou incorreto (mesmo tamanho e tamanho diferente),
  inclusive com JSON inválido sem token (autenticação antes do parse);
- 200 `{"ok":true}` para os ramos não financeiros previstos (`{}` e o
  marcador de laboratório `NF_LAB_NOT_AN_EVENT`, que não é evento do Asaas);
- JSON inválido com token correto também retorna 200. É o comportamento atual
  observado, não uma recomendação de contrato;
- 405, com corpo vazio e sem `Allow`, para GET, PUT, PATCH, DELETE e HEAD;
- OPTIONS 204, com `Allow: OPTIONS, POST`;
- 404 para webhook inexistente;
- 307 para `/login` em caminho protegido;
- K opcional: 308 para a barra final.

Nenhum `Cookie` enviado e nenhum `Set-Cookie` recebido. Os seis cabeçalhos de
segurança estão presentes nas 15 respostas obrigatórias. Observação: o 308
opcional veio sem esses seis cabeçalhos; fica registrado como observação, não
como correção feita. O Sentry estava desabilitado, então os logs do handler
não foram observáveis.

Encerramento: o sink de DNS saiu com exit 0. O servidor saiu com exit 143
após SIGTERM, sem OOM; isso não é prova de shutdown gracioso. Os dez
containers novos estão parados, e o volume, a rede e as evidências estão
preservados. O inventário final registrou os sete containers preexistentes
ativos, o que não comprova imutabilidade dos dados deles.

Alcance: não prova a integração HTTP completa conflito→captura da 0090, nem
banco, PostgREST, Auth com sessão, Kong, TLS/CDN/Vercel, reenvio do Asaas,
eventos financeiros ou produção. Vitest, pgTAP, typecheck, lint e build não
foram repetidos nesta rodada.

## Laboratório preservado -- não tocar

O ensaio de 2026-10-26 usou `D:/Projetos/_recovery/nf-pgtap-0089-20261026`
(`project_id` `nf-pgtap-0089-20261026`, portas 56322/56320). Esse diretório, o
container `supabase_db_nf-pgtap-0089-20261026` e os volumes
`supabase_*_nf-pgtap-0089-20261026` são evidência preservada. Este roteiro não
os reutiliza, não os reinicia, não os para e não os limpa.

## Escopo do roteiro

- Ensina **só** um ensaio novo e descartável. Não há reset, reutilização nem
  limpeza de laboratório existente. Para outro ensaio, escolha outro
  identificador (outro diretório, `project_id` e nomes); os anteriores ficam
  como estão.
- Tudo o que age está num **único bloco** (abaixo). Qualquer falha encerra o
  bloco antes da ação seguinte. A única finalização possível é parar o
  container cuja criação e identidade o próprio bloco comprovou.
- Se o bloco terminar com `PARE:`, não rode comandos manuais de recuperação:
  registre a mensagem e o estado, e recomece com outro identificador.

### Como o alvo Docker é fixado (e o que não está provado)

**Inferência, não fato comprovado.** A leitura estática do CLI instalado
(`node_modules/supabase/dist/supabase.js` e
`node_modules/@supabase/cli-windows-x64/bin/supabase.exe`, versão 2.114.0)
sugere que ele respeita `DOCKER_CONTEXT` em `db start` e `test db`: o wrapper
executa `supabase.exe`, a menos que `SUPABASE_CLI_BINARY_OVERRIDE` esteja
definida; o binário contém código que cria containers chamando o comando
`docker` e repassa `DOCKER_HOST`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`,
`DOCKER_CONTEXT`, `DOCKER_API_VERSION` e `DOCKER_CONFIG`, escolhendo o contexto
por `DOCKER_CONTEXT` e, na falta dela, pelo `currentContext` do `config.json`
do Docker, com `DOCKER_HOST` tendo precedência. O mesmo binário, porém, também
tem caminhos que encaminham comandos para `supabase-go.exe`, e a leitura não
determina qual caminho atende `db start` e `test db`. Não foi encontrada
evidência de que o CLI ignore o contexto, mas também não houve comprovação
operacional de que ele o respeite.

Por isso o bloco exige todas essas variáveis vazias, chama o CLI com
`DOCKER_CONTEXT` explícito e usa `docker --context` em todo comando Docker. A
conferência feita depois de `db start` -- o container novo precisa aparecer no
contexto validado, com a porta escolhida, ou o bloco para sem limpar -- pode
**detectar** uma divergência, mas **não impede** que o CLI já tenha criado
recursos em outro daemon.

**Execução não autorizada por este documento.** Rodar o roteiro exige
autorização específica e, antes dela, uma verificação operacional de que esta
versão do CLI direciona `db start` e `test db` ao endpoint validado (observando
também os demais daemons candidatos). A etapa que escreveu este texto não
autorizou nem fez essa execução.

## Bloco 0 -- identificadores (sem efeito colateral)

Shell esperado: **Git Bash** no Windows, na raiz do repositório. Troque o
identificador a cada ensaio; ele vira o nome do diretório e o `project_id`.

```sh
REPO="D:/Projetos/_recovery/nauticflow-asaas-main-20261023"
PARENT="D:/Projetos/_recovery"
PRESERVED_PID="nf-pgtap-0089-20261026"
PID="nf-pgtap-lab-AAAAMMDD-a"   # formato: nf-pgtap-lab-<8 dígitos>-<1 a 8 de [a-z0-9]>
DB_PORT=57322
SHADOW_PORT=57320
PG_VERSION="17.6.1.158"         # única fonte da versão: imagem inspecionada e versão gravada
DOCKER_CTX="desktop-linux"
DOCKER_ENDPOINT="npipe:////./pipe/dockerDesktopLinuxEngine"   # endpoint local esperado (Docker Desktop)
```

## Bloco único -- validar, criar, conferir, subir, testar, parar

```sh
(
set -euo pipefail
die() { echo "PARE: $*" >&2; exit 1; }
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# --- 1. identificadores e portas, antes de qualquer interpolação ---
printf '%s' "$PID" | grep -Eq '^nf-pgtap-lab-[0-9]{8}-[a-z0-9]{1,8}$' || die "PID fora do formato"
case "$PID" in *AAAAMMDD*) die "troque o identificador de exemplo";; esac
[ "$(lc "$PID")" != "$(lc "$PRESERVED_PID")" ] || die "PID é o laboratório preservado"
for p in "$DB_PORT" "$SHADOW_PORT"; do
  printf '%s' "$p" | grep -Eq '^[0-9]{4,5}$' || die "porta '$p' inválida"
  [ "$p" -ge 1024 ] && [ "$p" -le 65535 ] || die "porta $p fora de 1024-65535"
  case "$p" in 54320|54321|54322|54323|54324|54329|55621|55622|56320|56322) die "porta $p reservada";; esac
done
[ "$DB_PORT" != "$SHADOW_PORT" ] || die "portas iguais"
printf '%s' "$PG_VERSION" | grep -Eq '^[0-9]+(\.[0-9]+){3}$' || die "PG_VERSION inválida"
IMAGE="public.ecr.aws/supabase/postgres:$PG_VERSION"

# --- 2. ambiente: nada pode redirecionar Docker ou o CLI ---
for v in DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_API_VERSION \
         DOCKER_CONFIG SUPABASE_CLI_BINARY_OVERRIDE SUPABASE_SERVICES_HOSTNAME; do
  [ -z "${!v:-}" ] || die "variável $v definida; abra um shell sem ela"
done
[ "$(lc "$(pwd -W)")" = "$(lc "$REPO")" ] || die "rode da raiz do repositório"
[ -x ./node_modules/.bin/supabase ] || die "CLI local ausente (não instale aqui)"
dk() { docker --context "$DOCKER_CTX" "$@"; }
ep=$(docker context inspect "$DOCKER_CTX" --format '{{.Endpoints.docker.Host}}') \
  || die "contexto $DOCKER_CTX inexistente ou docker falhou"
[ "$ep" = "$DOCKER_ENDPOINT" ] || die "contexto $DOCKER_CTX aponta para '$ep'"
sb() { env DOCKER_CONTEXT="$DOCKER_CTX" ./node_modules/.bin/supabase "$@"; }

# --- 3. destino: filho direto de PARENT, inexistente, sem link/junction ---
[ -d "$PARENT" ] && [ ! -L "$PARENT" ] || die "PARENT ausente ou é link"
PARENT_CANON=$(cd -P "$PARENT" && pwd -W) || die "não resolvi PARENT"
[ "$(lc "$PARENT_CANON")" = "$(lc "$PARENT")" ] || die "PARENT resolve para '$PARENT_CANON'"
W="$PARENT_CANON/$PID"
listing=$(ls -A "$PARENT_CANON") || die "não listei PARENT"
if printf '%s\n' "$listing" | tr '[:upper:]' '[:lower:]' | grep -qxF -- "$(lc "$PID")"; then
  die "já existe '$PID' em PARENT (qualquer caixa) -- escolha outro identificador"
fi
[ ! -e "$W" ] && [ ! -L "$W" ] || die "destino $W existe"

# --- 4. Docker: imagem exata, nomes e portas livres no contexto validado ---
dk image inspect "$IMAGE" >/dev/null || die "imagem $IMAGE ausente do cache -- não baixe"
names=$(dk ps -a --format '{{.Names}}') || die "docker ps falhou"
if printf '%s\n' "$names" | grep -qiF -- "$PID"; then die "já há container com $PID"; fi
vols=$(dk volume ls --format '{{.Name}}') || die "docker volume ls falhou"
if printf '%s\n' "$vols" | grep -qiF -- "$PID"; then die "já há volume com $PID"; fi
ports=$(dk ps -a --format '{{.Ports}}') || die "docker ps (portas) falhou"
net=$(netstat -an) || die "netstat falhou"
for p in "$DB_PORT" "$SHADOW_PORT"; do
  if printf '%s\n' "$ports" | grep -qE "[:.]$p->"; then die "porta $p mapeada por container"; fi
  if printf '%s\n' "$net" | grep -qE "[:.]$p[[:space:]]"; then die "porta $p em uso no host"; fi
done

# --- 5. criar o laboratório novo (mkdir sem -p falha se existir) ---
mkdir "$W" || die "mkdir $W falhou"
W_CANON=$(cd -P "$W" && pwd -W) || die "não resolvi $W"
[ "$(lc "$W_CANON")" = "$(lc "$PARENT_CANON/$PID")" ] || die "destino resolve para '$W_CANON'"
mkdir "$W/supabase" "$W/supabase/.temp" || die "mkdir da estrutura falhou"
cp -r "$REPO/supabase/migrations" "$W/supabase/migrations" || die "cópia de migrations falhou"
cp -r "$REPO/supabase/tests" "$W/supabase/tests" || die "cópia de testes falhou"
cp "$REPO/supabase/tests/setup/service_role_platform_grants.sql" \
   "$W/supabase/migrations/99990_test_setup_service_role_platform_grants.sql" || die "cópia do bootstrap falhou"
printf '%s\n' "$PG_VERSION" > "$W/supabase/.temp/postgres-version" || die "postgres-version falhou"
sed -e "s/^project_id = \"Nauticflow\"\$/project_id = \"$PID\"/" \
    -e "s/^port = 54322\$/port = $DB_PORT/" \
    -e "s/^shadow_port = 54320\$/shadow_port = $SHADOW_PORT/" \
    "$REPO/supabase/config.toml" > "$W/supabase/config.toml" || die "geração do config falhou"
sed -i '/^\[db.seed\]/,/^\[/ s/^enabled = true$/enabled = false/' "$W/supabase/config.toml" || die "seed falhou"

# --- 6. conferir o que foi gravado, imediatamente antes de subir ---
C="$W/supabase/config.toml"
got=$(awk -F' = ' '/^project_id = /{gsub(/"/,"",$2); print $2; exit}' "$C")
[ "$got" = "$PID" ] || die "project_id gravado é '$got'"
got=$(awk '/^\[db\]$/{s=1;next} /^\[/{s=0} s&&/^port = /{print $3; exit}' "$C")
[ "$got" = "$DB_PORT" ] || die "[db].port gravado é '$got'"
got=$(awk '/^\[db\]$/{s=1;next} /^\[/{s=0} s&&/^shadow_port = /{print $3; exit}' "$C")
[ "$got" = "$SHADOW_PORT" ] || die "[db].shadow_port gravado é '$got'"
got=$(awk '/^\[db.seed\]$/{s=1;next} /^\[/{s=0} s&&/^enabled = /{print $3; exit}' "$C")
[ "$got" = "false" ] || die "[db.seed].enabled gravado é '$got'"
[ "$(cat "$W/supabase/.temp/postgres-version")" = "$PG_VERSION" ] || die "postgres-version divergente"
# só existência; o conteúdo nunca é lido
[ ! -e "$W/supabase/.temp/linked-project.json" ] || die "workdir vinculado a projeto remoto"
for d in migrations tests/database tests/setup; do
  for f in "$REPO/supabase/$d"/*.sql; do
    cmp -s "$f" "$W/supabase/$d/$(basename "$f")" || die "cópia divergente: $d/$(basename "$f")"
  done
done
extra=$(comm -13 <(ls "$REPO/supabase/migrations" | sort) <(ls "$W/supabase/migrations" | sort))
[ "$extra" = "99990_test_setup_service_role_platform_grants.sql" ] || die "migrations a mais: $extra"
names=$(dk ps -a --format '{{.Names}}') || die "docker ps falhou"
if printf '%s\n' "$names" | grep -qiF -- "$PID"; then die "container com $PID surgiu antes do start"; fi

# --- 7. subir só o Postgres e comprovar que o container é deste ensaio ---
sb db start --workdir "$W" || die "db start falhou; nada será parado -- relate o estado"
cid=$(dk ps -aq --filter "label=com.supabase.cli.project=$PID") || die "docker ps (label) falhou"
[ "$(printf '%s\n' "$cid" | grep -c .)" = "1" ] || die "não há exatamente 1 container de $PID no contexto validado; nada será parado"
cname=$(dk inspect --format '{{.Name}}' "$cid") || die "inspect falhou"
[ "$cname" = "/supabase_db_$PID" ] || die "container inesperado '$cname'; nada será parado"
dk port "$cid" 5432 | grep -qE "[:.]$DB_PORT\$" || die "container não publica $DB_PORT; nada será parado"

# --- 8. testar e parar só o container comprovado acima ---
rc=0
sb test db --local --workdir "$W" "$W/supabase/tests/database" || rc=$?
dk stop "$cid" >/dev/null || die "não consegui parar $cid; relate"
[ "$rc" = "0" ] || die "pgTAP falhou (rc=$rc); container $cid parado, volume e diretório preservados"
echo "OK: ensaio $PID concluído; container parado, volume e diretório preservados"
)
```

## O que os testes provam e o que não provam

- `has_*_privilege` = só ACL. `lives_ok`/`is` depois de `set local role
  service_role` = execução real daquele caminho sob o papel.
- As funções da 0089 rodam no papel da sessão de teste, não sob `service_role`.
- Corridas entre sessões (DONE x FAILED, mesmo transfer id em dois saques) não
  são exercitadas aqui; ver `offline/` abaixo.

## Laboratório offline da 0089 (`offline/`)

Runners para um Postgres **já preparado e já em execução** (chain + bootstrap
aplicados antes, fora do harness). O harness nunca cria, inicia, reseta, para
nem reaplica migrations/grants. Só fala com o alvo via `docker exec ... psql`.

- `run-sequential.sh <rótulo>=<arquivo.sql> ...` -- arquivos pgTAP em ordem;
  para na primeira falha. Ex.: os três de `database/` ligados à 0089 e
  `offline/sql/aux_0089_service_role.test.sql` (RPC chamada sob
  `service_role`, com controle negativo de INSERT direto no ledger).
- `run-concurrency.sh --scenarios a1,a2,b1,b2` -- duas sessões `psql`
  independentes (vencedor/perdedor, READ COMMITTED, `set local role
  service_role`, event_keys distintas) + observador owner. Exige ver o perdedor
  bloqueado pelo vencedor **no recurso esperado** (a: xid do vencedor + tuple em
  `marketplace_withdrawals`; b: advisory do transfer id) antes do commit, e o
  erro exato do perdedor (`TERMINAL_OUTCOME_CONFLICT` / `PROVIDER_TRANSFER_ID_MISMATCH`).
  Fixtures fictícias novas por execução (token aleatório) são **commitadas** no
  laboratório e preservadas.
- `--scenarios c1,c2` (0090, captura de conflitos): política singleton gravada
  com capacidade 1 e `window_seconds` único por execução/cenário (janela nova).
  O perdedor tem de esperar no advisory de duas chaves `(20038, 90)`
  (`objsubid=2`), espaço distinto do lock por transfer id da 0089. `c1`: grupos
  distintos, perdedor `CONFLICT_CAPTURE_CAPACITY_EXCEEDED` e rollback. `c2`:
  mesmo grupo, perdedor retorna `repeated|2` e faz commit; a janela continua com
  1 vaga usada. A política, as janelas e os registros ficam commitados no
  laboratório como fixture local; o pgTAP da 0090
  (`database/marketplace_transfer_conflict_capture.test.sql`) apaga esse estado
  só dentro da própria transação, revertida no fim.
- `--scenarios c3` (0090): uma sessão só. Saque fictício já `completed` por
  `TRANSFER_DONE` (fixture commitada); `TRANSFER_FAILED` na 0089 tem de dar
  `TERMINAL_OUTCOME_CONFLICT`; a captura na MESMA transação tem de ser recusada
  com `25P02`; o rollback tem de ser confirmado e o observador confirma saque,
  ledger e marcas inalterados e nada capturado; só então a captura roda numa
  transação nova e faz commit. Prova separação no banco, não integração
  HTTP/PostgREST nem reenvio do Asaas.

Alvo (todas obrigatórias; faltou uma, o runner recusa antes de agir):
`NF_LAB_CONTEXT`, `NF_LAB_ENDPOINT`, `NF_LAB_CONTAINER`, `NF_LAB_CONTAINER_ID`
(64 hex), `NF_LAB_VOLUME`, `NF_LAB_CONFIRM` (= repetição do ID, confirmação
explícita) e `NF_EVIDENCE_ROOT` (absoluto, existente, fora do repositório).
O runner recusa nome que resolva para outro ID, `network` diferente de `none`,
porta publicada, volume divergente e container parado.

Critérios de PASS (qualquer falha => `FAIL`; sinal => `INTERRUPTED`; exit != 0):
- arquivo pgTAP: cliente com exit 0 **e** TAP estrito (`lib/tapcheck.awk`:
  um plano antes dos testes, numeração exata, stderr vazio, nenhuma linha
  desconhecida, nenhum `not ok`/`Bail out!`/`# Looks like`; TODO/SKIP contados
  à parte e reprovam);
- nenhuma sessão desta execução restante;
- commit do vencedor, rollback do perdedor e consultas do observador
  confirmados;
- cada sessão concorrente: `wait` do processo local = 0, cliente com pid
  registrado e confirmado encerrado, rc do cliente = 0 (registrados em
  `sessions/index.txt`);
- toda evidência obrigatória gravada (diretórios, `obs/`, `provenance/`,
  hashes, rc dos testes, `run.log`, `RESULT`). Falha de gravação => `FAIL`. Se
  nem `RESULT` puder ser gravado: exit 3, diagnóstico em stderr e nenhum
  anúncio de resultado. O anúncio `RESULT: PASS` só sai depois de `RESULT` e
  `run.log` gravados.

Sessões residuais: a **detecção** usa os nomes desta execução (lista exata e
também o prefixo `nf0089-<token>-`, para pegar sessões que o runner não chegou a
registrar). O **encerramento** nunca usa prefixo: só atinge backend com pid +
`application_name` + `backend_start` registrados pela própria execução.
Encerrar é tentativa; só uma nova observação sem linhas confirma a limpeza (e a
execução continua `FAIL`). Se o observador falha, o estado fica registrado como
desconhecido.

Em erro ou sinal, o `trap` faz rollback confirmado de cada sessão aberta, fecha
descritores e espera os processos locais (prazo 10s). Se não terminarem, o
runner envia TERM e depois KILL só aos pids que registrou (cliente, depois o
processo local) e confere de novo. Isso não alcança descendentes do cliente nem
o `psql` dentro do container; para o servidor vale o encerramento de backend
acima.

Cobertura dos testes do harness quanto a sinais: **só SIGTERM** no runner de
concorrência (cliente simulado). SIGINT, sinais no runner sequencial e árvores
de descendentes não foram testados.

Cada execução cria `NF_EVIDENCE_ROOT/<seq|conc>-<UTC>-<token>/` (nunca
sobrescreve): `RESULT`, `run.log`, `provenance/` (versão e hashes do harness,
HEAD/status, hashes das fontes, migrations **disponíveis** -- não prova de
aplicação --, `applied-evidence.txt`, definições/owners/ACLs/grants,
identidade do laboratório), `obs/` (SQL exato, saída e rc de cada observação),
`tests/` e `sessions/`.

`applied-evidence.txt` compara o corpo (`prosrc`) de cada função da 0089 no
catálogo com o arquivo da **worktree** (linha `SOURCE`: sha256, HEAD e se a
migration difere do HEAD). `MATCH` exige exatamente uma função com o nome, no
schema `public` (com ou sem `public.` no `regprocedure`), com a assinatura
esperada e o mesmo md5. Owner/ACL ficam em linhas `RECORDED`: são registrados,
não comparados. A linha `HISTORY` lembra que isso não prova o histórico de
aplicação nem os demais comandos da migration.

Testes do harness (sem banco; cliente simulado):
`HARNESS_TEST_WORK=<dir novo> offline/harness-tests/run-harness-tests.sh all`
(grupos `tap`, `seq`, `conc`, `evid`, `close`, `catalog`; `conc` inclui `c1`/`c2`
e um caso em que o perdedor espera em outro advisory, que precisa reprovar; e
`c3` com dois negativos: captura aceita na transação abortada e rollback não
confirmado, ambos precisam reprovar).
`catalog_capture` continua comparando só as funções da 0089; a 0090 entra em
`sources.sha256` e a comparação do corpo dela fica nas evidências da rodada. `evid` injeta falha
de gravação plantando um diretório no caminho de destino dentro do run
descartável do teste (não enche disco nem muda permissões). `catalog` roda o
`catalog_capture` real contra a migration da worktree, só com o observador
substituído. O grupo `legacy` reproduz os defeitos do runner histórico de
2026-10-28 numa cópia e **deve falhar**. Os grupos `evid`, `close` e `catalog`
foram vistos falhar antes da correção. Nem todo caminho dos demais grupos tem
registro RED comportamental: algumas falhas registradas antes ocorreram só
porque o arquivo ainda não existia.

Limites: inventário igual demonstra igualdade dos campos registrados, não
ausência de mudança em dados/volumes; fixtures inserem saques direto (sem saldo
real); nada disto valida produção, grants remotos ou o Asaas.
