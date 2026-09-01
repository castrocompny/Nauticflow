# ADR 0003 — Destino de saque (chave Pix) e política de liberação do saldo

- Status: aceita
- Data: 2026-08-31
- Contexto: próxima etapa financeira do marketplace ToursFlow, depois da Fase 4B (ledger, D+1, saque/reembolso -- `docs/adr/0002-marketplace-ledger-payout-refund.md`)

## Objetivo desta etapa

Fechar dois pontos que a Fase 4B deixou abertos: (1) para ONDE um saque real
transferiria o saldo `available` do operador, e (2) reconfirmar/reforçar a
regra de liberação (`blocked` → `available`) contra os cenários levantados
nesta revisão (check-in, cancelamento, no-show). **Nenhuma transferência
real, nenhum saque real, nenhuma validação de titularidade no provider
acontece aqui** -- só cadastro seguro do destino + leitura do próprio saldo,
migration `0054` (não aplicada).

## Chave Pix -- nunca credencial bancária

`marketplace_payout_accounts` guarda só `pix_key_type` + `pix_key_normalized`
-- nunca senha, nunca dado de acesso ao banco do operador. Os 5 tipos
suportados (`cpf`, `cnpj`, `email`, `telefone`, `evp`) são os mesmos tipos de
chave Pix reais do Banco Central -- não um subconjunto arbitrário.

**Validar formato NÃO é validar titularidade.** CPF/CNPJ passam por checksum
real (dois dígitos verificadores, reaproveitando `trial_validate_cpf`/
`trial_validate_cnpj` da migration `0045` -- nunca duplicado em SQL, só
espelhado em TypeScript por não termos acesso a uma chamada de rede ao banco
no formulário). E-mail/telefone/EVP passam por validação estrutural. Nenhuma
dessas checagens confirma que a chave existe de verdade ou pertence a quem
está cadastrando -- isso só um provider real (Asaas) pode confirmar, numa
chamada que não existe ainda. Por isso toda conta nasce com
`status = 'unverified'` e **nenhum outro status de "verificado" existe nesta
fase** -- inventar um "verified" sem checagem real seria mentir sobre uma
garantia que não existe.

**Fail closed para transferência real**: quando a integração real com o
provider existir, nenhuma transferência deve ocorrer para uma chave
`unverified` sem essa confirmação acontecer primeiro -- isso é uma decisão
de arquitetura desta fase, a ser respeitada por quem implementar o saque de
verdade (Fase futura), não uma sugestão.

## Uma conta corrente por empresa, histórico preservado

`unique index ... where status <> 'superseded'` garante no máximo uma linha
"corrente" (não substituída) por `company_id`. Trocar a chave nunca faz
`UPDATE` na linha existente nem `DELETE` -- marca a antiga como `superseded`
(`superseded_at = now()`) e insere uma linha nova `unverified`. Histórico
completo de trocas fica sempre auditável, decisão explícita pedida nesta
revisão.

