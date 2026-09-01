# ADR 0006 — Comissão global do marketplace (10% inicial)

- Status: aceita
- Data: 2026-08-31
- Contexto: decisão de produto, depois do saque Pix (`docs/adr/0005-...md`)

## Decisão

**Comissão global inicial do marketplace ToursFlow = 10% (1000 basis
points).** Vale só para NOVAS confirmações de pagamento a partir do
momento em que a configuração entrar em vigor de verdade -- vendas já
confirmadas mantêm o percentual congelado no momento da venda, uma
mudança futura nunca recalcula retroativamente. Migration `0057` (não
aplicada).

## Basis points, nunca float

`marketplace_fee_config.fee_basis_points` já existia (migration `0053`) --
1000 = 10%, inteiro, mesmo motivo de `amount_cents` ser inteiro (evita
todo problema clássico de ponto flutuante em dinheiro).
`calculateMarketplaceAmounts()` (`src/lib/marketplace-ledger.ts`) já
implementava o cálculo determinístico -- **não mudou nesta fase**, só
ganhou testes explícitos contra o valor real (10%) em vez de só valores
sintéticos de teste.

## Uma única fonte de verdade -- nunca hardcode espalhado

`10%`/`1000`/`0.10` não aparecem em nenhum outro lugar do código além da
LINHA de configuração em `marketplace_fee_config` (inserida separadamente,
ver seção "Seed" abaixo) e dos comentários que a documentam. Todo cálculo
passa por `get_current_marketplace_fee_config()` (SQL) ou recebe o valor
já resolvido como parâmetro de `calculateMarketplaceAmounts()`/
`calculate_marketplace_refund_amounts()` -- nenhum dos dois tem um
percentual embutido.

## Arredondamento -- determinístico, documentado, testado

`platformFeeCents = floor(totalCents * feeBasisPoints / 10000)`;
`operatorAmountCents = totalCents - platformFeeCents` (sempre o RESTO,
nunca calculado independentemente) -- garante `fee + operator = gross`
por construção, nunca por checagem depois. A taxa é sempre arredondada
pra BAIXO -- o operador nunca recebe menos do que "o valor exato menos a
taxa arredondada certinho pra cima" resultaria; o resíduo de
arredondamento (no máximo 1 centavo) sempre favorece o operador, nunca a
plataforma. Testado explicitamente: R$ 10,01 a 10% -> taxa R$ 1,00 (não
R$ 1,01); R$ 0,01 (valor mínimo) a 10% -> taxa R$ 0,00, operador fica com
o centavo inteiro -- **nenhum centavo desaparece em nenhum cenário**
(invariante `fee + operator = gross` testada contra vários valores,
incluindo os quebrados).

## Snapshot -- `fee_basis_points_snapshot`, novo, junto do resto

`gross_amount_cents`/`platform_fee_cents`/`operator_amount_cents`/
`service_at_snapshot`/`cancellation_policy_snapshot` já eram congelados
(`0053`/`0055`) -- faltava o PERCENTUAL exato usado, guardado só
implicitamente (`fee_cents`/`gross_cents`, impreciso por causa do floor).
`payments.fee_basis_points_snapshot` (novo) fecha isso -- protegido pelo
MESMO trigger de imutabilidade (`check_payments_financial_snapshot_
immutable`, estendido nesta migration) e pelo MESMO `CHECK` de "conjunto
completo ou nada" (`payments_amounts_balance_check`, estendido). Uma vez
confirmado, nada muda -- nem por bug futuro em outra RPC.

## Mudança futura -- nunca retroativa (testado)

Cenário do pedido, testado explicitamente: Venda A confirmada com a
config em 10% -- snapshot grava `1000`. Depois, a config global muda pra
12%. Replay da confirmação de A continua devolvendo o snapshot ORIGINAL
(10%, nunca recalculado). Venda B, confirmada DEPOIS da mudança, usa 12%
-- corretamente diferente de A. Isso já era garantido pela arquitetura de
`record_marketplace_payment_confirmed` (só grava na primeira confirmação,
replay de um payment já `paid` sempre devolve o snapshot existente) -- não
foi uma mudança de comportamento, só confirmado com teste real.

## Ledger -- nunca `operator_blocked = gross`

Reconfirmado (não alterado): `record_marketplace_payment_confirmed` grava
DOIS lançamentos -- `operator_blocked` no bucket `blocked` com o valor
JÁ LÍQUIDO (`operator_amount_cents`), e `platform_fee` no bucket
`platform_revenue` com a comissão. Testado com o valor real: gross =
R$ 1.000,00, fee = 10% -> `platform_revenue` recebe R$ 100,00,
`operator_blocked` recebe R$ 900,00 -- nunca os R$ 1.000,00 inteiros.

## Refund usa o snapshot da venda, nunca a config atual

