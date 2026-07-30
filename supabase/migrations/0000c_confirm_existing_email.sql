-- Confirma manualmente o e-mail da conta já criada, já que o e-mail de confirmação
-- do Supabase esbarrou no limite de envio (plano gratuito) e nunca foi clicado.
update auth.users
set email_confirmed_at = now()
where email = 'castrocompny@gmail.com'
  and email_confirmed_at is null;
