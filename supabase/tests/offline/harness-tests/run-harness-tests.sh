#!/usr/bin/env bash
# TESTES DO HARNESS -- não testam a RPC nem tocam banco algum. Todo cliente é
# simulado (fake-client.sh / docker falso no PATH do grupo legacy).
#
# Uso: HARNESS_TEST_WORK=<diretório absoluto inexistente> \
#        run-harness-tests.sh <tap|seq|conc|trial|evid|close|catalog|legacy|all>
#   all    = todos menos legacy (o grupo legacy reproduz defeitos do harness
#            histórico e deve FALHAR; roda só se pedido explicitamente).
#   TAPCHECK=<awk> troca o verificador testado no grupo tap.
set -u
shopt -s lastpipe  # `gerador | cat_case` mantém contadores no shell atual
H=$(cd "$(dirname "$0")/.." && pwd)
FAKE="$H/harness-tests/fake-client.sh"
TAPCHECK=${TAPCHECK:-$H/lib/tapcheck.awk}
WORK=${HARNESS_TEST_WORK:?defina HARNESS_TEST_WORK (diretório novo)}
group=${1:-}
case "$group" in tap|seq|conc|trial|evid|close|catalog|legacy|all) ;; *) echo "uso: $0 <tap|seq|conc|trial|evid|close|catalog|legacy|all>" >&2; exit 2 ;; esac
mkdir "$WORK" || { echo "HARNESS_TEST_WORK já existe: $WORK" >&2; exit 2; }
npass=0 nfail=0
ok()  { npass=$((npass + 1)); echo "  ok   - $1"; }
bad() { nfail=$((nfail + 1)); echo "  FAIL - $1${2:+ ($2)}"; }
expect() { [ "$2" = "$3" ] && ok "$1" || bad "$1" "esperado '$3', obtido '$2'"; }

# ---------------------------------------------------------------- tap
tap_case() { # nome  esperado(PASS|FAIL)  stdout  stderr  rc|none
  local d=$WORK/tap/$((npass + nfail)); mkdir -p "$d"
  printf '%b' "$3" > "$d/out"; printf '%b' "$4" > "$d/err"
  local got
  if [ "$5" = none ]; then awk -f "$TAPCHECK" "$d/out" "$d/err" > "$d/verdict" 2>&1
  else awk -v rc="$5" -f "$TAPCHECK" "$d/out" "$d/err" > "$d/verdict" 2>&1; fi
  [ $? -eq 0 ] && got=PASS || got=FAIL
  expect "tap: $1" "$got" "$2"
}
group_tap() {
  echo "# grupo tap ($TAPCHECK)"
  tap_case "TAP válido, rc 0"                         PASS '1..2\nok 1 - a\nok 2 - b\n' '' 0
  tap_case "diagnóstico # permitido"                  PASS '1..1\n# nota\nok 1 - a\n' '' 0
  tap_case "# escapado na descrição não é diretiva"   PASS '1..1\nok 1 - a \\# TODO literal\n' '' 0
  tap_case "TAP completo mas cliente rc 1"            FAIL '1..2\nok 1 - a\nok 2 - b\n' '' 1
  tap_case "TAP completo mas cliente rc 3"            FAIL '1..1\nok 1 - a\n' '' 3
  tap_case "rc do cliente não informado"              FAIL '1..1\nok 1 - a\n' '' none
  tap_case "incompleto (plano 3, executou 2)"         FAIL '1..3\nok 1\nok 2\n' '' 0
  tap_case "sem plano"                                FAIL 'ok 1 - a\n' '' 0
  tap_case "dois planos"                              FAIL '1..1\n1..1\nok 1\n' '' 0
  tap_case "plano depois dos testes"                  FAIL 'ok 1 - a\n1..1\n' '' 0
  tap_case "plano 1..0"                               FAIL '1..0\n' '' 0
  tap_case "numeração com zero à esquerda"            FAIL '1..1\nok 01 - a\n' '' 0
  tap_case "número com sufixo (ok 1x)"                FAIL '1..1\nok 1x - a\n' '' 0
  tap_case "numeração fora de ordem"                  FAIL '1..2\nok 2\nok 1\n' '' 0
  tap_case "linha desconhecida"                       FAIL '1..1\nok 1 - a\nhello\n' '' 0
  tap_case "linha vazia"                              FAIL '1..1\n\nok 1 - a\n' '' 0
  tap_case "saída vazia"                              FAIL '' '' 0
  tap_case "not ok"                                   FAIL '1..2\nok 1\nnot ok 2 - b\n' '' 0
  tap_case "Bail out!"                                FAIL '1..2\nok 1\nBail out! x\n' '' 0
  tap_case "# Looks like"                             FAIL '1..1\nok 1\n# Looks like you planned 2 tests but ran 1\n' '' 0
  tap_case "TODO não conta como aprovado"             FAIL '1..1\nok 1 - a # TODO depois\n' '' 0
  tap_case "SKIP não conta como aprovado"             FAIL '1..1\nok 1 # SKIP sem dado\n' '' 0
  tap_case "skip minúsculo também"                    FAIL '1..1\nok 1 - a # skip x\n' '' 0
  tap_case "erro SQL no stderr"                       FAIL '1..2\nok 1\n' 'psql:<stdin>:9: ERROR:  boom\n' 0
  tap_case "qualquer stderr (NOTICE) reprova"         FAIL '1..1\nok 1\n' 'NOTICE:  algo\n' 0
}

