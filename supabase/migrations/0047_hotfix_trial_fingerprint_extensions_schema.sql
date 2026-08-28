-- HOTFIX #2, mesmo incidente da 0046 (não editar 0045/0046, já aplicadas --
-- mesmo padrão de sempre neste projeto).
--
-- A 0046 corrigiu o cast (text -> bytea), mas revelou o motivo real do erro
-- "function hmac(...) does not exist": neste projeto o pgcrypto foi
-- instalado no schema `extensions` (convenção do próprio Supabase Cloud),
-- não em `public`. trial_fingerprint() tem `set search_path = public`
-- (deliberado, é SECURITY DEFINER -- não amplia à toa por causa do risco de
-- object shadowing) -- então a chamada não-qualificada a hmac() nunca
-- encontra a função em nenhum dos dois casos (nem com text, nem com bytea),
-- e o Postgres reporta isso como "função não existe" pro tipo que foi
-- tentado, o que pareceu (incorretamente) um problema de tipo na 0046.
-- Confirmado via pg_proc: hmac(bytea,bytea,text) e hmac(text,text,text)
-- existem os dois, mas ambos em extensions.hmac, não public.hmac.
--
-- CORREÇÃO: qualifica a chamada explicitamente (extensions.hmac(...)) em vez
-- de ampliar o search_path da função pra incluir extensions -- mantém o
-- search_path o mais restrito possível (só public), reduzindo a superfície
-- de shadowing pro mínimo necessário, só resolvendo esta função específica
-- pelo nome completo.
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
  return encode(extensions.hmac((p_prefix || p_normalized)::bytea, v_pepper::bytea, 'sha256'), 'hex');
end;
$$;

revoke all on function public.trial_fingerprint(text, text) from public, anon, authenticated;
