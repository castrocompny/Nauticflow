import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Recebe as notificacoes de pagamento do Asaas (evento PAYMENT_CONFIRMED/PAYMENT_RECEIVED)
// e renova a assinatura da empresa correspondente automaticamente.
//
// Usa a service_role key (bypassa RLS) porque quem chama aqui e o Asaas, nao um usuario
// logado com sessao — nao ha como usar o client normal (baseado em cookies) nesse caso.
// A autenticidade da chamada e verificada pelo header asaas-access-token, configurado
// igual nos dois lados (aqui e no painel de Webhooks do Asaas).

const RELEVANT_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);

export async function POST(request: Request) {
  const token = request.headers.get("asaas-access-token");
  if (!process.env.ASAAS_WEBHOOK_TOKEN || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const event = body?.event as string | undefined;
  const payment = body?.payment;
  if (!event || !payment || !RELEVANT_EVENTS.has(event)) {
    return NextResponse.json({ ok: true });
  }

  const companyId = payment.externalReference as string | undefined;
  if (!companyId) return NextResponse.json({ ok: true });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, paid_until")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return NextResponse.json({ ok: true });

  const base = sub.paid_until && new Date(sub.paid_until) > new Date() ? new Date(sub.paid_until) : new Date();
  base.setDate(base.getDate() + 30);

  await supabase
    .from("subscriptions")
    .update({ paid_until: base.toISOString(), status: "ativa" })
    .eq("id", sub.id);

  return NextResponse.json({ ok: true });
}
