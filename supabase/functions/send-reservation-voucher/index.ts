// Supabase Edge Function: send-reservation-voucher
// Recebe { reservation_id }, busca a reserva (sob RLS do usuario) e envia o voucher por e-mail via Resend.
// Roda no Deno (ambiente das Edge Functions do Supabase), nao faz parte do build do Next.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  try {
    const { reservation_id } = await req.json();
    if (!reservation_id) return json({ error: "reservation_id e obrigatorio." }, 400);

    // usa o token do usuario que chamou: a leitura respeita a RLS (so a empresa dele)
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data, error } = await supabase
      .from("reservations")
      .select(
        "id, people_count, total_cents, status, clients(name, email), departures(departs_at, vessels(name), tours(name)), companies(name)"
      )
      .eq("id", reservation_id)
      .maybeSingle();

    if (error || !data) return json({ error: "Reserva nao encontrada." }, 404);

    const r = data as any;
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ sent: false, message: "Envio de e-mail ainda nao configurado." }, 200);

    const clientEmail = r.clients?.email;
    if (!clientEmail) return json({ sent: false, message: "Cliente sem e-mail cadastrado." }, 200);

    const from = Deno.env.get("RESEND_FROM") ?? "NauticFlow <onboarding@resend.dev>";
    const html = buildEmail(r);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [clientEmail],
        subject: "Seu voucher de reserva — NauticFlow",
        html,
      }),
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

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// escapa texto livre (nome de cliente, empresa, passeio, embarcacao) antes de colar no HTML do e-mail
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmail(r: any): string {
  const code = `RES-${String(r.id).slice(0, 8).toUpperCase()}`;
  const dep = r.departures ?? {};
  const date = dep.departs_at ? new Date(dep.departs_at).toLocaleDateString("pt-BR") : "-";
  const time = dep.departs_at
    ? new Date(dep.departs_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "-";
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">${label}</td>` +
    `<td style="padding:6px 0;color:#0d1b3e;font-size:13px;font-weight:600;text-align:right">${value}</td></tr>`;

  // icone atual e quadrado (1024x1024) com fundo transparente de verdade
  const logoUrl = Deno.env.get("LOGO_URL");
  const logoImg = logoUrl
    ? `<img src="${logoUrl}" alt="NauticFlow" width="42" height="42" style="vertical-align:middle;margin-right:8px">`
    : "";

  // meta tags abaixo dizem pro cliente de e-mail (Gmail, Outlook, Apple Mail) pra nao
  // aplicar modo escuro automatico no e-mail - sem isso, alguns clientes invertem/lavam
  // as cores do cabecalho navy e o logo fica sem contraste.
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <style>:root { color-scheme: light only; supported-color-schemes: light only; }</style>
  </head>
  <body style="margin:0;padding:24px 12px;background:#f4f6fa">
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;background:#ffffff">
    <div style="background:#0d1b3e;padding:20px 24px;color:#fff">
      <span style="font-size:18px;font-weight:700;vertical-align:middle">${logoImg}Nautic<span style="color:#2d9cff">Flow</span></span>
      <div style="font-size:12px;color:#cbd5e1;margin-top:2px">${escapeHtml(r.companies?.name ?? "")}</div>
    </div>
    <div style="padding:24px">
      <p style="font-size:15px;color:#0d1b3e">Olá, ${escapeHtml(r.clients?.name ?? "cliente")}!</p>
      <p style="font-size:13px;color:#475569">Sua reserva foi registrada. Seguem os dados do seu voucher.</p>
      <div style="background:#f4f6fa;border-radius:10px;padding:12px 16px;margin:16px 0">
        <span style="font-size:12px;color:#64748b">Código da reserva</span>
        <div style="font-size:18px;font-weight:700;color:#0d1b3e;letter-spacing:1px">${code}</div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        ${row("Passeio", escapeHtml(dep.tours?.name ?? "-"))}
        ${row("Embarcação", escapeHtml(dep.vessels?.name ?? "-"))}
        ${row("Data", date)}
        ${row("Horário", time)}
        ${row("Passageiros", String(r.people_count))}
        ${row("Valor", r.total_cents > 0 ? brl(r.total_cents) : "-")}
        ${row("Status", r.status === "confirmada" ? "Confirmada" : r.status)}
      </table>
      <div style="background:#eff6ff;border-radius:10px;padding:12px 16px;margin-top:16px;color:#1d4ed8;font-size:13px;font-weight:600;text-align:center">
        Apresente este voucher no embarque.
      </div>
    </div>
    <div style="border-top:1px solid #e2e8f0;padding:14px;text-align:center;color:#94a3b8;font-size:11px">
      Enviado automaticamente pelo NauticFlow.
    </div>
  </div>
  </body>
  </html>`;
}
