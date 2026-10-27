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

As migrations 0083–0088 originais foram perdidas e não existem no repositório.
O ensaio aplica 0001–0082 e 0089. `0000b_*`/`0000c_*` são puladas pelo CLI
(nome fora do padrão).

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
  são exercitadas aqui.
