# Biblioteca comum dos runners offline da 0089. Fonte via `source`.
# Não cria, inicia, reseta nem para banco/container: só usa um alvo já ativo,
# identificado e confirmado explicitamente (ver supabase/tests/README.md).
HARNESS_VERSION=2
H=${H:?}
REPO=$(git -C "$H" rev-parse --show-toplevel 2>/dev/null) || { echo "PARE: $H não está num repositório git" >&2; exit 2; }
TAPCHECK="$H/lib/tapcheck.awk"
FAILED= INTERRUPTED= STATUS= RUN= TOK= RUN_ID=
REASONS=()

usage_die() { echo "uso inválido: $1" >&2; [ -n "${USAGE:-}" ] && echo "$USAGE" >&2; exit 2; }
# run.log é evidência obrigatória: falha de gravação reprova a execução
log() {
  echo "$*"; [ -n "$RUN" ] || return 0
  echo "$*" >> "$RUN/run.log" || { FAILED=1; REASONS+=("evidência não gravada: run.log"); echo "FAIL: run.log não gravável" >&2; }
}
fail() { FAILED=1; REASONS+=("$*"); log "FAIL: $*"; }
nowrite() { fail "evidência não gravada: $1"; return 1; }
abspath() { case "$1" in /*|[A-Za-z]:[/\\]*) return 0 ;; esac; return 1; }

# ---- contrato de configuração: validado antes de qualquer ação --------------
config_validate() {
  local v
  [ -n "${NF_EVIDENCE_ROOT:-}" ] || usage_die "NF_EVIDENCE_ROOT não definido"
  abspath "$NF_EVIDENCE_ROOT" || usage_die "NF_EVIDENCE_ROOT deve ser absoluto"
  [ -d "$NF_EVIDENCE_ROOT" ] || usage_die "NF_EVIDENCE_ROOT não existe: $NF_EVIDENCE_ROOT"
  local root repo; root=$(cd "$NF_EVIDENCE_ROOT" && pwd -P); repo=$(cd "$REPO" && pwd -P)
  case "$root/" in "$repo"/*) usage_die "NF_EVIDENCE_ROOT não pode ficar dentro do repositório" ;; esac
  if [ "${NF_HARNESS_SIMULATE:-}" = 1 ]; then
    [ -n "${NF_SIM_CLIENT:-}" ] && [ -f "$NF_SIM_CLIENT" ] || usage_die "simulação exige NF_SIM_CLIENT (arquivo)"
    for v in NF_LAB_CONTEXT NF_LAB_ENDPOINT NF_LAB_CONTAINER NF_LAB_CONTAINER_ID NF_LAB_VOLUME NF_LAB_CONFIRM; do
      [ -z "${!v:-}" ] || usage_die "alvo ambíguo: simulação com $v definido"
    done
    MODE=simulated
  else
    [ -z "${NF_HARNESS_SIMULATE:-}" ] || usage_die "NF_HARNESS_SIMULATE só aceita 1"
    [ -z "${NF_SIM_CLIENT:-}" ] || usage_die "alvo ambíguo: NF_SIM_CLIENT fora de simulação"
    for v in NF_LAB_CONTEXT NF_LAB_ENDPOINT NF_LAB_CONTAINER NF_LAB_CONTAINER_ID NF_LAB_VOLUME NF_LAB_CONFIRM; do
      [ -n "${!v:-}" ] || usage_die "alvo real exige $v"
    done
    [[ "$NF_LAB_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] || usage_die "NF_LAB_CONTAINER_ID deve ser o ID completo (64 hex)"
    [ "$NF_LAB_CONFIRM" = "$NF_LAB_CONTAINER_ID" ] || usage_die "NF_LAB_CONFIRM deve repetir NF_LAB_CONTAINER_ID (confirmação explícita do laboratório)"
    MODE=real
  fi
}

# ---- diretório de evidências novo por execução ------------------------------
run_dir_create() {
  TOK=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  [[ "$TOK" =~ ^[0-9a-f]{8}$ ]] || { echo "PARE: token aleatório inválido" >&2; exit 2; }
  RUN_ID="$1-$(date -u +%Y%m%dT%H%M%SZ)-$TOK"
  RUN="$NF_EVIDENCE_ROOT/$RUN_ID"
  mkdir "$RUN" || { RUN=; echo "PARE: não criei $NF_EVIDENCE_ROOT/$RUN_ID (já existe?)" >&2; exit 2; }
  { mkdir "$RUN/obs" "$RUN/provenance" "$RUN/sessions" "$RUN/tests" && echo 0 > "$RUN/obs/.n"; } ||
    { echo "PARE: estrutura de evidências não criada em $RUN" >&2; exit 2; }
  log "run=$RUN_ID mode=$MODE harness_version=$HARNESS_VERSION started=$(date -u +%FT%TZ)"
}

# ---- cliente: único ponto que fala com o alvo -------------------------------
# client <script|observer|session> <application_name>; stdin = SQL.
# client_exec substitui o processo atual (exec): em background, `$!` é o pid
# do próprio cliente (docker/psql simulado), não de um subshell intermediário.
client_exec() {
  if [ "$MODE" = simulated ]; then exec "$NF_SIM_CLIENT" "$1" "$2"; fi
  local opts=(-X -At); [ "$1" = session ] || opts+=(-q -v ON_ERROR_STOP=1)
  exec docker --context "$NF_LAB_CONTEXT" exec -i -e PGAPPNAME="$2" "$NF_LAB_CONTAINER_ID" \
    psql "${opts[@]}" -U postgres -d postgres
}
client() ( client_exec "$@" )
client_desc() {
  if [ "$MODE" = simulated ]; then echo "$NF_SIM_CLIENT <script|observer|session> <application_name>"
  else echo "docker --context $NF_LAB_CONTEXT exec -i -e PGAPPNAME=<application_name> $NF_LAB_CONTAINER_ID psql -X -At [-q -v ON_ERROR_STOP=1 em script/observer] -U postgres -d postgres"; fi
}

# obs <tag>: SQL do stdin, como owner, em sessão própria. Guarda SQL exato,
# saída, stderr e rc; devolve a saída e o rc do cliente.
obs() {
  local n f; n=$(( $(cat "$RUN/obs/.n") + 1 ))
  f="$RUN/obs/$(printf %03d "$n")-$1"
  echo "$n" > "$RUN/obs/.n" || { cat > /dev/null; nowrite obs/.n; return; }
  { echo "-- obs:$1"; cat; } > "$f.sql" || { nowrite "$f.sql"; return; }
  client observer "nf0089-$TOK-obs" < "$f.sql" > "$f.out" 2> "$f.err"
  local rc=$?
  echo "$rc" > "$f.rc" || { nowrite "$f.rc"; return; }
  cat "$f.out"
  [ "$rc" = 0 ] && [ ! -s "$f.err" ]
}

# ---- alvo real: identidade e isolamento (nunca inicia nada) ------------------
lab_preflight() {
  local p=$RUN/provenance/lab.txt
  if [ "$MODE" = simulated ]; then echo "SIMULATED: nenhum alvo real; cliente=$NF_SIM_CLIENT" > "$p" || nowrite lab.txt; return; fi
  local d=(docker --context "$NF_LAB_CONTEXT") ep id fmt line
  ep=$(docker context inspect "$NF_LAB_CONTEXT" --format '{{.Endpoints.docker.Host}}' 2>&1) || { fail "contexto Docker indisponível: $ep"; return 1; }
  [ "$ep" = "$NF_LAB_ENDPOINT" ] || { fail "endpoint '$ep' difere de '$NF_LAB_ENDPOINT'"; return 1; }
  { echo "context=$NF_LAB_CONTEXT endpoint=$ep"
    "${d[@]}" version --format 'docker client={{.Client.Version}} server={{.Server.Version}}'
    "${d[@]}" info --format 'daemon={{.ID}}'; } > "$p" 2>&1 || { fail "daemon indisponível (ver $p)"; return 1; }
  fmt='id={{.Id}}|name={{.Name}}|image={{.Config.Image}}|imageid={{.Image}}|status={{.State.Status}}|net={{.HostConfig.NetworkMode}}|ports={{json .HostConfig.PortBindings}}|publishall={{.HostConfig.PublishAllPorts}}|restart={{.HostConfig.RestartPolicy.Name}}|mounts={{range .Mounts}}{{.Type}}:{{.Name}}->{{.Destination}};{{end}}|started={{.State.StartedAt}}'
  line=$("${d[@]}" inspect --type container "$NF_LAB_CONTAINER_ID" --format "$fmt" 2>&1) || { fail "container inexistente: $line"; return 1; }
  echo "$line" >> "$p"
  id=$("${d[@]}" inspect --type container "$NF_LAB_CONTAINER" --format '{{.Id}}' 2>&1)
  [ "$id" = "$NF_LAB_CONTAINER_ID" ] || { fail "nome $NF_LAB_CONTAINER resolve para '$id' (ambíguo)"; return 1; }
  case "$line" in *"|name=/$NF_LAB_CONTAINER|"*) ;; *) fail "nome divergente"; return 1 ;; esac
  case "$line" in *"|net=none|"*) ;; *) fail "network != none"; return 1 ;; esac
  case "$line" in *"|ports={}|publishall=false|"*) ;; *) fail "portas publicadas"; return 1 ;; esac
  case "$line" in *"|mounts=volume:$NF_LAB_VOLUME->/var/lib/postgresql/data;|"*) ;; *) fail "volume divergente"; return 1 ;; esac
  case "$line" in *"|status=running|"*) ;; *) fail "container não está running; o harness não inicia bancos"; return 1 ;; esac
  "${d[@]}" exec "$NF_LAB_CONTAINER_ID" psql --version >> "$p" 2>&1 || { fail "psql indisponível no container"; return 1; }
  obs server-version <<< "select version();" >> "$p" || { fail "observador falhou (versão)"; return 1; }
}

# ---- proveniência ------------------------------------------------------------
# provenance_capture <arquivos de teste...>
provenance_capture() {
  local P=$RUN/provenance f
  { echo "harness_version=$HARNESS_VERSION"; echo "mode=$MODE"; echo "run_id=$RUN_ID"
    echo "client: $(client_desc)"; echo "observer application_name: nf0089-$TOK-obs"
    echo "argv: $0 ${ARGV_COPY[*]}"; } > "$P/commands.txt" || { nowrite commands.txt; return; }
  ( set -e; echo "head=$(git -C "$REPO" rev-parse HEAD)"; echo "branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
    echo "status (porcelain, inclui não rastreados):"; git -C "$REPO" status --porcelain=v1 --untracked-files=all
  ) > "$P/git.txt" || { nowrite git.txt; return; }
  ( set -o pipefail; cd "$REPO" && find supabase/tests/offline -type f | sort | xargs sha256sum
  ) > "$P/harness.sha256" || { nowrite harness.sha256; return; }
  ( set -e; (cd "$REPO" && sha256sum supabase/migrations/0089_marketplace_withdrawal_webhook_atomic.sql \
     supabase/tests/setup/service_role_platform_grants.sql); for f in "$@"; do sha256sum "$f"; done
  ) > "$P/sources.sha256" || { nowrite sources.sha256; return; }
  ( set -e; echo "# DISPONÍVEIS NA WORKTREE -- não prova que foram aplicadas no alvo."
    echo "# O alvo não tem supabase_migrations.schema_migrations; a aplicação só é"
    echo "# comprovada por catálogo para o que estiver em applied-evidence.txt."
    cd "$REPO"; sha256sum supabase/migrations/*.sql supabase/tests/setup/*.sql
  ) > "$P/migrations-available.sha256" || { nowrite migrations-available.sha256; return; }
  if [ "$MODE" = simulated ]; then
    echo "SIMULATED: catálogo não capturado" > "$P/applied-evidence.txt" || nowrite applied-evidence.txt; return
  fi
  catalog_capture
}

# assinatura esperada (formato regprocedure, sem schema) de cada função da 0089
declare -A SIG_0089=(
  [lock_marketplace_transfer_identity]='lock_marketplace_transfer_identity(uuid,text)'
  [mark_marketplace_withdrawal_processing]='mark_marketplace_withdrawal_processing(uuid,text)'
  [finalize_marketplace_withdrawal]='finalize_marketplace_withdrawal(uuid,text,text,integer,text,text)'
  [process_marketplace_transfer_webhook_event]='process_marketplace_transfer_webhook_event(text,text,uuid,text,integer)'
)
FUNCS_0089="lock_marketplace_transfer_identity mark_marketplace_withdrawal_processing finalize_marketplace_withdrawal process_marketplace_transfer_webhook_event"
catalog_capture() {
  local P=$RUN/provenance rel=supabase/migrations/0089_marketplace_withdrawal_webhook_atomic.sql fn want got lines mism=0
  local mig="$REPO/$rel"
  ( set -o pipefail; mkdir "$P/bodies-0089" && tr -d '\r' < "$mig" | awk -v d="$P/bodies-0089" '
    match($0, /^create or replace function public\.[a-z_]+\(/) { cur = substr($0, 35, RLENGTH - 35) }
    /^as \$\$$/ && cur != "" { on = 1; next }
    /^\$\$;$/ { on = 0; cur = ""; next }
    on { print > (d "/" cur ".txt") }' ) || { nowrite bodies-0089; return; }
  obs functions-0089 > "$P/catalog-functions-0089.txt" <<'SQL' || { fail "observador falhou (funções)"; return 1; }
select 'FN|'||p.oid::regprocedure||'|owner='||pg_get_userbyid(p.proowner)||'|secdef='||p.prosecdef||'|config='||coalesce(p.proconfig::text,'-')||'|acl='||coalesce(p.proacl::text,'-')||'|md5='||md5(p.prosrc)
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
  ('lock_marketplace_transfer_identity','mark_marketplace_withdrawal_processing','finalize_marketplace_withdrawal',
   'process_marketplace_transfer_webhook_event','complete_marketplace_withdrawal','renew_subscription_from_asaas_payment',
   'process_marketplace_payment_received_event','mark_marketplace_payment_provider_created') order by 1;
select '--- DEF '||p.oid::regprocedure||E'\n'||pg_get_functiondef(p.oid) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in
  ('lock_marketplace_transfer_identity','mark_marketplace_withdrawal_processing','finalize_marketplace_withdrawal','process_marketplace_transfer_webhook_event') order by 1;
SQL
  obs grants > "$P/catalog-grants.txt" <<'SQL' || { fail "observador falhou (grants)"; return 1; }
select 'RELACL|'||c.oid::regclass||'|owner='||pg_get_userbyid(c.relowner)||'|rls='||c.relrowsecurity||'|acl='||coalesce(c.relacl::text,'-')
  from pg_class c where c.oid in ('public.payments'::regclass,'public.marketplace_withdrawals'::regclass,'public.processed_webhook_events'::regclass,
  'public.subscriptions'::regclass,'public.marketplace_ledger_entries'::regclass,'public.marketplace_payment_exceptions'::regclass) order by 1;
select 'PRIV|'||r||'|'||t||'|'||p||'|'||has_table_privilege(r, t, p) from unnest(array['service_role','anon','authenticated']) r,
  unnest(array['public.payments','public.marketplace_withdrawals','public.processed_webhook_events','public.subscriptions','public.marketplace_ledger_entries']) t,
  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p order by 1;
select 'ROLE|'||rolname||'|super='||rolsuper||'|bypassrls='||rolbypassrls from pg_roles where rolname in ('service_role','anon','authenticated','postgres') order by 1;
select 'SETTING|'||name||'='||setting from pg_settings where name in ('default_transaction_isolation','lock_timeout','statement_timeout','deadlock_timeout') order by 1;
select 'EXT|'||extname||'|'||extversion from pg_extension where extname in ('pgtap','dblink') order by 1;
select 'MIGTABLE|'||coalesce(to_regclass('supabase_migrations.schema_migrations')::text, 'ausente');
SQL
  local st; st=$(git -C "$REPO" status --porcelain=v1 -- "$rel") || { fail "git status da 0089 falhou"; return 1; }
  {
    echo "# Corpo (prosrc) de cada função da 0089 no catálogo do alvo comparado com o arquivo"
    echo "# da WORKTREE abaixo (HEAD e status completos em git.txt). Uma linha MATCH exige"
    echo "# exatamente uma função com esse nome, no schema public, com a assinatura esperada."
    echo "SOURCE $rel sha256=$(sha256sum < "$mig" | cut -c1-64) head=$(git -C "$REPO" rev-parse HEAD) worktree_vs_head=${st:-inalterada}"
    echo "HISTORY não comprovado: alvo sem schema_migrations; igualdade de prosrc não prova o histórico de aplicação nem os demais comandos da migration."
    for fn in $FUNCS_0089; do
      want=$( { printf '\n'; cat "$P/bodies-0089/$fn.txt"; } | md5sum | cut -c1-32)
      # todas as funções com esse nome que a consulta trouxe (ela já filtra o schema public); regprocedure omite `public.` quando public está no search_path
      lines=$(grep -E "^FN\|([a-z_]+\.)?$fn\(" "$P/catalog-functions-0089.txt")
      got=$(printf '%s\n' "$lines" | awk -F'|' -v s="${SIG_0089[$fn]}" '$2 == s || $2 == "public." s { sub(/.*\|md5=/, ""); print }')
      if [ -n "$lines" ] && [ "$(printf '%s\n' "$lines" | wc -l)" = 1 ] && [ "$want" = "$got" ]; then
        echo "MATCH $fn sig=${SIG_0089[$fn]} md5=$got"
        echo "RECORDED owner/acl $(printf '%s\n' "$lines" | cut -d'|' -f2-6) (registrado, não comparado)"
      else
        echo "MISMATCH $fn sig_esperada=${SIG_0089[$fn]} repo_md5=$want catalog=[$(printf '%s' "$lines" | cut -d'|' -f2,7 | tr '\n' ';')]"; mism=1
      fi
    done; } > "$P/applied-evidence.txt" || { nowrite applied-evidence.txt; return; }
  [ $mism = 0 ] || { fail "funções da 0089 no alvo diferem da worktree/assinatura esperada (ver applied-evidence.txt)"; return 1; }
}

# ---- sessões residuais: só nomes desta execução -------------------------------
# residual_check <tag> <application_name...>: exige 0 linhas (espera até ~3s)
residual_check() {
  local tag=$1; shift
  local names; names=$(printf "'%s'," "$@"); names=${names%,}
  local i out
  for i in 1 2 3 4 5 6; do
    out=$(obs "residual-$tag" <<SQL
select 'RESID|'||pid||'|'||application_name||'|'||coalesce(state,'-')||'|'||backend_start from pg_stat_activity
 where pid <> pg_backend_pid() and (application_name = any(array[$names]::text[]) or application_name like 'nf0089-$TOK-%')
   and application_name <> 'nf0089-$TOK-obs';
SQL
) || { fail "observador falhou na verificação de sessões residuais ($tag): estado das sessões desconhecido"; return 1; }
    [ -z "$out" ] && return 0
    sleep 0.5
  done
  fail "sessões residuais desta execução ($tag): $(echo "$out" | tr '\n' ' ')"
  return 1
}

# ---- finalização única (EXIT) -------------------------------------------------
on_signal() { INTERRUPTED=$1; log "INTERROMPIDO por SIG$1"; exit "$2"; }
finalize() {
  local code=$?
  trap - EXIT INT TERM
  [ -n "$RUN" ] || exit "$code"
  if declare -F cleanup_hook >/dev/null; then cleanup_hook; fi
  if [ -n "$INTERRUPTED" ]; then STATUS=INTERRUPTED
  elif [ -n "$FAILED" ]; then STATUS=${STATUS:-FAIL}
  elif [ "$code" != 0 ]; then STATUS=FAIL; REASONS+=("saída inesperada rc=$code")
  else STATUS=PASS; fi
  local r
  # RESULT e a linha final do run.log são obrigatórios; o anúncio só sai depois de ambos gravados
  # `if ! { ...; } > f` não detecta falha do redirecionamento no bash; usar `||`
  local wrote=0
  { echo "$STATUS"; for r in "${REASONS[@]}"; do echo "reason: $r"; done; echo "finished=$(date -u +%FT%TZ)"; } > "$RUN/RESULT" && wrote=1
  if [ $wrote = 0 ] || [ "$(head -1 "$RUN/RESULT" 2>/dev/null)" != "$STATUS" ]; then
    echo "PARE: não gravei RESULT em $RUN/RESULT (status apurado: $STATUS); execução sem resultado válido" >&2
    exit 3
  fi
  echo "RESULT: $STATUS ($RUN)" >> "$RUN/run.log" || {
    { echo FAIL; echo "reason: evidência não gravada: run.log"; } > "$RUN/RESULT"
    echo "PARE: run.log não gravável; RESULT regravado como FAIL ($RUN)" >&2; exit 1
  }
  echo "RESULT: $STATUS ($RUN)"
  case "$STATUS" in PASS) exit 0 ;; INTERRUPTED) [ "$INTERRUPTED" = INT ] && exit 130 || exit 143 ;; *) exit 1 ;; esac
}
install_traps() { trap finalize EXIT; trap 'on_signal INT 130' INT; trap 'on_signal TERM 143' TERM; }
