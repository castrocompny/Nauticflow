# NauticFlow — Tarefas e pendências

## Estado confirmado

- [x] Fluxo Embarcação → Passeio → Saída → Reserva → Passageiros → Manifesto/Voucher.
- [x] Isolamento multiempresa com RLS e regras críticas no PostgreSQL.
- [x] Dashboard, agenda, reservas, saídas, clientes, embarcações, parceiros, passeios, financeiro, equipe e admin.
- [x] API pública para ToursFlow documentada em `docs/PUBLIC-API-CONTRACT.md`.
- [x] Asaas, Resend, Sentry e Vercel integrados em pontos específicos.
- [x] Tema claro/escuro e ajustes responsivos.

## Pendências prioritárias

- [ ] Revisar e consolidar divergências históricas entre `README.md`, `DOCUMENTACAO.md` e `package.json`.
- [ ] Completar/validar `.env.example` sem incluir segredos.
- [ ] Confirmar estado real de produção e Sandbox do Asaas antes de qualquer lançamento comercial.
- [ ] Aplicar/verificar migrations pendentes no ambiente correto, sem assumir que arquivo local significa migration aplicada.
- [ ] Criar ou ampliar testes automatizados para RLS, RPCs, Server Actions críticas e webhooks.
- [ ] Fechar revisão das mudanças atualmente não commitadas antes de iniciar outra tarefa.
- [ ] Manter o contrato público sincronizado com o código e o ToursFlow.
- [ ] Reavaliar as pendências de confiabilidade já registradas na documentação antes de novas features.

## Futuro, sem compromisso ainda

- [ ] Emissão automática de NFS-e quando houver provedor, requisitos fiscais e decisão de produto.
- [ ] Logo personalizada por empresa.
- [ ] Melhorias de suporte e painel admin conforme a base de clientes crescer.

## Regras

1. Não apagar nem reverter alterações locais existentes sem autorização.
2. Antes de alterar banco, identificar migration, ambiente e impacto de RLS.
3. Antes de deploy, rodar typecheck, lint, build e revisão manual de segurança.
4. Mudanças visuais/funcionais normais passam por branch/preview antes de `main`.
5. Marcar tarefa como concluída somente com evidência no código, teste ou ambiente.