# ---------------------------------------------------------------- comum aos runners
SIMENV() { # dir_evidências dir_fake modo
  local d=$1 f=$2 m=$3; shift 3
  env -u NF_LAB_CONTEXT -u NF_LAB_ENDPOINT -u NF_LAB_CONTAINER -u NF_LAB_CONTAINER_ID -u NF_LAB_VOLUME -u NF_LAB_CONFIRM \
      NF_HARNESS_SIMULATE=1 NF_SIM_CLIENT="$FAKE" NF_EVIDENCE_ROOT="$d" FAKE_DIR="$f" FAKE_MODE="$m" \
      FAKE_OBS_FAIL_TAG="${FAKE_OBS_FAIL_TAG:-*}" "$@"
}
newcase() { C=$WORK/$1; mkdir -p "$C/ev" "$C/fake/script"; }
result_of() { # conteúdo da 1a linha de RESULT do único run criado
  local n; n=$(find "$C/ev" -mindepth 1 -maxdepth 1 -type d | wc -l)
  [ "$n" = 1 ] || { echo "runs=$n"; return; }
  head -1 "$(find "$C/ev" -mindepth 1 -maxdepth 1 -type d)/RESULT" 2>/dev/null || echo "sem RESULT"
}
ncalls() { [ -f "$C/fake/calls.log" ] && wc -l < "$C/fake/calls.log" | tr -d ' ' || echo 0; }