Duas trocas concorrentes da mesma empresa (dois separadores clicando salvar
ao mesmo tempo, por exemplo) serializam naturalmente pelo lock de linha do
`UPDATE ... WHERE company_id = X AND status <> 'superseded'` -- a segunda
espera a primeira committar, então vê a linha da primeira já corrente e a
substitui por cima. Último a committar vence (mesma semântica de "última
alteração salva" de qualquer formulário de configuração comum). Nenhum
advisory lock foi adicionado aqui -- ao contrário do saque/reembolso
(`docs/adr/0002-...md`), não existe uma checagem de "saldo suficiente" sendo
lida-e-decidida nesta operação, então o lock de linha padrão do Postgres já
é suficiente; adicionar um advisory lock seria proteção redundante para um
risco que não existe aqui.

## Mascaramento -- nunca a chave completa fora do necessário

`mask_pix_key()` (SQL) e `maskPixKey()` (TypeScript,
`src/lib/payout-accounts.ts`) são espelhados byte a byte -- mesmo contrato de
manutenção já usado para CPF/CNPJ (`0045`) e comissão/reembolso (`0053`).
Nenhuma RPC desta migration devolve a coluna crua `pix_key_normalized` --
`set_marketplace_payout_account`, `get_marketplace_payout_account` e
`get_marketplace_financial_summary` sempre devolvem só a versão mascarada.

**A tabela é mais restrita que qualquer outra deste projeto**: `REVOKE ALL`
inclui até `service_role` -- nenhuma leitura crua existe hoje, nem pelo
backend, porque não existe hoje nenhuma necessidade legítima de ler a chave
sem máscara (nenhum payout real ainda). Quando a integração real existir,
uma migration nova e explícita precisará criar uma RPC dedicada
`service_role`-only pra isso -- decisão que não deve ser tomada
silenciosamente dentro de outra funcionalidade.

## Modelo de confiança invertido em relação à Fase 4A/4B

As RPCs de `0052`/`0053` são server-to-server: o ToursFlow chama via
`service_role`, nunca existe uma sessão de usuário do NauticFlow envolvida.
As RPCs desta migration são o oposto -- **self-service do próprio operador**,
chamadas pela sessão autenticada normal dele (`authenticated`). Por isso:

- ACL invertida: `revoke` de `public`/`anon`/`service_role`, `grant` só pra
  `authenticated` (nenhuma delas é chamável por `service_role` hoje).
- `company_id` e `role` são **sempre** derivados de `auth.uid()` dentro da
  própria RPC (`select company_id, role from profiles where id = auth.uid()`)
  -- nenhuma delas aceita um parâmetro de `company_id`/id de destino. Isso
  fecha IDOR **por construção**: não existe um valor que um chamador possa
  passar pra tentar ler/alterar a conta de outra empresa, porque não existe
  parâmetro nenhum pra isso.
- Restrito a `role in ('company_admin', 'super_admin')` -- mesmo corte já
  usado na página Financeiro (`staff` é redirecionado de lá,
  `src/app/(app)/financeiro/page.tsx`), reforçado aqui no banco também, não
  só na UI/Server Action.

## Alteração de chave -- proteção mínima desta fase

Autenticação de sessão (Supabase Auth) + checagem de role (`company_admin`/
`super_admin`) + validação server-side (nunca confia só na UI) + log de
segurança (`logSecurityEvent("marketplace_payout_account_changed", {
companyId, pixKeyType })` -- nunca a chave em si) + `created_at` de cada
linha (histórico). **2FA não foi implementado** -- não existe infraestrutura
de 2FA neste projeto hoje; registrado aqui como hardening futuro explícito,
não esquecido silenciosamente.

## Regra de liberação do saldo -- reconfirmada, não alterada

A Fase 4B (revisão final, `docs/adr/0002-...md`) já implementou e testou:
pagamento pago + reserva correta + `service_at_snapshot` presente e imutável
+ `service_at_snapshot + 24h <= now()` + saldo bloqueado remanescente > 0 +
liberação ainda não executada. Esta revisão **não mudou nenhuma dessas
condições** -- só reconfirmou (com teste explícito) duas que já estavam
implicitamente protegidas:

- **Reserva cancelada nunca libera saldo**: `release_marketplace_reservation_
  balance` exige `reservations.status = 'confirmada'`, senão
  `BOOKING_NOT_CONFIRMED`. Uma reserva `cancelada` nunca passa dessa
  checagem. Já era verdade antes desta revisão -- confirmado, não
  corrigido.
- **Saída cancelada nunca libera saldo**: a mesma função exige
  `departures.status = 'encerrada'`, senão `DEPARTURE_NOT_CONCLUDED`. Uma
  saída `cancelada` nunca é `'encerrada'` (são valores distintos do mesmo
  `check`, migration `0000`) -- nunca passa dessa checagem. Também já era
  verdade antes desta revisão.

## Check-in de passageiro -- existe, mas não é sinal financeiro

**Auditoria do que já existe** (pedida explicitamente nesta revisão, antes
de inventar qualquer modelo novo): existe, sim -- `passengers.status`
(migration `0000`) aceita `'confirmado' | 'embarcado' | 'ausente'`.
`'embarcado'` é o equivalente funcional de um check-in (marcar presença no
embarque). Qualquer membro autenticado da empresa (`company_admin` ou
`staff`) pode alternar isso pelo botão em `/reservas/[id]`
(`setPassengerStatus`, `src/app/(app)/reservas/[id]/passenger-actions.ts`) --
sem role mínima, sem 2FA, sem confirmação extra (ação operacional de baixo
risco, correta pra esse contexto). **Não existe coluna de timestamp
dedicada** (`checked_in_at`/similar) -- só o `created_at` do passageiro em
si, que é de quando ele foi CADASTRADO na reserva, não de quando foi
marcado como embarcado.

**Decisão desta revisão: check-in NÃO libera saldo.** É prova de presença
de UM passageiro, não prova de que o PASSEIO inteiro foi concluído (uma
reserva pode ter vários passageiros, cada um com seu próprio status). O
critério financeiro continua sendo o par `departures.status = 'encerrada'`
+ `service_at_snapshot + 24h`, no nível da SAÍDA -- não do passageiro
individual. Check-in poderá, no futuro, compor evidência ADICIONAL (por
exemplo, num desenho futuro de detecção de risco/fraude), mas não é, e não
deve virar sozinho, uma condição de liberação.

**Saída encerrada sem nenhum check-in registrado**: cenário possível (o
operador esqueceu de marcar embarque, ou o passeio não usa esse fluxo).
Esta revisão **não muda a regra automaticamente** por causa disso -- a
liberação continua acontecendo pelo critério já existente (status +
relógio). Registrado como possível sinal de auditoria/risco pra uma rodada
futura (ex: um relatório interno de "saídas encerradas sem nenhum
check-in", não uma trava automática) -- não implementado aqui, pra não
inventar uma heurística de fraude sem dados reais pra calibrá-la.

## No-show -- não é `completed`

`calculateRefund()` (`0053`) já trata `no_show` como um `ReservationOutcome`
distinto de `completed`, mas ainda não tem NENHUMA persistência real (não
existe fonte de dado que diga "esta reserva foi no-show" hoje -- só
`passengers.status = 'ausente'`, que é por passageiro, não por reserva).
Esta revisão não resolve isso -- só reafirma explicitamente: **no-show
nunca deve ser tratado como equivalente a `completed`** em nenhum código
futuro. Fica registrado como pendência para a próxima etapa de política de
cancelamento/reembolso, junto com a fonte real de outcome por reserva (já
listada como pendência no ADR `0002`).

## `available_at` -- decisão de não persistir

Avaliado se valeria a pena persistir um `available_at` (snapshot derivado de
`service_at_snapshot + 24h`) em vez de comparar dinamicamente a cada
chamada. **Decisão: manter o cálculo dinâmico, não duplicar estado.** A
comparação (`service_at_snapshot + interval '24 hours' <= now()`) é barata,
determinística a partir de uma coluna já imutável, e reavaliada só quando
`release_marketplace_reservation_balance` roda (não é uma query de alto
volume/frequência que justificaria pré-computar). Persistir um valor
derivado só criaria uma segunda fonte de verdade pra manter sincronizada
sem necessidade real. Se o volume um dia exigir (mesma ressalva já feita
para saldos derivados no ADR `0002`), fica para uma migration futura
dedicada.

## Painel financeiro -- API mínima, sem expor o ledger bruto

`get_marketplace_financial_summary()` combina `get_marketplace_operator_
balances()` (`0053`, chamada internamente -- function SECURITY DEFINER
chamando outra do mesmo dono, mesmo padrão já usado no projeto todo) com a
conta de recebimento mascarada, numa única RPC `authenticated`-scoped. **Não
expõe `marketplace_ledger_entries` linha a linha** -- só os 4 saldos
agregados, que é tudo que o operador precisa ver nesta fase. Sem botão de
saque funcional na UI (nem desabilitado) -- decisão de simplicidade, não
simular uma ação que não existe.

## Pendências explícitas desta etapa

- Validação de titularidade da chave Pix no provider -- não implementada, `unverified` é o único status possível.
- Transferência/saque real -- não implementado (Fase futura).
- 2FA na troca de chave -- não implementado, hardening futuro registrado.
- Outcome real por reserva (completed/no_show/cancelled) -- ainda não existe, já registrado no ADR `0002`.
- Política de cancelamento/reembolso real -- ainda não existe, já registrada no ADR `0002`.
- Relatório de "saídas encerradas sem check-in" como sinal de risco -- não implementado, só registrado como possibilidade futura.
- RPC de leitura crua da chave Pix para uso do backend em uma integração real futura -- não existe hoje, deliberadamente.
