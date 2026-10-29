#!/usr/bin/env bash
# Corridas da 0089 em duas sessões psql independentes (W = vencedor, L = perdedor)
# + observador owner em sessão própria. Ver supabase/tests/README.md.
#   a1: DONE x FAILED, DONE confirmado primeiro   a2: o inverso
#   b1: mesmo transfer id em dois saques pending, vencedor X   b2: vencedor Y
#   c1: captura 0090, capacidade 1, grupos distintos (perdedor: capacidade esgotada)
#   c2: captura 0090, capacidade 1, mesmo grupo (perdedor: repetição, sem nova vaga)
#   c3: uma sessão: conflito financeiro 0089 -> captura na mesma transação abortada
#       recusada (25P02) -> rollback confirmado -> captura em transação NOVA com commit
set -u
USAGE="uso: run-concurrency.sh --scenarios <lista de a1,a2,b1,b2,c1,c2,c3 sem repetição>"
H=$(cd "$(dirname "$0")" && pwd)
ARGV_COPY=("$@")
source "$H/lib/common.sh"

[ $# -eq 2 ] && [ "$1" = --scenarios ] || usage_die "argumentos"
# lista inteira validada antes da divisão: `read -a` descartaria o campo vazio final (`a1,`)
[[ "$2" =~ ^(a1|a2|b1|b2|c1|c2|c3)(,(a1|a2|b1|b2|c1|c2|c3))*$ ]] || usage_die "lista de cenários '$2' (vazia, campo vazio ou desconhecido)"
IFS=, read -ra SCS <<< "$2"
seen=","
for s in "${SCS[@]}"; do
  case "$s" in a1|a2|b1|b2|c1|c2|c3) ;; *) usage_die "cenário desconhecido '$s'" ;; esac
  case "$seen" in *",$s,"*) usage_die "cenário repetido '$s'" ;; esac
  seen="$seen$s,"
done
config_validate

run_dir_create conc
install_traps
trap "" PIPE  # escrita em sessão já encerrada não pode matar o runner antes da limpeza
lab_preflight || exit 1
provenance_capture "$H/run-concurrency.sh" "$REPO/supabase/migrations/0090_marketplace_transfer_conflict_capture.sql" || exit 1

declare -A SFD SPID SBPID SBSTART
OPEN=() ALLAPPS=()

