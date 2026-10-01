# NauticFlow — Produto atual

## Problema

Operadores de escunas, lanchas, catamarãs e táxis marítimos administram reservas, saídas, passageiros e manifestos em planilhas, cadernos e conversas dispersas.

## Solução

Centralizar a operação do operador náutico em um sistema multiempresa com controle de vagas no banco, agenda, histórico de clientes, manifestos/vouchers e financeiro.

## Escopo funcional atual

- Dashboard com indicadores operacionais.
- Cadastro de embarcações e capacidades oficial/comercial.
- Catálogo de passeios.
- Agenda e saídas.
- Reservas, passageiros e manifestos/vouchers.
- Clientes e parceiros.
- Equipe e permissões.
- Financeiro e planos.
- Painel de super administrador.
- API pública para ToursFlow.
- Cobrança e renovação via Asaas.

## Regras de produto importantes

- Empresas não podem enxergar ou alterar dados de outras empresas.
- Reserva simultânea precisa respeitar a capacidade no banco.
- A capacidade comercial pode ser menor que a capacidade oficial para descontar tripulação e margem de segurança.
- Saídas novas respeitam o horário definido no banco e não podem ser criadas no passado.
- Assinatura vencida restringe criação de novos registros, mas não apaga nem bloqueia automaticamente toda consulta/edição existente.
- O modo Sandbox do Asaas deve permanecer explícito até a decisão de vender de verdade.

## Fora do escopo ou não confirmado

- Emissão automática de nota fiscal: o módulo atual é controle manual.
- Chat online permanente: foi removido.
- Logo customizada por empresa: adiada.
- Checkout e pagamentos reais em produção: confirmar sempre o ambiente atual antes de afirmar que estão ativos.
- Qualquer funcionalidade não confirmada no código, migrations e infraestrutura.

## Critérios de qualidade

- RLS e validações de servidor preservam isolamento entre empresas.
- Migrations são aplicadas e verificadas no ambiente correto.
- `tsc`, lint e build passam antes de considerar código pronto.
- Funcionalidade visual passa por preview antes de produção.
- Mudanças de segurança recebem revisão manual além dos testes automáticos.
- Contratos consumidos pelo ToursFlow são atualizados junto com o código e verificados com chamadas reais quando possível.