# ---------------------------------------------------------------- seq
seq_run() { # modo args...
  local m=$1; shift
  SIMENV "$C/ev" "$C/fake" "$m" bash "$H/run-sequential.sh" "$@" > "$C/stdout" 2> "$C/stderr"
}
announced_pass() { grep -q 'RESULT: PASS' "$C/stdout" && echo yes || echo no; }
reasons() { cat "$(find "$C/ev" -mindepth 2 -maxdepth 2 -name RESULT -type f | head -1)" 2>/dev/null; }
has_reason() { reasons | grep -q -- "$1" && echo yes || echo no; }
group_seq() {
  echo "# grupo seq"
  local sql=$WORK/dummy.test.sql; [ -f "$sql" ] || echo "select 1;" > "$sql"
  local tap='1..2\nok 1 - a\nok 2 - b\n'

  newcase s-pass; printf '%b' "$tap" > "$C/fake/script/t1.out"
  seq_run "" "t1=$sql"; expect "seq: TAP válido e rc 0 => exit 0" "$?" 0
  expect "seq: TAP válido e rc 0 => RESULT PASS" "$(result_of)" PASS

  newcase s-rc; printf '%b' "$tap" > "$C/fake/script/t1.out"; echo 1 > "$C/fake/script/t1.rc"
  seq_run "" "t1=$sql"; expect "seq: TAP completo + cliente rc 1 => exit 1" "$?" 1
  expect "seq: TAP completo + cliente rc 1 => RESULT FAIL" "$(result_of)" FAIL

  newcase s-stop; printf '1..1\nnot ok 1\n' > "$C/fake/script/t1.out"; printf '%b' "$tap" > "$C/fake/script/t2.out"
  seq_run "" "t1=$sql" "t2=$sql"; expect "seq: primeira falha => exit 1" "$?" 1
  grep -q -- '-seq-t2$' "$C/fake/calls.log" && bad "seq: arquivo seguinte não roda após falha" || ok "seq: arquivo seguinte não roda após falha"

  newcase s-resid; printf '%b' "$tap" > "$C/fake/script/t1.out"
  seq_run residual "t1=$sql"; expect "seq: sessão residual => exit 1" "$?" 1
  expect "seq: sessão residual => RESULT FAIL" "$(result_of)" FAIL

  newcase s-obs; printf '%b' "$tap" > "$C/fake/script/t1.out"
  seq_run observer_fail "t1=$sql"; expect "seq: falha do observador => exit 1" "$?" 1
  expect "seq: falha do observador => RESULT FAIL" "$(result_of)" FAIL

  local args
  for args in "" "t1" "t1=" "=$sql" "t1=$WORK/nao-existe.sql" "T1=$sql" "--foo" "t1=$sql t1=$sql" "t1=$sql extra"; do
    newcase "s-args-$((npass + nfail))"
    # shellcheck disable=SC2086
    seq_run "" $args; local rc=$?
    expect "seq: argumentos inválidos [$args] => exit 2" "$rc" 2
    expect "seq: argumentos inválidos [$args] => nenhuma chamada ao cliente" "$(ncalls)" 0
    expect "seq: argumentos inválidos [$args] => nenhum run criado" "$(find "$C/ev" -mindepth 1 | wc -l | tr -d ' ')" 0
  done

  newcase s-noroot
  env -u NF_EVIDENCE_ROOT NF_HARNESS_SIMULATE=1 NF_SIM_CLIENT="$FAKE" FAKE_DIR="$C/fake" bash "$H/run-sequential.sh" "t1=$sql" > "$C/stdout" 2>&1
  expect "seq: sem NF_EVIDENCE_ROOT => exit 2" "$?" 2
  expect "seq: sem NF_EVIDENCE_ROOT => nenhuma chamada" "$(ncalls)" 0

  newcase s-ambig
  env NF_HARNESS_SIMULATE=1 NF_SIM_CLIENT="$FAKE" NF_EVIDENCE_ROOT="$C/ev" FAKE_DIR="$C/fake" NF_LAB_CONFIRM=x \
    bash "$H/run-sequential.sh" "t1=$sql" > "$C/stdout" 2>&1
  expect "seq: simulação + alvo real ao mesmo tempo => exit 2" "$?" 2

  newcase s-inrepo
  env NF_HARNESS_SIMULATE=1 NF_SIM_CLIENT="$FAKE" NF_EVIDENCE_ROOT="$H" FAKE_DIR="$C/fake" \
    bash "$H/run-sequential.sh" "t1=$sql" > "$C/stdout" 2>&1
  expect "seq: evidências dentro do repositório => exit 2" "$?" 2

  newcase s-reallab
  env -u NF_HARNESS_SIMULATE NF_EVIDENCE_ROOT="$C/ev" NF_LAB_CONTEXT=x \
    bash "$H/run-sequential.sh" "t1=$sql" > "$C/stdout" 2>&1
  expect "seq: alvo real incompleto (sem confirmação) => exit 2" "$?" 2
}

