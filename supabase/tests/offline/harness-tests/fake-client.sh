#!/usr/bin/env bash
# TESTE DO HARNESS -- cliente psql SIMULADO. Nunca conecta a banco algum.
# Usado só por run-harness-tests.sh via NF_SIM_CLIENT.
# Uso: fake-client.sh <script|session|observer> <application_name>
# Ambiente: FAKE_DIR (obrigatório), FAKE_MODE (lista separada por vírgulas).
set -u
mode=$1 app=$2
: "${FAKE_DIR:?}"
has() { case ",${FAKE_MODE:-}," in *",$1,"*) return 0 ;; esac; return 1; }
echo "$mode $app" >> "$FAKE_DIR/calls.log"
# Injeção de falha de gravação: planta um DIRETÓRIO no caminho que o runner vai
# gravar, dentro do run descartável do próprio teste (nunca muda permissões).
plant() { local r; for r in "$NF_EVIDENCE_ROOT"/*/; do mkdir -p "$r$1"; done; }

case "$mode" in
script)
  label=${app##*-seq-}
  has script_rc_blocked && plant "tests/$label.rc"
  cat > "$FAKE_DIR/script-$label.stdin"
  [ -f "$FAKE_DIR/script/$label.out" ] && cat "$FAKE_DIR/script/$label.out"
  [ -f "$FAKE_DIR/script/$label.err" ] && cat "$FAKE_DIR/script/$label.err" >&2
  exit "$(cat "$FAKE_DIR/script/$label.rc" 2>/dev/null || echo 0)"
  ;;

observer)
  sql=$(cat)
  tag=$(printf '%s\n' "$sql" | sed -n 's/^-- obs:\([a-z0-9_-]*\).*/\1/p' | head -1)
  printf '%s\n' "$tag" >> "$FAKE_DIR/observer-tags.log"
  has result_blocked && plant RESULT
  if has obs_rc_blocked && [[ "$tag" == ${FAKE_BLOCK_TAG:-residual-*} ]]; then
    plant "obs/$(printf %03d "$(cat "$NF_EVIDENCE_ROOT"/*/obs/.n)")-$tag.rc"
  fi
  if has observer_fail && [[ "$tag" == ${FAKE_OBS_FAIL_TAG:-*} ]]; then
    echo "psql: error: simulated observer failure" >&2; exit 2
  fi
  case "$tag" in
    blockwait-*) has no_block && echo 0 || echo 1 ;;
    advkey-*) echo "11|objid=22" ;;
    lockevidence-a*)
      echo "T|2026-01-01 00:00:00+00"
      echo "ACT|1100|$tag|postgres|idle in transaction|Client|ClientRead|blockers={}|xid=900"
      echo "ACT|1200|$tag|postgres|active|Lock|transactionid|blockers={1100}|xid=901"
      echo "WAIT|1200|transactionid|ShareLock|granted=false|rel=-|xid=900|classid=-|objid=-|objsubid=-"
      echo "HELD_W|transactionid|ExclusiveLock|rel=-|xid=900|classid=-|objid=-"
      echo "HELD_L|tuple|AccessExclusiveLock|rel=marketplace_withdrawals|classid=-|objid=-" ;;
    lockevidence-b*)
      echo "T|2026-01-01 00:00:00+00"
      echo "ACT|1100|$tag|postgres|idle in transaction|Client|ClientRead|blockers={}|xid=900"
      echo "ACT|1200|$tag|postgres|active|Lock|advisory|blockers={1100}|xid=901"
      echo "WAIT|1200|advisory|ExclusiveLock|granted=false|rel=-|xid=-|classid=11|objid=22|objsubid=1"
      echo "HELD_W|advisory|ExclusiveLock|rel=-|xid=-|classid=11|objid=22" ;;
    lockevidence-c*)
      # wrong_capture_lock: espera num advisory que não é o da captura 0090
      has wrong_capture_lock && k=91 || k=90
      echo "T|2026-01-01 00:00:00+00"
      echo "ACT|1100|$tag|postgres|idle in transaction|Client|ClientRead|blockers={}|xid=900"
      echo "ACT|1200|$tag|postgres|active|Lock|advisory|blockers={1100}|xid=-"
      echo "WAIT|1200|advisory|ExclusiveLock|granted=false|rel=-|xid=-|classid=20038|objid=$k|objsubid=2"
      echo "HELD_W|advisory|ExclusiveLock|rel=-|xid=-|classid=20038|objid=90" ;;
    fixture-*) echo "FIX|ok"; echo "SNAP|deadbeef" ;;
    absent-*) echo "ABSENT|0" ;;
    checks-*)
      # devolve cada CHECK com got = want; check_mismatch troca o primeiro
      printf '%s\n' "$sql" | sed -n "s/^select 'CHECK|\([a-z_]*\)|'.*||'|\(.*\)' from .*/\1|\2/p" |
        awk -F'|' -v bad="$(has check_mismatch && echo 1)" '{g=$2; if (bad && NR==1) g="WRONG"; print "CHECK|"$1"|"g"|"$2}' ;;
    residual-*)
      # residual: resíduo permanente; residual_until_term: some após o terminate
      if has residual || { has residual_until_term && [ ! -f "$FAKE_DIR/terminated" ]; }; then
        echo "RESID|1300|nf0089-simulated|idle|2026-01-01 00:00:00+00"
      fi ;;
    terminate-*) touch "$FAKE_DIR/terminated"; echo "TERM|1100|t" ;;
    *) : ;;
  esac
  exit 0
  ;;

