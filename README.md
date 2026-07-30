# NauticFlow

Base do MVP de gestão para turismo náutico. Next.js (App Router) + Supabase + Tailwind, no visual do dashboard da marca, sobre o schema v2 com o modelo de `departures`.

## O que já está pronto

- Autenticação (login, cadastro com `bootstrap_company`, sair) ligada ao Supabase Auth
- Shell completo (menu lateral no estilo da marca + barra superior), com itens do MVP ativos e os demais como "em breve"
- Dashboard com indicadores do dia e saídas de hoje com ocupação
- Embarcações (lista + cadastro, capacidade comercial calculada)
- Clientes (lista + cadastro)
- Saídas (lista com ocupação em tempo real + criação)
- Reservas (lista + criação com bloqueio de vagas vindo do banco)

## Próxima iteração (ainda não incluída)

- Tela de Passageiros (lista de embarque por reserva, respeitando o `people_count`)
- Tela de Manifesto com exportação em PDF e impressão
- Check-in e mudança de status da saída

## Pré-requisitos

1. Um projeto no Supabase com o schema `nauticflow_schema_v2.sql` já aplicado (rode o SQL no editor do Supabase).
2. Node 18+.

## Configuração

```bash
cp .env.example .env.local
# preencha com a URL e a anon key do seu projeto Supabase
npm install
npm run dev
```

Abra http://localhost:3000. Crie a conta pela tela de login (isso chama `bootstrap_company` e monta empresa, perfil e assinatura). Depois cadastre uma embarcação, um cliente, uma saída e a primeira reserva.

## Mapa do projeto

```
src/
  middleware.ts                 protege rotas e renova a sessao
  lib/
    supabase/{client,server,middleware}.ts
    types.ts                    tipos alinhados ao schema v2
    format.ts                   brl, datas, getProfile (company_id dos inserts)
  components/                   logo, sidebar, topbar, ui (card, badge, stat...)
  app/
    login/                      tela e actions de auth
    (app)/                      area autenticada (layout com shell)
      dashboard/  embarcacoes/  clientes/  saidas/  reservas/
```

## Notas de segurança

- Nenhum insert recebe `company_id` do cliente. Ele vem sempre do `profile` no servidor, e a RLS confere.
- O controle de vagas e o limite de passageiros são validados no banco (gatilhos), não só na interface. A UI apenas exibe o erro retornado.

## Troubleshooting

- Se algum embed do Supabase reclamar de relacionamento ambíguo, use o hint do PostgREST, por exemplo `vessels!fk_departures_vessel(name)`.
- O logo atual é um SVG aproximado para o fundo escuro. Substitua pelo seu logo vetorizado quando tiver o arquivo SVG.