# ---------------------------------------------------------------- conc
conc_run() { # modo args...
  local m=$1; shift
  SIMENV "$C/ev" "$C/fake" "$m" bash "$H/run-concurrency.sh" "$@" > "$C/stdout" 2> "$C/stderr"
}
live_fakes() { # processos de sessão simulada ainda vivos (e os encerra, para não vazar do teste)
  local f p out=
  for f in "$C"/fake/sess-*.pid; do
    [ -f "$f" ] || continue; p=$(cat "$f")
    kill -0 "$p" 2>/dev/null && { out="$out $p"; kill -KILL "$p" 2>/dev/null; }
  done
  echo "${out:-none}"
}
all_closed() { # todas as sessões simuladas receberam \q/EOF e nenhum processo segue vivo
  local f p n=0
  for f in "$C"/fake/sess-*.pid; do
    [ -f "$f" ] || continue; n=$((n + 1))
    [ -f "${f%.pid}.closed" ] || { echo "aberta:$(basename "$f")"; return; }
    p=$(cat "$f"); kill -0 "$p" 2>/dev/null && { echo "viva:$p"; return; }
  done
  [ $n -gt 0 ] && echo closed || echo "nenhuma sessão"
}
got_rollback() { grep -qx 'rollback;' "$(ls "$C"/fake/sess-*-"$1"-W.in)" && echo yes || echo no; }
group_conc() {
  echo "# grupo conc"
  newcase c-pass; conc_run "" --scenarios a1,b1; expect "conc: a1,b1 simulados => exit 0" "$?" 0
  expect "conc: a1,b1 simulados => RESULT PASS" "$(result_of)" PASS
  expect "conc: a1,b1 => sessões fechadas e processos encerrados" "$(all_closed)" closed

  newcase c-obs; FAKE_OBS_FAIL_TAG='blockwait-*' conc_run observer_fail --scenarios a1,b1
  expect "conc: falha do observador => exit 1" "$?" 1
  expect "conc: falha do observador => RESULT FAIL" "$(result_of)" FAIL
  expect "conc: falha do observador => sessões fechadas" "$(all_closed)" closed
  expect "conc: falha do observador => vencedor recebeu rollback" "$(got_rollback a1)" yes
  ls "$C"/fake/sess-*-b1-* >/dev/null 2>&1 && bad "conc: cenário seguinte não roda após falha" || ok "conc: cenário seguinte não roda após falha"

  newcase c-rb; conc_run rollback_fail --scenarios a1; expect "conc: rollback falha => exit 1" "$?" 1
  expect "conc: rollback falha => RESULT FAIL" "$(result_of)" FAIL
  expect "conc: rollback falha => sessões fechadas" "$(all_closed)" closed

  newcase c-resid; conc_run residual --scenarios a1; expect "conc: sessão residual => exit 1" "$?" 1
  expect "conc: sessão residual => RESULT FAIL" "$(result_of)" FAIL

  newcase c-noblock; conc_run no_block --scenarios a1; expect "conc: bloqueio não observado => exit 1" "$?" 1
  expect "conc: bloqueio não observado => RESULT FAIL" "$(result_of)" FAIL
  [ -e "$(ls -d "$C"/fake/committed-* 2>/dev/null | head -1)" ] && bad "conc: sem bloqueio o vencedor não faz commit" || ok "conc: sem bloqueio o vencedor não faz commit"
  expect "conc: bloqueio não observado => sessões fechadas" "$(all_closed)" closed

  newcase c-check; conc_run check_mismatch --scenarios b1; expect "conc: verificação final divergente => exit 1" "$?" 1
  expect "conc: verificação final divergente => RESULT FAIL" "$(result_of)" FAIL

  # c1/c2: captura da 0090 (capacidade esgotada / repetição sem nova vaga)
  newcase c-cap; conc_run "" --scenarios c1,c2; expect "conc: c1,c2 simulados => exit 0" "$?" 0
  expect "conc: c1,c2 => RESULT PASS" "$(result_of)" PASS
  expect "conc: c1,c2 => sessões fechadas e processos encerrados" "$(all_closed)" closed
  grep -qx 'rollback;' "$(ls "$C"/fake/sess-*-c1-L.in)" && ok "conc: c1 perdedor (capacidade) termina em rollback" || bad "conc: c1 perdedor (capacidade) termina em rollback"
  grep -qx 'commit;' "$(ls "$C"/fake/sess-*-c2-L.in)" && ok "conc: c2 perdedor (repetição) confirma com commit" || bad "conc: c2 perdedor (repetição) confirma com commit"

  newcase c-caplock; conc_run wrong_capture_lock --scenarios c1; expect "conc: c1 espera em outro advisory => exit 1" "$?" 1
  expect "conc: c1 espera em outro advisory => RESULT FAIL" "$(result_of)" FAIL
  [ -e "$(ls -d "$C"/fake/committed-* 2>/dev/null | head -1)" ] && bad "conc: c1 lock errado => vencedor não faz commit" || ok "conc: c1 lock errado => vencedor não faz commit"

  # c3: conflito financeiro -> captura na mesma transação abortada recusada -> rollback -> captura em transação nova
  newcase c-chain; conc_run "" --scenarios c3; expect "conc: c3 simulado => exit 0" "$?" 0
  expect "conc: c3 => RESULT PASS" "$(result_of)" PASS
  expect "conc: c3 => sessão fechada e processo encerrado" "$(all_closed)" closed
  local seqc3; seqc3=$(grep -E "^(select 'FIN:|select 'CAP:|rollback;|commit;)" "$(ls "$C"/fake/sess-*-c3-S.in)" | sed -E "s/^select '(FIN|CAP):.*/\1/" | tr '\n' ' ')
  expect "conc: c3 => ordem FIN, CAP (abortada), rollback, CAP, commit" "$seqc3" "FIN CAP rollback; CAP commit; "

  newcase c-chain-noabort; conc_run no_abort --scenarios c3; expect "conc: c3 captura aceita na transação abortada => exit 1" "$?" 1
  expect "conc: c3 captura aceita na transação abortada => RESULT FAIL" "$(result_of)" FAIL

  newcase c-chain-rb; conc_run rollback_fail --scenarios c3; expect "conc: c3 rollback não confirmado => exit 1" "$?" 1
  expect "conc: c3 rollback não confirmado => RESULT FAIL" "$(result_of)" FAIL
  grep -qx 'commit;' "$(ls "$C"/fake/sess-*-c3-S.in)" && bad "conc: c3 rollback não confirmado => nenhuma captura confirmada" || ok "conc: c3 rollback não confirmado => nenhuma captura confirmada"
  expect "conc: c3 rollback não confirmado => sessão fechada" "$(all_closed)" closed

  newcase c-int
  (
    unset NF_LAB_CONTEXT NF_LAB_ENDPOINT NF_LAB_CONTAINER NF_LAB_CONTAINER_ID NF_LAB_VOLUME NF_LAB_CONFIRM
    export NF_HARNESS_SIMULATE=1 NF_SIM_CLIENT="$FAKE" NF_EVIDENCE_ROOT="$C/ev" FAKE_DIR="$C/fake" FAKE_MODE=hang FAKE_OBS_FAIL_TAG='*'
    exec bash "$H/run-concurrency.sh" --scenarios a1
  ) > "$C/stdout" 2>&1 &
  local rp=$! i
  for i in $(seq 1 100); do grep -qs "^select 'RPC:" "$C"/fake/sess-*-a1-W.in && break; sleep 0.2; done
  kill -TERM "$rp"
  for i in $(seq 1 300); do kill -0 "$rp" 2>/dev/null || break; sleep 0.2; done
  kill -0 "$rp" 2>/dev/null && { bad "conc: runner termina após SIGTERM"; kill -KILL "$rp"; }
  wait "$rp"; local rc=$?
  [ "$rc" -ne 0 ] && ok "conc: SIGTERM => exit != 0 ($rc)" || bad "conc: SIGTERM => exit != 0" "rc=0"
  expect "conc: SIGTERM => RESULT INTERRUPTED" "$(result_of)" INTERRUPTED
  expect "conc: SIGTERM => vencedor recebeu rollback" "$(got_rollback a1)" yes
  expect "conc: SIGTERM => sessões fechadas e processos encerrados" "$(all_closed)" closed

  local args
  for args in "" "--scenarios" "--scenarios zz" "--scenarios c4" "--scenarios c1,c1" "--scenarios c3,c3" "--scenarios a1,a1" "--scenarios a1 extra" "--foo" \
              "--scenarios a1," "--scenarios ,a1" "--scenarios a1,,b1" "--scenarios ," "--scenarios a1,b1,"; do
    newcase "c-args-$((npass + nfail))"
    # shellcheck disable=SC2086
    conc_run "" $args; local rc2=$?
    expect "conc: argumentos inválidos [$args] => exit 2" "$rc2" 2
    expect "conc: argumentos inválidos [$args] => nenhuma chamada" "$(ncalls)" 0
    expect "conc: argumentos inválidos [$args] => nenhum run criado" "$(find "$C/ev" -mindepth 1 | wc -l | tr -d ' ')" 0
  done
  newcase "c-args-empty"; conc_run "" --scenarios ""
  expect "conc: lista vazia [--scenarios ''] => exit 2" "$?" 2
  expect "conc: lista vazia => nenhum run criado" "$(find "$C/ev" -mindepth 1 | wc -l | tr -d ' ')" 0
}

