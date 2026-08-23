// Supabase Edge Function: send-email
// Mailer generico via Resend, usado pelo backend do Next.js pra e-mails cujo link a
// gente precisa montar com a mao (ex.: convite de equipe -- ver equipe/actions.ts).
// Existe porque RESEND_API_KEY so esta configurada como secret de Edge Function
// (mesma usada por send-reservation-voucher), nao como env var do Next.js.
//
// So aceita chamada com um segredo compartilhado proprio (MAILER_SECRET, gerado a
// parte e configurado como secret desta function + env var do Next.js) -- ela nao
// faz NENHUMA checagem de permissao/RLS sozinha, entao so pode ser chamada pelo
// nosso backend (que ja validou tudo antes de montar o e-mail), nunca direto pelo
// client. Nao usa SUPABASE_SERVICE_ROLE_KEY pra essa checagem de proposito: e um
// segredo dedicado, sem reaproveitar uma credencial de outro escopo.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const mailerSecret = Deno.env.get("MAILER_SECRET") ?? "";
  if (!mailerSecret || req.headers.get("x-mailer-secret") !== mailerSecret) {
    return json({ error: "Não autorizado." }, 401);
  }

  try {
    const { to, subject, html } = await req.json();
    if (!to || !subject || !html) return json({ error: "to, subject e html são obrigatórios." }, 400);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ sent: false, message: "Envio de e-mail ainda não configurado." }, 200);

    const from = Deno.env.get("RESEND_FROM") ?? "NauticFlow <onboarding@resend.dev>";

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ sent: false, message: "Falha ao enviar e-mail.", detail }, 200);
    }
    return json({ sent: true }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
