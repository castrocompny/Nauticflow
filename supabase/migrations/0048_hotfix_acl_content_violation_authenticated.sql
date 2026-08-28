-- HOTFIX de ACL, encontrado durante o E2E de publicação autônoma em
-- produção (não editar 0044, já aplicada -- mesmo padrão de sempre).
--
-- BUG: a migration 0044 revogou EXECUTE de public.check_tour_public_content_violation
-- de public/anon/authenticated como "defesa em profundidade", com o
-- raciocínio (correto pra funções SECURITY DEFINER, errado aqui) de que
-- chamadas internas entre funções não precisam de GRANT no chamador.
--
-- Isso vale quando a função de FORA é SECURITY DEFINER (roda como o dono,
-- ex: trial_fingerprint chamada por handle_new_user). Mas
-- validate_tour_for_publishing() e check_tour_content_while_published()
-- são SECURITY INVOKER de propósito (documentado na própria 0044 -- rodam
-- com a sessão/RLS de quem chamou, pra um operador só validar/editar o
-- PRÓPRIO passeio). Nesse caso a chamada interna a
-- check_tour_public_content_violation() também roda com o privilégio do
-- CHAMADOR ORIGINAL (authenticated), não do dono da função -- revogar de
-- authenticated quebrou os dois caminhos: o checklist (RPC
-- validate_tour_for_publishing) e a publicação em si (o UPDATE de
-- marketplace_status dispara check_tour_marketplace_transition, que chama
-- validate_tour_for_publishing por dentro).
--
-- Confirmado em produção: qualquer operador autenticado tentando publicar
-- ou só ver o checklist recebia "permission denied for function
-- check_tour_public_content_violation".
--
-- CORREÇÃO: só reconceder EXECUTE a authenticated. anon e PUBLIC continuam
-- sem acesso (nenhum caminho legítimo os chama direto) -- nenhuma outra
-- mudança, mesmo corpo de função, mesma segurança de tudo o resto.
grant execute on function public.check_tour_public_content_violation(
  p_name text, p_description text, p_short_description text, p_itinerary text,
  p_included text, p_not_included text, p_important_information text,
  p_boarding_instructions text, p_boarding_reference text
) to authenticated;