session)
  echo $$ > "$FAKE_DIR/sess-$app.pid"
  in="$FAKE_DIR/sess-$app.in"; : > "$in"
  base=${app%-W}; base=${base%-L}
  SQLSTATE=00000 LAST_SQLSTATE=00000 LAST_MSG=
  while IFS= read -r line; do
    printf '%s\n' "$line" >> "$in"
    # hang: como um psql preso numa consulta, não responde mais nada; só \q encerra
    if [ -n "${hung:-}" ]; then [ "$line" = '\q' ] && { touch "$FAKE_DIR/sess-$app.closed"; exit 0; }; continue; fi
    case "$line" in
      "select 'SESS:'"*) [ "${app: -1}" = W ] && p=1100 || p=1200; echo "SESS:$p|2026-01-01 00:00:00+00" ;;
      "select 'ID:'"*) echo "ID:service_role|postgres|read committed|$app|lock_timeout=20s" ;;
      "select 'RPC:'"*)
        if has hang; then hung=1; continue; fi
        if [[ "$line" == *record_marketplace_transfer_conflict* ]]; then
          # captura 0090: perdedor só responde depois do commit/rollback do vencedor
          if [ "${app: -1}" = W ]; then echo "RPC:service_role|recorded|1"; SQLSTATE=00000
          else
            for _ in $(seq 1 150); do [ -f "$FAKE_DIR/committed-$base" ] || [ -f "$FAKE_DIR/released-$base" ] && break; sleep 0.2; done
            if [[ "$base" == *-c2 ]]; then echo "RPC:service_role|repeated|2"; SQLSTATE=00000
            else echo "ERROR:  P0001: CONFLICT_CAPTURE_CAPACITY_EXCEEDED"
              SQLSTATE=P0001 LAST_SQLSTATE=P0001 LAST_MSG=CONFLICT_CAPTURE_CAPACITY_EXCEEDED; fi
          fi
        elif [ "${app: -1}" = W ]; then
          case "$line" in *TRANSFER_DONE*) st=completed ;; *TRANSFER_FAILED*) st=failed ;; *) st=processing ;; esac
          echo "RPC:service_role|applied|$st"; SQLSTATE=00000
        else
          for _ in $(seq 1 150); do [ -f "$FAKE_DIR/committed-$base" ] || [ -f "$FAKE_DIR/released-$base" ] && break; sleep 0.2; done
          case "$line" in *TRANSFER_PENDING*) err=PROVIDER_TRANSFER_ID_MISMATCH ;; *) err=TERMINAL_OUTCOME_CONFLICT ;; esac
          echo "ERROR:  P0001: $err"; SQLSTATE=P0001 LAST_SQLSTATE=P0001 LAST_MSG=$err
        fi ;;
      # c3: conflito financeiro aborta a transação; captura nela => 25P02 (no_abort simula o contrário)
      "select 'FIN:'"*) echo "ERROR:  P0001: TERMINAL_OUTCOME_CONFLICT"
        SQLSTATE=P0001 LAST_SQLSTATE=P0001 LAST_MSG=TERMINAL_OUTCOME_CONFLICT; has no_abort || aborted=1 ;;
      "select 'CAP:'"*)
        if [ -n "${aborted:-}" ]; then echo "ERROR:  25P02: current transaction is aborted"; SQLSTATE=25P02
        else echo "CAP:service_role|recorded|1"; SQLSTATE=00000; fi ;;
      "commit;") touch "$FAKE_DIR/committed-$base"; SQLSTATE=00000 ;;
      "rollback;") touch "$FAKE_DIR/released-$base"; aborted=  # rollback do vencedor libera o perdedor
        if has rollback_fail; then SQLSTATE=XX000; else SQLSTATE=00000; fi ;;
      '\q')
        if [ "${app: -1}" = W ] && has kill_parent; then
          # registro de rc "0" que não corresponde ao término real: o processo
          # local da sessão (pai) morre por sinal antes de gravar o rc verdadeiro
          n=${app#nf0089-}; n=${n#*-}
          for r in "$NF_EVIDENCE_ROOT"/*/sessions; do echo 0 > "$r/$n.rc"; done
          kill -KILL "$PPID"; touch "$FAKE_DIR/sess-$app.closed"; exit 0
        fi
        # stuck: o vencedor ignora \q e EOF e só morre se alguém o matar
        if [ "${app: -1}" = W ] && has stuck; then stuck=1; continue; fi
        touch "$FAKE_DIR/sess-$app.closed"; exit 0 ;;
      '\echo '*)
        out=${line#\\echo }
        out=${out//:LAST_ERROR_SQLSTATE/$LAST_SQLSTATE}
        out=${out//:LAST_ERROR_MESSAGE/$LAST_MSG}
        out=${out//:SQLSTATE/$SQLSTATE}
        echo "$out" ;;
      *) : ;;
    esac
  done
  if [ -n "${stuck:-}" ]; then while :; do sleep 1; done; fi
  touch "$FAKE_DIR/sess-$app.closed"
  ;;
*) echo "fake-client: modo inválido '$mode'" >&2; exit 64 ;;
esac