`calculate_marketplace_refund_amounts` (`0055`) já derivava
`platformFeeCents = paidAmountCents - operatorAmountCents`, ambos vindos
do `payments` da venda (snapshot congelado) -- **nunca** reconsulta
`get_current_marketplace_fee_config()`. Testado explicitamente: venda
confirmada a 10%, config global muda pra 20% depois, cálculo de refund
daquela venda continua usando a comissão original (10%) -- nenhuma
mudança de comportamento necessária, só confirmado. Nenhuma política nova
de refund foi inventada.

## Saque -- isolamento de bucket reconfirmado

`get_marketplace_operator_balances`/`request_marketplace_withdrawal`
(`0053`/`0056`) somam só `blocked`/`available`/`withdrawal_pending`/
`transferred` -- `platform_revenue` nunca entra nessa soma, em nenhum
caminho de código. Testado explicitamente com o valor real (10% de
R$ 1.000,00): o saldo "sacável" do operador é exatamente os R$ 900,00
líquidos, os R$ 100,00 de comissão continuam num bucket estruturalmente
inacessível ao saque.

## Arquitetura preparada pra override por empresa -- NÃO implementado

`marketplace_fee_config` ganhou `company_id` (nullable -- `NULL` =
configuração GLOBAL, o único tipo de linha que de fato existe hoje).
`get_current_marketplace_fee_config(p_company_id)` -- **novo overload**
de 1 parâmetro (a versão de 0 parâmetros, `0053`, continua existindo,
intocada, sem uso por código novo -- Postgres trata isso como duas
funções distintas por assinatura, não uma substituição) -- prioriza um
override específico da empresa se existir, com fallback pro global.
`record_marketplace_payment_confirmed` foi atualizada pra chamar o novo
overload passando `company_id` da reserva. **Hoje, 100% das confirmações
usam a config global** -- nenhuma linha com `company_id` preenchido é
criada por esta fase, nenhum mecanismo de "decidir quando um override se
aplica" existe. Isso é só a plumbing pronta pra um dia existir, não uma
funcionalidade ativa.

## Admin -- sem UI nova, guard reforçado