# ---------------------------------------------------------------- trial race
# Usa o mesmo runner transacional em duas sessões, mas só o cliente fake; não toca banco.
group_trial() {
  echo "# grupo trial"
  newcase d-pass; conc_run "" --scenarios d1,d2
  expect "trial: d1,d2 simulados => exit 0" "$?" 0
  expect "trial: d1,d2 simulados => RESULT PASS" "$(result_of)" PASS
  expect "trial: d1,d2 => sessões fechadas" "$(all_closed)" closed
  grep -q 'link_asaas_subscription' "$C"/fake/sess-*-d1-W.in &&
    grep -q 'grant_staging_trial' "$C"/fake/sess-*-d1-L.in &&
    grep -q 'grant_staging_trial' "$C"/fake/sess-*-d2-W.in &&
    grep -q 'link_asaas_subscription' "$C"/fake/sess-*-d2-L.in &&
    ok "trial: d1 link vence / d2 concessão vence; operações opostas verificadas" || bad "trial: chamadas concorrentes esperadas ausentes"

  newcase d-noblock; conc_run no_block --scenarios d1
  expect "trial: bloqueio de empresa não observado => exit 1" "$?" 1
  expect "trial: bloqueio de empresa não observado => RESULT FAIL" "$(result_of)" FAIL
  expect "trial: sem bloqueio => sessões fechadas" "$(all_closed)" closed
  [ -n "$(find "$C/fake" -maxdepth 1 -type f -name 'committed-*' -print -quit)" ] &&
    bad "trial: sem bloqueio o vencedor não faz commit" || ok "trial: sem bloqueio o vencedor não faz commit"

  newcase d-wronglock; conc_run wrong_trial_lock --scenarios d1
  expect "trial: lock em relação diferente de companies => exit 1" "$?" 1
  expect "trial: lock incorreto => RESULT FAIL" "$(result_of)" FAIL
  expect "trial: lock incorreto => sessões fechadas" "$(all_closed)" closed
  [ -n "$(find "$C/fake" -maxdepth 1 -type f -name 'committed-*' -print -quit)" ] &&
    bad "trial: lock incorreto não pode confirmar o vencedor" || ok "trial: lock incorreto não pode confirmar o vencedor"

  local args
  for args in "--scenarios d3" "--scenarios d1,d1" "--scenarios d1,"; do
    newcase "d-args-$((npass + nfail))"
    # shellcheck disable=SC2086
    conc_run "" $args; local rc=$?
    expect "trial: argumentos inválidos [$args] => exit 2" "$rc" 2
    expect "trial: argumentos inválidos [$args] => nenhuma chamada" "$(ncalls)" 0
    expect "trial: argumentos inválidos [$args] => nenhum run criado" "$(find "$C/ev" -mindepth 1 | wc -l | tr -d ' ')" 0
  done
}

