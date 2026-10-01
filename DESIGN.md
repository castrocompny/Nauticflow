# NauticFlow — Design e UX

## Direção

O produto deve transmitir operação confiável e rápida para empresas de turismo náutico. Telas devem priorizar clareza de agenda, ocupação, reservas e próximos passos.

## Áreas principais

- Dashboard: indicadores do dia, receita, ocupação e alertas de saídas.
- Agenda: visão temporal das saídas reais, sem esconder horários existentes.
- Reservas: criação clara, status, passageiros e links para voucher/manifesto.
- Saídas: embarcação, horário, ocupação e manifesto.
- Admin: visão operacional de empresas, assinatura, plano e auditoria.
- Mobile: menu retrátil e tabelas com rolagem horizontal quando necessário.

## Temas

O sistema possui tema claro/escuro com tokens semânticos. Novos componentes devem usar tokens existentes, não cores fixas, salvo elementos de marca que precisam permanecer legíveis nos dois temas.

## Regras de interação

- Erros de negócio vindos do banco devem ser apresentados de forma compreensível, sem stack trace.
- Loading e estados vazios devem indicar o que o usuário pode fazer.
- Não confiar em validação visual para segurança ou capacidade.
- Links de voucher, manifesto e passageiros precisam parecer ações clicáveis.
- Mudanças visuais devem ser verificadas em preview antes da produção.

## API pública e marketplace

A API pública é consumida pelo ToursFlow. Não alterar nomes de campos, unidades, timezone, paginação ou semântica de status sem atualizar `docs/PUBLIC-API-CONTRACT.md` e validar o consumidor. Fotos são URLs assinadas temporárias; saídas são serializadas em UTC.

## Acessibilidade e responsividade

Preservar foco, contraste, rótulos de formulário, feedback de erro e uso em telas pequenas. Não trocar uma tabela por um layout que esconda dados operacionais importantes.
