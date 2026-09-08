<div align="center">

# NauticFlow

**Sistema de gestão para operadores de turismo náutico**

Do cadastro da embarcação ao manifesto de embarque, em um só lugar.

[![Site](https://img.shields.io/badge/nauticflow.com.br-0B5FFF?style=flat&logo=vercel&logoColor=white)](https://nauticflow.com.br)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=black)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)

</div>

---

## O problema

Operadores de escunas, lanchas, catamarãs e táxis marítimos administram suas reservas em cadernos, planilhas e conversas de WhatsApp. As consequências aparecem todo dia:

- Overbooking, porque não existe controle único de vagas por saída
- Manifesto de embarque montado à mão, minutos antes da partida
- Nenhuma visibilidade de ocupação para decidir se vale abrir uma nova saída
- Comissão de parceiros calculada de memória, sem rastreio
- Histórico de clientes disperso entre atendentes

## A solução

O NauticFlow centraliza a operação em um fluxo único:

```
Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto
```

Cada empresa opera dentro do seu próprio espaço isolado, com controle de vagas validado no banco de dados e manifesto gerado a partir das reservas confirmadas.

---

## Módulos

| Módulo | O que faz |
|---|---|
| **Dashboard** | Indicadores do dia, receita, ocupação, ticket médio e taxa de cancelamento por período |
| **Reservas** | Criação com bloqueio de vagas garantido pelo banco |
| **Agenda** | Visão de calendário das saídas programadas |
| **Saídas** | Embarcação em data e hora, com ocupação em tempo real e manifesto |
| **Clientes** | Cadastro e histórico, com identificação de clientes recorrentes |
| **Embarcações** | Cadastro por tipo, com capacidade oficial e comercial |
| **Parceiros** | Canais de venda e rastreio da origem das reservas |
| **Passeios** | Catálogo comercial com fluxo de rascunho e publicação |
| **Financeiro** | Receita por período e recebimento Pix das vendas do marketplace |
| **Relatórios** | Indicadores consolidados e ranking de uso das embarcações |
| **Equipe** | Convite de colaboradores com papéis e controle de acesso |

---

## Decisões de arquitetura

### Isolamento entre empresas no banco, não na aplicação

Cada tabela carrega `company_id` e é protegida por **Row Level Security** no PostgreSQL. Nenhum `insert` recebe `company_id` vindo do cliente: o valor é lido do perfil do usuário no servidor e a política do banco confere.

O motivo é simples. Se o isolamento vivesse apenas no código da aplicação, uma única consulta mal escrita vazaria dados de um operador para outro. Com RLS, o banco recusa a operação mesmo que a aplicação erre.

### Regras críticas de negócio em gatilhos do PostgreSQL

Controle de vagas e limite de passageiros são validados por **triggers** no banco. A interface apenas exibe o erro retornado.

Validação só no front-end quebra sob duas reservas simultâneas para a última vaga. No banco, a transação resolve o conflito e uma das duas falha de forma previsível.

### Capacidade comercial separada da capacidade oficial

Uma escuna com capacidade oficial de 95 lugares opera comercialmente com 90. A diferença cobre tripulação e margem de segurança. Modelar os dois valores separadamente evita que o operador precise "descontar de cabeça" a cada saída.

### Bootstrap de empresa via gatilho de autenticação

A criação de empresa, perfil e assinatura acontece no gatilho `handle_new_user()`, disparado quando o usuário entra em `auth.users`.

Essa decisão veio de um problema real: nas primeiras contas de teste, o cadastro criava o usuário mas falhava ao montar a empresa, porque a sessão ainda não existia no momento da chamada. Movendo a lógica para o banco, o processo passou a ser atômico.

### Anti-abuso do trial calculado no banco

O endpoint de cadastro do Supabase é público e pode ser chamado diretamente. Por isso o fingerprint que decide a concessão do trial é recalculado dentro do gatilho, a partir do dado bruto, com um segredo guardado em tabela travada. A aplicação nunca envia um valor pronto.

### Saldo do marketplace com bloqueio antes do saque

Vendas feitas pelo marketplace entram como saldo bloqueado e só migram para disponível após o período de segurança. O saque exige chave Pix verificada. Nenhuma transferência acontece antes dessas duas condições.

### Rate limiting em camadas

A API pública e a rota de reservas do marketplace têm limites separados: um limite global por consumidor e outro por visitante. Evita que um único cliente derrube o serviço para os demais.

---

## Stack

**Front-end**
Next.js 14 (App Router, Server Components, Server Actions) · React 18 · TypeScript · Tailwind CSS · lucide-react

**Back-end e dados**
Supabase (PostgreSQL, Auth, PostgREST) · Row Level Security · Triggers e funções PL/pgSQL

**Infraestrutura**
Vercel · Resend (e-mail transacional) · Sentry (monitoramento) · Asaas (cobrança recorrente e Pix)

---

## Integração com o ToursFlow

O NauticFlow expõe uma API para o **ToursFlow**, marketplace público onde o turista encontra e reserva passeios. O operador publica o passeio no NauticFlow e ele passa a ser vendido no marketplace, com a reserva caindo direto na agenda e o valor no saldo do financeiro.

A rota de reservas do marketplace é autenticada por segredo compartilhado, nunca exposto ao navegador do turista, e protegida por duas camadas de rate limit.

---

## Como rodar

**Pré-requisitos:** Node 18+ e um projeto Supabase com as migrations aplicadas.

```bash
git clone https://github.com/castrocompny/Nauticflow.git
cd Nauticflow

cp .env.example .env.local
# preencha a URL e as chaves do Supabase

npm install
npm run dev
```

Abra `http://localhost:3000` e crie a conta pela tela de login. O gatilho `handle_new_user()` monta empresa, perfil e assinatura automaticamente. Em seguida cadastre uma embarcação, um passeio, uma saída e a primeira reserva.

As variáveis de ambiente estão documentadas uma a uma em [`.env.example`](.env.example).

---

## Estrutura

```
src/
  middleware.ts              proteção de rotas
  lib/
    supabase/                clientes browser, server e middleware
    types.ts                 tipos do domínio
  components/                componentes compartilhados
  app/
    login/                   autenticação
    (app)/                   área autenticada
      dashboard/  reservas/     agenda/     saidas/
      clientes/   embarcacoes/  parceiros/  passeios/
      financeiro/ relatorios/   equipe/     configuracoes/
    api/                     rotas públicas, marketplace e webhooks
supabase/
  migrations/                schema versionado
docs/                        documentação técnica
```

---

## Documentação

- [`DOCUMENTACAO.md`](DOCUMENTACAO.md) — documentação técnica completa
- [`.env.example`](.env.example) — variáveis de ambiente comentadas

---

## Status

Em desenvolvimento ativo, com deploy contínuo na Vercel e ambiente de produção em [nauticflow.com.br](https://nauticflow.com.br). Em preparação para lançamento comercial junto a operadores de Búzios, Arraial do Cabo e Cabo Frio.

---

<div align="center">

Desenvolvido por **[Davi Wendell](https://github.com/DAVIWENDELL)** na [Castro Compny](https://github.com/castrocompny)

</div>