# ---------------------------------------------------------------- evid
# Falha de gravação injetada plantando um DIRETÓRIO no caminho que o runner
# grava, dentro do run descartável do teste (sem encher disco nem mudar permissões).
group_evid() {
  echo "# grupo evid"
  local sql=$WORK/dummy.test.sql; [ -f "$sql" ] || echo "select 1;" > "$sql"
  local tap='1..2\nok 1 - a\nok 2 - b\n'

  newcase e-rc; printf '%b' "$tap" > "$C/fake/script/t1.out"
  seq_run script_rc_blocked "t1=$sql"; expect "evid: rc do teste não gravado => exit 1" "$?" 1
  expect "evid: rc do teste não gravado => RESULT FAIL" "$(result_of)" FAIL
  expect "evid: rc do teste não gravado => sem anúncio de PASS" "$(announced_pass)" no

  newcase e-obsrc; printf '%b' "$tap" > "$C/fake/script/t1.out"
  FAKE_BLOCK_TAG='residual-*' seq_run obs_rc_blocked "t1=$sql"; expect "evid: rc do observador não gravado => exit 1" "$?" 1
  expect "evid: rc do observador não gravado => RESULT FAIL" "$(result_of)" FAIL

  newcase e-prov; printf '%b' "$tap" > "$C/fake/script/t1.out"; mkdir -p "$C/bin"
  printf '#!/usr/bin/env bash\necho "sha256sum: falha simulada" >&2\nexit 1\n' > "$C/bin/sha256sum"; chmod +x "$C/bin/sha256sum"
  PATH="$C/bin:$PATH" seq_run "" "t1=$sql"; expect "evid: hash de proveniência falha => exit 1" "$?" 1
  expect "evid: hash de proveniência falha => RESULT FAIL" "$(result_of)" FAIL
  expect "evid: hash de proveniência falha => nenhum teste executado" "$(grep -c ' nf0089-.*-seq-' "$C/fake/calls.log" 2>/dev/null || echo 0)" 0

  # lab_preflight simulado não chama o cliente: roda a sequência real dos runners
  # (traps -> lab_preflight || exit 1 -> finalize) num run descartável com lab.txt bloqueado
  newcase e-lab; local r=$C/ev/run; mkdir -p "$r/obs" "$r/provenance/lab.txt" "$r/sessions" "$r/tests"
  ( source "$H/lib/common.sh"; RUN=$r MODE=simulated NF_SIM_CLIENT=$FAKE TOK=00000000
    install_traps; lab_preflight || exit 1; exit 0 ) > "$C/stdout" 2> "$C/stderr"
  local rcl=$?
  [ "$rcl" -ne 0 ] && ok "evid: lab.txt não gravado => exit != 0 ($rcl)" || bad "evid: lab.txt não gravado => exit != 0" "rc=0"
  expect "evid: lab.txt não gravado => RESULT FAIL" "$(head -1 "$r/RESULT" 2>/dev/null)" FAIL
  expect "evid: lab.txt não gravado => sem anúncio de PASS" "$(announced_pass)" no
  grep -q 'evidência não gravada: lab.txt' "$r/RESULT" 2>/dev/null && ok "evid: lab.txt não gravado => diagnóstico no RESULT" || bad "evid: lab.txt não gravado => diagnóstico no RESULT"

  newcase e-result; printf '%b' "$tap" > "$C/fake/script/t1.out"
  seq_run result_blocked "t1=$sql"; local rc=$?
  [ "$rc" -ne 0 ] && ok "evid: RESULT não gravável => exit != 0 ($rc)" || bad "evid: RESULT não gravável => exit != 0" "rc=0"
  expect "evid: RESULT não gravável => sem anúncio de PASS" "$(announced_pass)" no
  grep -q 'não gravei RESULT' "$C/stderr" && ok "evid: RESULT não gravável => diagnóstico em stderr" || bad "evid: RESULT não gravável => diagnóstico em stderr"
}