# ---- sessões -------------------------------------------------------------------
# Cada sessão: processo local P (substituição de processo) que lança o cliente C
# (pid gravado em <nome>.cpid), espera C e grava o rc dele em <nome>.rc.
open_sess() { # nome app
  local fd out="$RUN/sessions/$1.out" rcf="$RUN/sessions/$1.rc" cpf="$RUN/sessions/$1.cpid"
  exec {fd}> >(client_exec session "$2" > "$out" 2>&1 <&0 & c=$!; echo "$c" > "$cpf"; wait "$c"; echo $? > "$rcf")
  SFD[$1]=$fd SPID[$1]=$!
  OPEN+=("$1") ALLAPPS+=("$2")
  echo "$1 app=$2 local_pid=$!" >> "$RUN/sessions/index.txt" || nowrite sessions/index.txt
}
send() { printf '%s\n' "$2" >&"${SFD[$1]}"; }
has_line() { grep -qx -- "$2" "$RUN/sessions/$1.out" 2>/dev/null; }
wait_mark() { # nome marca prazo_s
  local end=$((SECONDS + $3))
  while [ $SECONDS -lt $end ]; do has_line "$1" "MARK:$2" && return 0; sleep 0.2; done
  return 1
}
drop_open() { local n k=(); for n in "${OPEN[@]}"; do [ "$n" = "$1" ] || k+=("$n"); done; OPEN=("${k[@]}"); }
alive() { kill -0 "$1" 2>/dev/null; }
gone_within() { # pid décimos_de_segundo
  local i; for i in $(seq 1 "$2"); do alive "$1" || return 0; sleep 0.1; done; ! alive "$1"
}
# Fecha o descritor e espera P (prazo 10s). Só como último recurso sinaliza os
# pids registrados por esta execução (C, depois P): TERM, prazo, KILL e nova
# conferência. Não alcança descendentes de C nem o psql dentro do container --
# isso fica para o encerramento de backend no cleanup_hook.
reap() { # nome
  eval "exec ${SFD[$1]}>&-" 2>/dev/null
  local p=${SPID[$1]} c st=
  c=$(cat "$RUN/sessions/$1.cpid" 2>/dev/null)
  if ! gone_within "$p" 100; then
    st="forçado:"
    local x; for x in $c $p; do
      alive "$x" || continue
      kill -TERM "$x" 2>/dev/null; gone_within "$x" 30 && { st="$st$x=TERM;"; continue; }
      kill -KILL "$x" 2>/dev/null; gone_within "$x" 30 && st="$st$x=KILL;" || st="$st$x=VIVO;"
    done
    fail "$1: processo local $p não terminou em 10s; encerramento pelo runner [$st]"
  fi
  wait "$p" 2>/dev/null; local w=$?
  local rc; rc=$(cat "$RUN/sessions/$1.rc" 2>/dev/null)
  local cs=encerrado; [ -n "$c" ] && alive "$c" && cs=VIVO
  echo "$1 closed local_pid=$p wait=$w client_pid=${c:-ausente} client=$cs client_rc=${rc:-ausente} ${st}" >> "$RUN/sessions/index.txt" ||
    nowrite sessions/index.txt
  drop_open "$1"
  [ "$cs" = encerrado ] && [ -n "$c" ] || { fail "$1: cliente ${c:-sem pid registrado} não confirmado encerrado"; return 1; }
  [ "$w" = 0 ] || { fail "$1: wait do processo local $p devolveu wait=$w (término anormal)"; return 1; }
  [ "$rc" = 0 ] || { fail "$1: cliente terminou com rc=${rc:-ausente}"; return 1; }
}
close_sess() { send "$1" '\q'; reap "$1"; } # fechamento normal, transação já encerrada
abort_sess() { # cleanup: rollback confirmado antes de fechar
  send "$1" 'rollback;'; send "$1" '\echo CLEANUP rollback SQLSTATE :SQLSTATE'; send "$1" '\echo MARK:cleanup'
  if wait_mark "$1" cleanup 15; then
    has_line "$1" 'CLEANUP rollback SQLSTATE 00000' || fail "$1: rollback de limpeza falhou"
  else fail "$1: rollback de limpeza sem confirmação em 15s"; fi
  send "$1" '\q'; reap "$1"
}
cleanup_hook() {
  trap '' INT TERM
  local n
  for n in "${OPEN[@]}"; do log "cleanup: $n"; abort_sess "$n"; done
  [ ${#ALLAPPS[@]} -gt 0 ] || return 0
  residual_check final "${ALLAPPS[@]}" && return 0
  # Detecção usa nomes desta execução (exatos + prefixo nf0089-<token>-); o
  # encerramento só atinge backend com pid + application_name + backend_start
  # registrados por esta execução. Tentativa != confirmação: nova observação depois.
  log "cleanup: resíduo ou estado desconhecido; tentando encerrar só backends registrados"
  local out
  for n in "${!SBPID[@]}"; do
    out=$(obs "terminate-$n" <<SQL
select 'TERM|'||pid||'|'||pg_terminate_backend(pid) from pg_stat_activity
 where pid = ${SBPID[$n]} and application_name = 'nf0089-$TOK-$n' and backend_start = '${SBSTART[$n]}';
SQL
) || { fail "$n: observador falhou no encerramento do backend ${SBPID[$n]} (resultado desconhecido)"; continue; }
    log "cleanup: terminate $n -> ${out:-nenhum backend correspondente}"
  done
  if residual_check final-recheck "${ALLAPPS[@]}"; then
    log "cleanup: confirmado: nenhuma sessão residual após o encerramento (a execução continua FAIL)"
  else
    fail "sessões residuais persistem após o encerramento ou não puderam ser observadas"
  fi
}

preamble() { # nome app
  send "$1" '\set VERBOSITY verbose'
  send "$1" "select 'SESS:'||pid||'|'||backend_start from pg_stat_activity where pid = pg_backend_pid();"
  send "$1" 'begin isolation level read committed;'
  send "$1" "set local lock_timeout = '20s'; set local statement_timeout = '60s';"
  send "$1" 'set local role service_role;'
  send "$1" "select 'ID:'||current_user||'|'||session_user||'|'||current_setting('transaction_isolation')||'|'||current_setting('application_name')||'|lock_timeout='||current_setting('lock_timeout');"
  send "$1" '\echo MARK:ready'
}
rpc() { # nome key tipo saque transfer fee
  send "$1" "select 'RPC:'||current_user||'|'||outcome||'|'||withdrawal_status from public.process_marketplace_transfer_webhook_event('$2', '$3', '$4', '$5', $6);"
  send "$1" '\echo RES SQLSTATE :SQLSTATE LAST_ERROR :LAST_ERROR_SQLSTATE :LAST_ERROR_MESSAGE'
  send "$1" '\echo MARK:called'
}
rpc_c() { # nome key transfer (0090: mesmo motivo/evento; taxa e referência ausentes)
  send "$1" "select 'RPC:'||current_user||'|'||outcome||'|'||occurrence_count from public.record_marketplace_transfer_conflict('terminal_outcome_conflict', 'TRANSFER_DONE', '$2', '$2', '$3', 'absent', null, 'absent', null);"
  send "$1" '\echo RES SQLSTATE :SQLSTATE LAST_ERROR :LAST_ERROR_SQLSTATE :LAST_ERROR_MESSAGE'
  send "$1" '\echo MARK:called'
}

# run_race <sc> <a|b|c> <W rpc esperado> <erro do perdedor | OK:<rpc esperado>>; usa W_ARGS/L_ARGS
# c (0090): chaves iguais são permitidas (c2 = mesmo grupo); OK: => perdedor retorna e faz commit
run_race() {
  local sc=$1 kind=$2 want_w=$3 want_err=$4 W=$1-W L=$1-L
  local appW="nf0089-$TOK-$sc-W" appL="nf0089-$TOK-$sc-L" n call=rpc
  [ "$kind" = c ] && call=rpc_c
  [ "$kind" = c ] || [ "${W_ARGS[0]}" != "${L_ARGS[0]}" ] || { fail "$sc: event_keys iguais"; return 1; }
  open_sess "$W" "$appW"; open_sess "$L" "$appL"
  preamble "$W"; preamble "$L"
  wait_mark "$W" ready 20 && wait_mark "$L" ready 20 || { fail "$sc: sessões não ficaram prontas"; return 1; }
  for n in "$W" "$L"; do
    local s; s=$(sed -n 's/^SESS://p' "$RUN/sessions/$n.out" | head -1)
    SBPID[$n]=${s%%|*} SBSTART[$n]=${s#*|}
    [[ "${SBPID[$n]}" =~ ^[0-9]+$ ]] || { fail "$sc: PID do backend de $n ausente"; return 1; }
    echo "$n backend_pid=${SBPID[$n]} backend_start=${SBSTART[$n]}" >> "$RUN/sessions/index.txt"
  done
  has_line "$W" "ID:service_role|postgres|read committed|$appW|lock_timeout=20s" &&
  has_line "$L" "ID:service_role|postgres|read committed|$appL|lock_timeout=20s" || { fail "$sc: papel/isolamento/app inesperados"; return 1; }
  local WP=${SBPID[$W]} LP=${SBPID[$L]}
  log "[$sc] W pid=$WP app=$appW | L pid=$LP app=$appL"

  $call "$W" "${W_ARGS[@]}"
  wait_mark "$W" called 30 || { fail "$sc: RPC do vencedor não retornou"; return 1; }
  has_line "$W" "RPC:$want_w" && grep -q '^RES SQLSTATE 00000 ' "$RUN/sessions/$W.out" || { fail "$sc: vencedor inesperado"; return 1; }
  log "[$sc] W rpc ok, transação aberta: RPC:$want_w"

  $call "$L" "${L_ARGS[@]}"
  local seen=0 end=$((SECONDS + 15)) r
  while [ $SECONDS -lt $end ]; do
    r=$(obs "blockwait-$sc" <<< "select count(*) from pg_stat_activity where pid = $LP and wait_event_type = 'Lock' and $WP = any(pg_blocking_pids($LP));") ||
      { fail "$sc: observador falhou ao procurar o bloqueio"; return 1; }
    [ "$r" = 1 ] && { seen=1; break; }
    sleep 0.3
  done
  [ $seen = 1 ] || { fail "$sc: bloqueio do perdedor não observado (inconclusivo)"; return 1; }
  local ev; ev=$(obs "lockevidence-$sc" <<SQL
select 'T|'||clock_timestamp();
select 'ACT|'||pid||'|'||application_name||'|'||usename||'|'||state||'|'||coalesce(wait_event_type,'-')||'|'||coalesce(wait_event,'-')||'|blockers='||pg_blocking_pids(pid)::text||'|xid='||coalesce(backend_xid::text,'-') from pg_stat_activity where pid in ($WP, $LP) order by pid;
select 'WAIT|'||l.pid||'|'||l.locktype||'|'||l.mode||'|granted='||l.granted||'|rel='||coalesce(l.relation::regclass::text,'-')||'|xid='||coalesce(l.transactionid::text,'-')||'|classid='||coalesce(l.classid::text,'-')||'|objid='||coalesce(l.objid::text,'-')||'|objsubid='||coalesce(l.objsubid::text,'-') from pg_locks l where l.pid = $LP and not l.granted;
select 'HELD_W|'||l.locktype||'|'||l.mode||'|rel='||coalesce(l.relation::regclass::text,'-')||'|xid='||coalesce(l.transactionid::text,'-')||'|classid='||coalesce(l.classid::text,'-')||'|objid='||coalesce(l.objid::text,'-') from pg_locks l where l.pid = $WP and l.granted and l.locktype in ('advisory','transactionid','tuple') order by 1;
select 'HELD_L|'||l.locktype||'|'||l.mode||'|rel='||coalesce(l.relation::regclass::text,'-')||'|classid='||coalesce(l.classid::text,'-')||'|objid='||coalesce(l.objid::text,'-') from pg_locks l where l.pid = $LP and l.granted and l.locktype in ('advisory','tuple') order by 1;
SQL
)
  [ $? -eq 0 ] || { fail "$sc: observador falhou (evidência de locks)"; return 1; }
  echo "$ev" | sed "s/^/[$sc] /" | tee -a "$RUN/run.log" || nowrite run.log
  has_line "$L" MARK:called && { fail "$sc: perdedor retornou antes do commit do vencedor"; return 1; }
  if [ "$kind" = a ]; then
    local wx; wx=$(echo "$ev" | grep "^ACT|$WP|" | sed 's/.*|xid=//')
    [ "$(echo "$ev" | grep -c '^WAIT|')" = 1 ] && echo "$ev" | grep -q "^WAIT|$LP|transactionid|ShareLock|granted=false|rel=-|xid=$wx|" &&
      echo "$ev" | grep -q '^HELD_L|tuple|.*rel=marketplace_withdrawals' || { fail "$sc: recurso bloqueado não é o xid do vencedor na linha do saque"; return 1; }
  elif [ "$kind" = c ]; then
    # advisory de duas chaves (20038, 90) da 0090: objsubid=2, espaço distinto do lock por transfer id
    [ "$(echo "$ev" | grep -c '^WAIT|')" = 1 ] && echo "$ev" | grep -q "^WAIT|$LP|advisory|ExclusiveLock|granted=false|rel=-|xid=-|classid=20038|objid=90|objsubid=2$" ||
      { fail "$sc: recurso bloqueado não é o advisory de captura da 0090"; return 1; }
  else
    local k; k=$(obs "advkey-$sc" <<< "with k as (select hashtextextended('marketplace_transfer:' || '${W_ARGS[3]}', 0) h) select ((h >> 32) & 4294967295)||'|objid='||(h & 4294967295) from k;") ||
      { fail "$sc: observador falhou (chave advisory)"; return 1; }
    [ "$(echo "$ev" | grep -c '^WAIT|')" = 1 ] && echo "$ev" | grep -q "^WAIT|$LP|advisory|ExclusiveLock|granted=false|rel=-|xid=-|classid=$k|objsubid=1$" ||
      { fail "$sc: recurso bloqueado não é o advisory do transfer id"; return 1; }
  fi
  log "[$sc] bloqueio observado: L=$LP bloqueado por W=$WP ($kind)"

  send "$W" 'commit;'; send "$W" '\echo RES commit SQLSTATE :SQLSTATE'; send "$W" '\echo MARK:committed'
  wait_mark "$W" committed 15 && has_line "$W" 'RES commit SQLSTATE 00000' || { fail "$sc: commit do vencedor falhou"; return 1; }
  log "[$sc] W commit $(date -u +%T)"
  wait_mark "$L" called 30 || { fail "$sc: perdedor não retornou após o commit"; return 1; }
  log "[$sc] L: $(grep -E '^(RPC:|RES SQLSTATE|ERROR)' "$RUN/sessions/$L.out" | tr '\n' ' ')"
  if [ "${want_err#OK:}" != "$want_err" ]; then
    has_line "$L" "RPC:${want_err#OK:}" && grep -q '^RES SQLSTATE 00000 ' "$RUN/sessions/$L.out" ||
      { fail "$sc: perdedor não retornou exatamente RPC:${want_err#OK:}"; return 1; }
    send "$L" 'commit;'; send "$L" '\echo RES commit SQLSTATE :SQLSTATE'; send "$L" '\echo MARK:lcommitted'
    wait_mark "$L" lcommitted 15 && has_line "$L" 'RES commit SQLSTATE 00000' || { fail "$sc: commit do perdedor sem confirmação"; return 1; }
  else
    has_line "$L" "RES SQLSTATE P0001 LAST_ERROR P0001 $want_err" && ! grep -q '^RPC:' "$RUN/sessions/$L.out" ||
      { fail "$sc: perdedor não recebeu exatamente P0001 $want_err"; return 1; }
    send "$L" 'rollback;'; send "$L" '\echo RES rollback SQLSTATE :SQLSTATE'; send "$L" '\echo MARK:rolledback'
    wait_mark "$L" rolledback 15 && has_line "$L" 'RES rollback SQLSTATE 00000' || { fail "$sc: rollback do perdedor sem confirmação"; return 1; }
  fi
  close_sess "$W" && close_sess "$L" || return 1
  residual_check "$sc" "$appW" "$appL"
}

checks() { # n_esperado; SQL no stdin
  local out; out=$(obs "checks-$SC") || { fail "$SC: observador falhou (verificações)"; return 1; }
  echo "$out" | sed "s/^/[$SC] /" | tee -a "$RUN/run.log" || nowrite run.log
  echo "$out" | awk -F'|' -v want="$1" '$1=="CHECK" && $3!=$4 {bad++} $1=="CHECK"{n++} END{exit !(n==want && bad==0)}' ||
    { fail "$SC: verificações finais divergentes"; return 1; }
}
absent() { # SQL no stdin deve devolver ABSENT|0
  local out; out=$(obs "absent-$SC") || { fail "$SC: observador falhou (ausência)"; return 1; }
  [ "$out" = "ABSENT|0" ] || { fail "$SC: fixtures não estavam ausentes ($out)"; return 1; }
}

scenario_A() { # sc vencedor perdedor Wfee Lfee status entry buckets net
  SC=$1; local c="$TOK-0000-4000-8000-0000000000$1" w="$TOK-0000-4000-8000-00000000${1}01" tr="tr_${TOK}_$1"
  local kw="evt_${TOK}_$1_w" kl="evt_${TOK}_$1_l"
  log "===== $SC: $2 confirmado primeiro, $3 concorrente"
  absent <<SQL || return 1
select 'ABSENT|'||((select count(*) from public.companies where id = '$c') + (select count(*) from public.marketplace_withdrawals where id = '$w' or provider_transfer_id = '$tr')
  + (select count(*) from public.processed_webhook_events where event_key in ('$kw','$kl')) + (select count(*) from public.marketplace_ledger_entries where reference_id = '$w'));
SQL
  obs "fixture-$SC" > /dev/null <<SQL || { fail "$SC: fixture falhou"; return 1; }
begin;
insert into public.companies (id, name) values ('$c', 'nf0089 harness $TOK $SC (ficticia)');
insert into public.marketplace_withdrawals (id, company_id, amount_cents, status) values ('$w', '$c', 10000, 'pending');
select 'FIX|'||id||'|'||status from public.mark_marketplace_withdrawal_processing('$w', '$tr');
commit;
SQL
  W_ARGS=("$kw" "$2" "$w" "$tr" "$4"); L_ARGS=("$kl" "$3" "$w" "$tr" "$5")
  run_race "$SC" a "service_role|applied|$6" TERMINAL_OUTCOME_CONFLICT || return 1
  checks 8 <<SQL || return 1
select 'CHECK|status|'||status||'|$6' from public.marketplace_withdrawals where id = '$w';
select 'CHECK|transfer_id|'||provider_transfer_id||'|$tr' from public.marketplace_withdrawals where id = '$w';
select 'CHECK|ledger_total|'||count(*)||'|2' from public.marketplace_ledger_entries where reference_id = '$w';
select 'CHECK|ledger_winner_type|'||count(*)||'|2' from public.marketplace_ledger_entries where reference_id = '$w' and entry_type = '$7';
select 'CHECK|ledger_buckets|'||string_agg(bucket||':'||amount_cents, ',' order by bucket)||'|$8' from public.marketplace_ledger_entries where reference_id = '$w';
select 'CHECK|net_transfer|'||coalesce(net_transfer_cents::text,'null')||'|$9' from public.marketplace_withdrawals where id = '$w';
select 'CHECK|mark_winner|'||count(*)||'|1' from public.processed_webhook_events where provider = 'asaas' and event_key = '$kw' and event_type = '$2';
select 'CHECK|mark_loser|'||count(*)||'|0' from public.processed_webhook_events where event_key = '$kl';
SQL
  log "RESULT[$SC]: PASS"
}

scenario_B() { # sc vencedor(x|y)
  SC=$1; local c="$TOK-0000-4000-8000-0000000000$1" x="$TOK-0000-4000-8000-00000000${1}01" y="$TOK-0000-4000-8000-00000000${1}02"
  local tr="tr_${TOK}_$1_shared" kw="evt_${TOK}_$1_w" kl="evt_${TOK}_$1_l" win lose
  if [ "$2" = x ]; then win=$x lose=$y; else win=$y lose=$x; fi
  log "===== $SC: dois saques pending, $tr compartilhado, vencedor=$2 ($win)"
  absent <<SQL || return 1
select 'ABSENT|'||((select count(*) from public.companies where id = '$c') + (select count(*) from public.marketplace_withdrawals where id in ('$x','$y') or provider_transfer_id = '$tr')
  + (select count(*) from public.processed_webhook_events where event_key in ('$kw','$kl')) + (select count(*) from public.marketplace_ledger_entries where reference_id in ('$x','$y')));
SQL
  local fx; fx=$(obs "fixture-$SC" <<SQL
begin;
insert into public.companies (id, name) values ('$c', 'nf0089 harness $TOK $SC (ficticia)');
insert into public.marketplace_withdrawals (id, company_id, amount_cents, status) values ('$x', '$c', 4000, 'pending'), ('$y', '$c', 6000, 'pending');
commit;
select 'SNAP|'||md5(to_jsonb(w)::text) from public.marketplace_withdrawals w where id = '$lose';
SQL
) || { fail "$SC: fixture falhou"; return 1; }
  local snap; snap=$(echo "$fx" | sed -n 's/^SNAP|//p')
  [ -n "$snap" ] || { fail "$SC: snapshot do perdedor ausente"; return 1; }
  W_ARGS=("$kw" TRANSFER_PENDING "$win" "$tr" null); L_ARGS=("$kl" TRANSFER_PENDING "$lose" "$tr" null)
  run_race "$SC" b "service_role|applied|processing" PROVIDER_TRANSFER_ID_MISMATCH || return 1
  checks 7 <<SQL || return 1
select 'CHECK|bound_count|'||count(*)||'|1' from public.marketplace_withdrawals where provider_transfer_id = '$tr';
select 'CHECK|winner_status|'||status||'|processing' from public.marketplace_withdrawals where id = '$win' and provider_transfer_id = '$tr';
select 'CHECK|loser_unchanged|'||md5(to_jsonb(w)::text)||'|$snap' from public.marketplace_withdrawals w where id = '$lose';
select 'CHECK|loser_state|'||status||':'||coalesce(provider_transfer_id,'null')||'|pending:null' from public.marketplace_withdrawals where id = '$lose';
select 'CHECK|ledger_both|'||count(*)||'|0' from public.marketplace_ledger_entries where reference_id in ('$x', '$y');
select 'CHECK|mark_winner|'||count(*)||'|1' from public.processed_webhook_events where provider = 'asaas' and event_key = '$kw' and event_type = 'TRANSFER_PENDING';
select 'CHECK|mark_loser|'||count(*)||'|0' from public.processed_webhook_events where event_key = '$kl';
SQL
  log "RESULT[$SC]: PASS"
}

# c1/c2: política singleton da 0090 gravada (commit) como fixture local, com
# window_seconds único por execução/cenário => janela nova, sem herdar vagas.
scenario_C() { # sc perdedor_esperado
  SC=$1; local tr="tr_${TOK}_$1" kw="evt_${TOK}_$1_w" kl="evt_${TOK}_$1_l" ws
  ws=$(( 2000000 + 0x${TOK:0:5} * 3 + ${1#c} ))
  [ "$1" = c2 ] && kl=$kw
  log "===== $SC: captura 0090, capacidade 1, window_seconds=$ws, perdedor esperado $2"
  absent <<SQL || return 1
select 'ABSENT|'||((select count(*) from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr')
  + (select count(*) from public.marketplace_transfer_conflict_windows where window_seconds = $ws));
SQL
  obs "fixture-$SC" > /dev/null <<SQL || { fail "$SC: fixture falhou"; return 1; }
insert into public.marketplace_transfer_conflict_policy (id, capacity, window_seconds) values (true, 1, $ws)
  on conflict (id) do update set capacity = excluded.capacity, window_seconds = excluded.window_seconds, updated_at = now();
select 'FIX|'||capacity||'|'||window_seconds from public.marketplace_transfer_conflict_policy;
SQL
  W_ARGS=("$kw" "$tr"); L_ARGS=("$kl" "$tr")
  run_race "$SC" c "service_role|recorded|1" "$2" || return 1
  local cnt=1; [ "$1" = c2 ] && cnt=2
  checks 5 <<SQL || return 1
select 'CHECK|rows|'||count(*)||'|1' from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr';
select 'CHECK|winner_key|'||count(*)||'|1' from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr' and event_key = '$kw';
select 'CHECK|occurrence|'||sum(occurrence_count)||'|$cnt' from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr';
select 'CHECK|window_used|'||coalesce(sum(used), 0)||'|1' from public.marketplace_transfer_conflict_windows where window_seconds = $ws;
select 'CHECK|no_marks|'||count(*)||'|0' from public.processed_webhook_events where event_key in ('$kw', '$kl');
SQL
  log "RESULT[$SC]: PASS"
}

# c3: separação no BANCO (não prova integração HTTP/PostgREST nem reenvio do Asaas).
# Fixture commitada: saque fictício já completed por TRANSFER_DONE via 0089.
scenario_C3() {
  SC=c3; local c="$TOK-0000-4000-8000-0000000000c3" w="$TOK-0000-4000-8000-00000000c301" tr="tr_${TOK}_c3"
  local kd="evt_${TOK}_c3_done" kf="evt_${TOK}_c3_failed" S=c3-S app="nf0089-$TOK-c3-S" ws
  ws=$(( 2000000 + 0x${TOK:0:5} * 3 + 3 ))
  log "===== $SC: conflito financeiro -> rollback -> captura independente (window_seconds=$ws)"
  absent <<SQL || return 1
select 'ABSENT|'||((select count(*) from public.companies where id = '$c') + (select count(*) from public.marketplace_withdrawals where id = '$w' or provider_transfer_id = '$tr')
  + (select count(*) from public.processed_webhook_events where event_key in ('$kd','$kf')) + (select count(*) from public.marketplace_ledger_entries where reference_id = '$w')
  + (select count(*) from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr') + (select count(*) from public.marketplace_transfer_conflict_windows where window_seconds = $ws));
SQL
  local fx; fx=$(obs "fixture-$SC" <<SQL
begin;
insert into public.companies (id, name) values ('$c', 'nf0090 harness $TOK $SC (ficticia)');
insert into public.marketplace_withdrawals (id, company_id, amount_cents, status) values ('$w', '$c', 10000, 'pending');
select 'FIX|'||id||'|'||status from public.mark_marketplace_withdrawal_processing('$w', '$tr');
select 'FIX|'||outcome||'|'||withdrawal_status from public.process_marketplace_transfer_webhook_event('$kd', 'TRANSFER_DONE', '$w', '$tr', 150);
insert into public.marketplace_transfer_conflict_policy (id, capacity, window_seconds) values (true, 1, $ws)
  on conflict (id) do update set capacity = excluded.capacity, window_seconds = excluded.window_seconds, updated_at = now();
commit;
select 'SNAP|'||md5(to_jsonb(w)::text) from public.marketplace_withdrawals w where id = '$w';
SQL
) || { fail "$SC: fixture falhou"; return 1; }
  local snap; snap=$(echo "$fx" | sed -n 's/^SNAP|//p')
  [ -n "$snap" ] || { fail "$SC: snapshot do saque ausente"; return 1; }

  open_sess "$S" "$app"; preamble "$S"
  wait_mark "$S" ready 20 || { fail "$SC: sessão não ficou pronta"; return 1; }
  local s; s=$(sed -n 's/^SESS://p' "$RUN/sessions/$S.out" | head -1)
  SBPID[$S]=${s%%|*} SBSTART[$S]=${s#*|}
  [[ "${SBPID[$S]}" =~ ^[0-9]+$ ]] || { fail "$SC: PID do backend ausente"; return 1; }
  echo "$S backend_pid=${SBPID[$S]} backend_start=${SBSTART[$S]}" >> "$RUN/sessions/index.txt"
  has_line "$S" "ID:service_role|postgres|read committed|$app|lock_timeout=20s" || { fail "$SC: papel/isolamento/app inesperados"; return 1; }

  # 1) conflito financeiro real da 0089 (FAILED depois de DONE)
  send "$S" "select 'FIN:'||outcome||'|'||withdrawal_status from public.process_marketplace_transfer_webhook_event('$kf', 'TRANSFER_FAILED', '$w', '$tr', null);"
  send "$S" '\echo FINRES SQLSTATE :SQLSTATE LAST_ERROR :LAST_ERROR_SQLSTATE :LAST_ERROR_MESSAGE'; send "$S" '\echo MARK:fin'
  wait_mark "$S" fin 30 && has_line "$S" "FINRES SQLSTATE P0001 LAST_ERROR P0001 TERMINAL_OUTCOME_CONFLICT" && ! grep -q '^FIN:' "$RUN/sessions/$S.out" ||
    { fail "$SC: conflito financeiro não recebido exatamente"; return 1; }
  # 2) captura na MESMA transação: tem de ser recusada (transação abortada)
  local cap="select 'CAP:'||current_user||'|'||outcome||'|'||occurrence_count from public.record_marketplace_transfer_conflict('terminal_outcome_conflict', 'TRANSFER_FAILED', '$kf', '$kf', '$tr', 'uuid', '$w', 'absent', null);"
  send "$S" "$cap"; send "$S" '\echo CAPA SQLSTATE :SQLSTATE'; send "$S" '\echo MARK:capa'
  wait_mark "$S" capa 30 && has_line "$S" "CAPA SQLSTATE 25P02" || { fail "$SC: captura na transação abortada não foi recusada com 25P02"; return 1; }
  # 3) rollback confirmado
  send "$S" 'rollback;'; send "$S" '\echo RB SQLSTATE :SQLSTATE'; send "$S" '\echo MARK:rb'
  wait_mark "$S" rb 15 && has_line "$S" 'RB SQLSTATE 00000' || { fail "$SC: rollback do conflito financeiro sem confirmação"; return 1; }
  checks 4 <<SQL || return 1
select 'CHECK|rb_withdrawal_unchanged|'||md5(to_jsonb(w)::text)||'|$snap' from public.marketplace_withdrawals w where id = '$w';
select 'CHECK|rb_ledger|'||count(*)||'|2' from public.marketplace_ledger_entries where reference_id = '$w';
select 'CHECK|rb_no_failed_mark|'||count(*)||'|0' from public.processed_webhook_events where event_key = '$kf';
select 'CHECK|rb_no_capture|'||count(*)||'|0' from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr';
SQL
  # 4) captura em transação NOVA, independente
  send "$S" 'begin isolation level read committed;'
  send "$S" "set local lock_timeout = '20s'; set local statement_timeout = '60s';"
  send "$S" 'set local role service_role;'
  send "$S" "$cap"; send "$S" '\echo CAPB SQLSTATE :SQLSTATE'
  send "$S" 'commit;'; send "$S" '\echo CM SQLSTATE :SQLSTATE'; send "$S" '\echo MARK:done'
  wait_mark "$S" done 30 && has_line "$S" "CAP:service_role|recorded|1" && has_line "$S" 'CAPB SQLSTATE 00000' && has_line "$S" 'CM SQLSTATE 00000' ||
    { fail "$SC: captura independente não confirmada"; return 1; }
  close_sess "$S" || return 1
  residual_check "$SC" "$app" || return 1
  checks 9 <<SQL || return 1
select 'CHECK|withdrawal_unchanged|'||md5(to_jsonb(w)::text)||'|$snap' from public.marketplace_withdrawals w where id = '$w';
select 'CHECK|withdrawal_status|'||status||'|completed' from public.marketplace_withdrawals where id = '$w';
select 'CHECK|ledger|'||count(*)||'|2' from public.marketplace_ledger_entries where reference_id = '$w' and entry_type = 'withdrawal_completed';
select 'CHECK|mark_done|'||count(*)||'|1' from public.processed_webhook_events where event_key = '$kd';
select 'CHECK|mark_failed|'||count(*)||'|0' from public.processed_webhook_events where event_key = '$kf';
select 'CHECK|capture_rows|'||count(*)||'|1' from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr' and event_key = '$kf' and occurrence_count = 1;
select 'CHECK|capture_snapshot|'||local_link_state||':'||array_to_string(local_withdrawal_ids, ',')||':'||array_to_string(local_withdrawal_statuses, ',')||':'||array_to_string(local_link_bases, ',')||'|single:$w:completed:both' from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr';
select 'CHECK|capture_classes|'||event_key_class||':'||notification_id_class||':'||provider_transfer_id_class||'|accepted:accepted:accepted' from public.marketplace_transfer_conflicts where provider_transfer_id = '$tr';
select 'CHECK|window_used|'||coalesce(sum(used), 0)||'|1' from public.marketplace_transfer_conflict_windows where window_seconds = $ws;
SQL
  log "RESULT[$SC]: PASS"
}

for sc in "${SCS[@]}"; do
  case "$sc" in
    #               vencedor        perdedor         Wfee Lfee status    entry                buckets                                     net
    a1) scenario_A a1 TRANSFER_DONE   TRANSFER_FAILED  150  null completed withdrawal_completed transferred:10000,withdrawal_pending:-10000 9850 ;;
    a2) scenario_A a2 TRANSFER_FAILED TRANSFER_DONE    null 150  failed    withdrawal_failed    available:10000,withdrawal_pending:-10000   null ;;
    b1) scenario_B b1 x ;;
    b2) scenario_B b2 y ;;
    c1) scenario_C c1 CONFLICT_CAPTURE_CAPACITY_EXCEEDED ;;
    c2) scenario_C c2 'OK:service_role|repeated|2' ;;
    c3) scenario_C3 ;;
  esac || exit 1
done
exit 0