Nenhuma UI de configuração foi criada (fora de escopo, "não precisa criar
UI complexa"). O mecanismo de controle é o mesmo guard já existente
desde `0053` (`check_marketplace_fee_config_guard`, trigger `BEFORE
INSERT` em `marketplace_fee_config`, exige `auth.role() = 'service_role'`
OU `is_super_admin()`) -- reconfirmado, não alterado por esta fase.
`get_current_marketplace_fee_config` (os dois overloads) nunca é
concedido a `authenticated` -- o operador não consegue nem LER a
configuração diretamente, só enxerga o resultado já aplicado através dos
snapshots congelados em `payments`/da UI de detalhamento (seção abaixo).

## Seed -- por que NÃO está dentro da migration

**Achado real desta revisão**: `marketplace_fee_config` é protegida por um
guard que depende de `auth.role()`/`auth.uid()` -- funções que só
resolvem um valor de verdade dentro de uma requisição autenticada via
PostgREST/Supabase Auth (JWT presente). Uma migration rodando via
`supabase db push` conecta como o dono/superusuário do banco, SEM
contexto de JWT -- `auth.role()` resolveria `NULL`, não `'service_role'`,
e o `INSERT` do valor de 10% dentro do arquivo de migration provavelmente
seria barrado pelo próprio guard que este projeto construiu de propósito.
**Mesmo motivo, mesmo padrão já usado pro pepper de trial** (migrations
`0045`/`0046`).

## Operação administrativa oficial -- `set_marketplace_global_fee_config` (`0058`)

Fechamento desta pendência: em vez de depender de um `INSERT` solto
executado à mão (`supabase db query --file`, sem forma nem validação
própria), a migration `0058` cria `set_marketplace_global_fee_config
(p_fee_basis_points, p_note)` -- o único caminho oficial pra configurar a
comissão global.

**Por que uma RPC em tempo de execução resolve o que o `INSERT` na
migration não resolvia**: o problema do seed dentro do arquivo de
migration é específico da CONEXÃO DE `db push` (sem JWT). Uma chamada à
RPC em tempo de execução -- via `service_role` (script/backend) ou via uma
sessão `authenticated` real de um `super_admin` -- **tem** contexto de JWT
de verdade, então `auth.role()`/`is_super_admin()` resolvem os valores
reais da chamada, e o guard (tanto o trigger de `0053` quanto a checagem
redundante dentro da própria RPC) funciona exatamente como desenhado.

**Autorização**: `auth.role() = 'service_role'` OU `is_super_admin()` --
mesma regra exata do guard trigger já existente, verificada de novo
DENTRO da função (defesa em profundidade, não depende só do trigger
disparar). `company_admin`, `staff`, `authenticated` comum e `anon` são
todos rejeitados (`FORBIDDEN`) -- testado explicitamente para os 6 papéis
(`service_role`✓, `super_admin`✓, `company_admin`✗, `staff`✗,
`authenticated` comum✗, `anon`✗).

**ACL revisada de propósito, sem repetir o incidente `0044`/`0048`**:
`EXECUTE` é concedido a `authenticated` (necessário -- não existe um
papel Postgres/PostgREST separado pra `super_admin` neste projeto; uma
sessão de `super_admin` autentica como `authenticated` normal, então essa
é a única forma de a API alcançar a função) **e** a `service_role`. Isso
não é uma contradição com "authenticated comum nunca pode configurar" --
a restrição real é a checagem de role DENTRO da função, não a ACL do
Postgres em si (que só decide quem pode TENTAR chamar, não quem
consegue). Revisado explicitamente antes de definir os `GRANT`s: a
função não chama nenhuma outra função com ACL própria por dentro (só
`is_super_admin()`, que é `SECURITY DEFINER` e sempre acessível ao dono)
-- não há o padrão de chamada transitiva com GRANT incompatível que
gerou o incidente das migrations `0044`/`0048`.

**`SECURITY DEFINER` necessário**: a tabela não concede `INSERT` a
ninguém além do dono (`0053`) -- sem `SECURITY DEFINER`, nem um
`super_admin` autenticado normal teria privilégio de escrita, independente
de qualquer checagem de role dentro da função.

**Versionamento reconfirmado**: cada chamada insere uma linha NOVA, nunca
sobrescreve (mesmo modelo já vigente em `marketplace_fee_config` desde
`0053` -- nunca `UPDATE`, a vigente é sempre a mais recente por
`created_at`). Testado: duas chamadas (1000 depois 1200) resultam em duas
linhas, a config vigente muda pra 1200, mas um snapshot já capturado por
uma venda anterior à mudança permanece 1000 -- intocado (protegido pelo
trigger de imutabilidade de `payments`, não por esta função).

## Ativação real dos 10% -- procedimento futuro exato

Quando a migration `0057` (schema/snapshot) e `0058` (esta operação)
estiverem aplicadas de verdade, com autorização própria e SEPARADA desta
sessão:

```
supabase.rpc('set_marketplace_global_fee_config', {
  p_fee_basis_points: 1000,
  p_note: 'Comissão global inicial do marketplace ToursFlow -- decisão de produto, sessão de 2026-08-31.'
})
```

chamado com a `service_role` key (script/backend) OU por uma sessão
autenticada de `super_admin` através de uma futura ação administrativa.
Enquanto essa chamada não acontecer de verdade,
`MARKETPLACE_FEE_NOT_CONFIGURED` continua bloqueando toda confirmação de
pagamento, mesmo com as duas migrations já aplicadas -- schema pronto
nunca é a mesma coisa que configuração ativa.

## UI -- detalhamento da venda, sem expor basis points

`/reservas/[id]`: quando existe um pagamento confirmado pra aquela
reserva, mostra "Venda / Taxa marketplace / Você recebe" -- os três
valores em reais, direto dos snapshots já congelados (`get_marketplace_
payment_breakdown`, nova RPC `authenticated`-scoped, nunca recalcula).
Nenhum basis point exposto na UI -- só os valores finais em R$, que é o
que o operador realmente precisa ver.

## Fail closed -- reconfirmado, não alterado

Sem NENHUMA linha em `marketplace_fee_config` (nem global, nem por
empresa) -- `get_current_marketplace_fee_config` devolve `NULL`,
`record_marketplace_payment_confirmed` recusa com
`MARKETPLACE_FEE_NOT_CONFIGURED`. **Nunca assume 0%** -- 0% só é o
comportamento real quando existe uma linha EXPLÍCITA com
`fee_basis_points = 0` (uma decisão administrativa deliberada, ex:
período promocional), nunca um default implícito por ausência de
configuração. Os dois casos são estruturalmente distintos e testados
separadamente.

## Pendências explícitas desta fase

- Seed real do valor de 10% -- operação administrativa oficial pronta (`set_marketplace_global_fee_config`, `0058`), não executada (precisa de autorização própria e das migrations `0057`/`0058` já aplicadas).
- Override por empresa -- arquitetura pronta, nenhuma linha com `company_id` preenchido existe, nenhum critério de "quando aplicar" foi decidido.
- UI de administração da comissão -- não criada, fora de escopo desta fase.
- Taxas do provider Asaas sobre a comissão em si -- não modeladas (pendência já registrada no ADR `0002`, sem relação direta com esta fase).
- Ativação real de qualquer pagamento continua dependendo da Fase de integração real com o Asaas -- esta fase só prepara a comissão, não ativa cobrança real nenhuma.
