-- HOTFIX urgente, encontrado durante o teste controlado em produção logo após
-- aplicar 0044/0045 (não editar 0045, já aplicada -- mesmo padrão da 0043
-- sobre a 0042).
--
-- BUG: public.trial_fingerprint() chamava hmac(text, text, text) -- a função
-- hmac() do pgcrypto exige bytea nos dois primeiros argumentos
-- (hmac(bytea, bytea, text) returns bytea), não existe overload que aceite
-- text direto. Resultado real em produção: TODO signup novo que passasse
-- pelo branch do plano "profissional" (ou seja, todo signup normal) quebrava
-- com "42883: function hmac(text, text, unknown) does not exist" dentro de
-- handle_new_user() -- a exceção não é capturada (só o INSERT em
-- trial_history tem exception handler, não a chamada a trial_fingerprint()
-- em si), então a transação inteira do signup abortava. Confirmado em
-- produção: POST /auth/v1/signup retornava 500 "Database error saving new
-- user" pra qualquer tentativa.
--
-- CORREÇÃO: cast explícito de text pra bytea nos dois primeiros argumentos
-- (::bytea usa a codificação do banco, UTF8 neste projeto -- mesma
-- codificação usada em todo o resto do schema). Nenhuma outra mudança de
-- comportamento -- mesma assinatura, mesmo pepper, mesmo prefixo.
create or replace function public.trial_fingerprint(p_prefix text, p_normalized text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pepper text;
begin
  if p_normalized is null then
    return null;
  end if;
  select pepper into v_pepper from public.trial_identity_secret where id = 1;
  if v_pepper is null then
    return null;
  end if;
  return encode(hmac((p_prefix || p_normalized)::bytea, v_pepper::bytea, 'sha256'), 'hex');
end;
$$;

-- CREATE OR REPLACE preserva ACL (mesma assinatura) -- reafirmado explicitamente
-- mesmo assim, mesmo padrão do resto do projeto.
revoke all on function public.trial_fingerprint(text, text) from public, anon, authenticated;
