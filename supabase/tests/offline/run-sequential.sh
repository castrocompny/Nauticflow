#!/usr/bin/env bash
# Runner sequencial pgTAP do laboratório offline da 0089 (ver supabase/tests/README.md).
# PASS de cada arquivo = cliente com exit 0 E TAP válido (lib/tapcheck.awk) E
# nenhuma sessão desta execução restante. Para na primeira falha.
set -u
USAGE="uso: run-sequential.sh <rótulo>=<arquivo.sql> [...]   (rótulo: [a-z0-9_]{1,40}, único)"
H=$(cd "$(dirname "$0")" && pwd)
ARGV_COPY=("$@")
source "$H/lib/common.sh"

# contrato de argumentos: tudo validado antes de qualquer ação
LABELS=() FILES=()
[ $# -ge 1 ] || usage_die "nenhum arquivo"
for a in "$@"; do
  [[ "$a" =~ ^([a-z0-9_]{1,40})=(.+)$ ]] || usage_die "argumento '$a'"
  l=${BASH_REMATCH[1]} f=${BASH_REMATCH[2]}
  [[ "$f" == *.sql ]] || usage_die "'$f' não é .sql"
  [ -f "$f" ] && [ -r "$f" ] && [ -s "$f" ] || usage_die "arquivo inexistente/ilegível/vazio: $f"
  for x in "${LABELS[@]}"; do [ "$x" != "$l" ] || usage_die "rótulo repetido: $l"; done
  LABELS+=("$l") FILES+=("$(cd "$(dirname "$f")" && pwd)/$(basename "$f")")
done
config_validate

run_dir_create seq
install_traps
lab_preflight || exit 1
provenance_capture "${FILES[@]}" || exit 1

for i in "${!LABELS[@]}"; do
  l=${LABELS[$i]} f=${FILES[$i]} app="nf0089-$TOK-seq-${LABELS[$i]}"
  out=$RUN/tests/$l.tap err=$RUN/tests/$l.err
  log "== $l sha256=$(sha256sum < "$f" | cut -c1-64) app=$app"
  client script "$app" < "$f" > "$out" 2> "$err"
  rc=$?; echo "$rc" > "$RUN/tests/$l.rc" || { nowrite "tests/$l.rc"; break; }
  awk -v rc="$rc" -f "$TAPCHECK" "$out" "$err" > "$RUN/tests/$l.verdict"; v=$?
  log "client_rc=$rc $(tail -1 "$RUN/tests/$l.verdict")"
  residual_check "seq-$l" "$app" || break
  [ $v -eq 0 ] || { fail "$l reprovado (ver tests/$l.verdict)"; break; }
done
exit 0
