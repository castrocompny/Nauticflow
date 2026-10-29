# Verificador TAP estrito para a saída `psql -X -q -At` de um arquivo pgTAP.
# Uso: awk -v rc=<exit do cliente> -f tapcheck.awk <stdout> <stderr>
#
# PASS somente se TODAS valerem:
#   - rc informado e igual a 0;
#   - stderr vazio (qualquer linha, inclusive NOTICE, reprova);
#   - exatamente um plano `1..N` (N >= 1), antes de qualquer teste;
#   - N linhas `ok K`, K = 1..N em ordem, sem zero à esquerda nem sufixo;
#   - nenhum `not ok`, `Bail out!` ou `# Looks like`;
#   - nenhum TODO/SKIP (contados à parte; nesta suíte toda cobertura é obrigatória);
#   - nenhuma linha fora de: plano, teste, diagnóstico `#...`.
# `\#` escapado numa descrição (como o pgTAP emite) não é diretiva.
FILENAME == ARGV[2] { errl++; print "STDERR: " $0; next }
/^1\.\.[0-9]+$/ {
  plans++
  if (n > 0) { order++; print "PLAN_AFTER_TESTS: " $0 }
  plan = substr($0, 4)
  if (plan !~ /^[1-9][0-9]*$/) { badplan++; print "BAD_PLAN: " $0 }
  next
}
/^(not )?ok [1-9][0-9]*($| )/ {
  isnot = ($1 == "not")
  num = isnot ? $3 : $2
  n++
  if (num != n "") { seqerr++; print "SEQ: esperado " n ": " $0 }
  rest = $0; sub(/^(not )?ok [0-9]+/, "", rest); gsub(/\\#/, "", rest)
  d = tolower(rest)
  dir = 0  # TODO/SKIP nunca contam como aprovados
  if (d ~ /#[ \t]*todo/) { todo++; dir = 1; print "TODO: " $0 }
  else if (d ~ /#[ \t]*skip/) { skip++; dir = 1; print "SKIP: " $0 }
  if (isnot) { nok++; print "NOT_OK: " $0 } else if (!dir) ok++
  next
}
/^Bail out!/      { bail++; print "BAIL: " $0; next }
/^# Looks like/   { looks++; print "DIAG: " $0; next }
/^#/              { next }
{ unknown++; print "UNKNOWN: [" $0 "]" }
END {
  rcok = (rc "" == "0")
  pass = rcok && errl == 0 && plans == 1 && badplan == 0 && order == 0 && n == plan + 0 && \
         nok == 0 && bail == 0 && looks == 0 && unknown == 0 && seqerr == 0 && todo == 0 && skip == 0
  printf "rc=%s plans=%d plan=%s run=%d ok=%d not_ok=%d todo=%d skip=%d bail=%d looks_like=%d unknown=%d seq_errors=%d stderr_lines=%d => %s\n", \
    (rc == "" ? "missing" : rc), plans, (plan == "" ? "-" : plan), n, ok, nok, todo, skip, bail, looks, unknown, seqerr, errl, (pass ? "PASS" : "FAIL")
  exit(pass ? 0 : 1)
}