# ---------------------------------------------------------------- close
group_close() {
  echo "# grupo close"
  newcase k-wait; conc_run kill_parent --scenarios a1
  expect "close: rc registrado 0 mas processo local morto por sinal => exit 1" "$?" 1
  expect "close: wait anormal => RESULT FAIL" "$(result_of)" FAIL
  expect "close: wait anormal => motivo cita wait" "$(has_reason 'wait=')" yes

  newcase k-stuck; conc_run stuck --scenarios a1
  expect "close: cliente preso => exit 1" "$?" 1
  expect "close: cliente preso => RESULT FAIL" "$(result_of)" FAIL
  expect "close: cliente preso => processo do cliente registrado encerrado" "$(live_fakes)" none

  newcase k-persist; conc_run residual --scenarios a1
  expect "close: resíduo persistente => exit 1" "$?" 1
  expect "close: resíduo persistente => motivo registra persistência após encerramento" "$(has_reason 'persistem após o encerramento')" yes

  newcase k-cleared; conc_run residual_until_term --scenarios a1
  expect "close: resíduo removido pelo encerramento => ainda FAIL" "$(result_of)" FAIL
  grep -q 'confirmado: nenhuma sessão residual após o encerramento' "$C"/ev/*/run.log &&
    ok "close: resíduo removido => nova observação confirma ausência" || bad "close: resíduo removido => nova observação confirma ausência"

  newcase k-termfail; FAKE_OBS_FAIL_TAG='terminate-*' conc_run residual,observer_fail --scenarios a1
  expect "close: observador falha no encerramento => exit 1" "$?" 1
  expect "close: observador falha no encerramento => motivo registrado" "$(has_reason 'encerramento do backend')" yes

  newcase k-finalobs; FAKE_OBS_FAIL_TAG='residual-final' conc_run observer_fail --scenarios a1
  expect "close: observador final falha => exit 1" "$?" 1
  expect "close: observador final falha => RESULT FAIL" "$(result_of)" FAIL
  expect "close: observador final falha => estado desconhecido registrado" "$(has_reason 'desconhecido')" yes
}

# ---------------------------------------------------------------- catalog
# Exercita catalog_capture real (extração dos corpos da migration 0089 da
# worktree + comparação); só o observador é substituído por linhas FN| fixas.
# md5 = valores do catálogo real do laboratório (HEAD 235bd1e, harnessfix-20261028).
CL=1bbfe2c98d2258c7d055bb7c1ef92159 CM=e8a573f09ce474b2a8feb29c6326552b
CF=1d0d135a524b133560de9f0de315f279 CP=4e9abd931d8bc90419e045cfb051337f
fn() { echo "FN|$1|owner=postgres|secdef=true|config={search_path=public}|acl={postgres=X/postgres}|md5=$2"; }
fn_all() { # prefixo
  fn "$1lock_marketplace_transfer_identity(uuid,text)" $CL
  fn "$1mark_marketplace_withdrawal_processing(uuid,text)" $CM
  fn "$1finalize_marketplace_withdrawal(uuid,text,text,integer,text,text)" $CF
  fn "$1process_marketplace_transfer_webhook_event(text,text,uuid,text,integer)" $CP
}
cat_case() { # nome rc_esperado [bloquear_evidência]; linhas FN no stdin
  local d=$WORK/cat/$((npass + nfail)); mkdir -p "$d/provenance"
  cat > "$d/fn.txt"
  [ -n "${3:-}" ] && mkdir "$d/provenance/applied-evidence.txt"
  ( source "$H/lib/common.sh"; RUN=$d MODE=real
    obs() { [ "$1" = functions-0089 ] && cat "$d/fn.txt"; cat > /dev/null; return 0; }
    catalog_capture ) > "$d/out" 2>&1
  expect "catalog: $1 => rc $2" "$?" "$2"
  D=$d
}
group_catalog() {
  echo "# grupo catalog"
  fn_all "" | cat_case "não qualificado, corpos iguais" 0
  expect "catalog: não qualificado => 4 MATCH" "$(grep -c '^MATCH ' "$D/provenance/applied-evidence.txt")" 4
  grep -q '^HISTORY ' "$D/provenance/applied-evidence.txt" && ok "catalog: histórico de aplicação declarado à parte" || bad "catalog: histórico de aplicação declarado à parte"
  grep -q '^RECORDED owner/acl ' "$D/provenance/applied-evidence.txt" && ok "catalog: owner/ACL registrados à parte, sem comparação" || bad "catalog: owner/ACL registrados à parte, sem comparação"
  fn_all "public." | cat_case "qualificado public., corpos iguais" 0
  fn_all "" | grep -v process_marketplace | cat_case "função ausente" 1
  fn_all "" | sed "s/md5=$CL/md5=00000000000000000000000000000000/" | cat_case "corpo divergente" 1
  fn_all "" | sed 's/lock_marketplace_transfer_identity(uuid,text)/lock_marketplace_transfer_identity(uuid)/' | cat_case "só assinatura diferente com corpo igual" 1
  { fn_all ""; fn "lock_marketplace_transfer_identity(uuid)" $CL; } | cat_case "assinatura extra (sobrecarga) com o mesmo nome" 1
  fn_all "" | sed 's/^FN|lock_/FN|audit.lock_/' | cat_case "schema diferente de public" 1
  fn_all "" | cat_case "applied-evidence.txt não gravável" 1 block
}

# ---------------------------------------------------------------- legacy
# Reproduz, numa CÓPIA byte a byte do runner histórico (seqval-20261028), os
# achados da revisão: rc do cliente ignorado e argumentos ausentes aceitos.
# docker falso no PATH: o histórico nunca alcança o daemon.
group_legacy() {
  echo "# grupo legacy (esperado: FALHAR -- reproduz defeitos do harness histórico)"
  local src=${LEGACY_SEQVAL:-/d/Projetos/_recovery/nf-bootstrap-offline-a01/seqval-20261028}
  local L=$WORK/legacy; mkdir -p "$L/bin"
  cp "$src/run-tests.sh" "$src/tapcheck.awk" "$L/"
  expect "legacy: cópia idêntica de run-tests.sh" "$(sha256sum < "$L/run-tests.sh")" "$(sha256sum < "$src/run-tests.sh")"
  printf '#!/usr/bin/env bash\ncat > /dev/null\nprintf "1..1\\nok 1 - a\\n"\nexit 1\n' > "$L/bin/docker"
  echo "select 1;" > "$L/x.sql"
  PATH="$L/bin:$PATH" bash "$L/run-tests.sh" t1 "$L/x.sql" > "$L/o1" 2>&1
  expect "legacy: TAP completo + cliente rc 1 deveria reprovar" "$?" 1
  PATH="$L/bin:$PATH" bash "$L/run-tests.sh" > "$L/o2" 2>&1
  expect "legacy: sem argumentos deveria recusar" "$?" 2
  PATH="$L/bin:$PATH" bash "$L/run-tests.sh" t1 "$L/x.sql" orfao > "$L/o3" 2>&1
  expect "legacy: argumento sem par deveria recusar" "$?" 2
}

case "$group" in
  tap) group_tap ;; seq) group_seq ;; conc) group_conc ;; trial) group_trial ;; legacy) group_legacy ;;
  evid) group_evid ;; close) group_close ;; catalog) group_catalog ;;
  all) group_tap; group_seq; group_conc; group_trial; group_evid; group_close; group_catalog ;;
esac
echo "# harness-tests[$group]: $npass ok, $nfail falhas"
[ "$nfail" -eq 0 ]
