# NauticFlow — Arquitetura atual

## Produto

NauticFlow é um SaaS multiempresa para operadores de turismo náutico. O fluxo operacional é:

```text
Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto/Voucher
```

## Stack confirmada no `package.json`

- Next.js 16.3.x com App Router.
- React 19.1.x.
- TypeScript 5.6.x.
- Tailwind CSS.
- Supabase: Auth, Postgres, PostgREST, Storage, RLS, triggers e funções PL/pgSQL.
- Vercel para deploy.
- Sentry para monitoramento.
- Resend para e-mails.
- Asaas para cobrança recorrente/Pix.

O README e partes de `DOCUMENTACAO.md` ainda mencionam Next 14/React 18 em trechos históricos. Confirme sempre `package.json`, lockfile, código e migrations antes de atualizar versões.

## Isolamento multiempresa

Cada empresa é um tenant identificado por `company_id`. O isolamento deve existir no banco por RLS, além das checagens no servidor. IDs recebidos de formulários ou APIs não podem ser confiados sem confirmar a empresa proprietária do registro relacionado.

Regras críticas ficam no PostgreSQL: capacidade comercial, vagas concorrentes, limite de passageiros, horário de saída, vínculos entre empresas e outras invariantes de negócio.

## Áreas principais

- `src/app/(app)/`: dashboard, reservas, agenda, saídas, clientes, embarcações, parceiros, passeios, financeiro, relatórios, equipe e configurações.
- `src/app/admin/`: operações do super administrador.
- `src/app/api/public/`: API pública consumida pelo ToursFlow.
- `src/app/api/marketplace/`: integração de reservas do marketplace.
- `src/app/api/webhooks/asaas/`: confirmações de cobrança.
- `src/lib/`: Supabase, perfil, assinatura, API pública e regras compartilhadas.
- `supabase/migrations/`: schema e regras versionadas do banco.
- `docs/PUBLIC-API-CONTRACT.md`: contrato público atual para o ToursFlow.

## Integrações

- ToursFlow: marketplace público; consome passeios, destinos, categorias, saídas e registra reservas pela API.
- Asaas: checkout, assinaturas e webhooks de pagamento.
- Resend: e-mails transacionais.
- Sentry: erros e observabilidade.
- Open-Meteo/OpenAI podem existir em fluxos específicos; confirme uso no código antes de assumir dependência obrigatória.

## Segurança e operação

- Supabase service role somente no servidor/webhook/admin; nunca no bundle do navegador.
- RLS, grants e triggers devem ser tratados como parte do contrato de segurança.
- Webhooks precisam autenticar o token e manter idempotência.
- Não expor detalhes internos ou stack traces em respostas públicas.
- Não aplicar migrations diretamente sem confirmar ambiente e ordem.
- O ambiente de produção e o Sandbox do Asaas não devem ser confundidos.
- Mudanças normais devem passar por preview/branch antes de `main`; correções de segurança urgentes são exceção controlada.
