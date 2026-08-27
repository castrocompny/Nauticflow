import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";

// Recebe as notificacoes de pagamento do Asaas (evento PAYMENT_CONFIRMED/PAYMENT_RECEIVED)
// e renova a assinatura da empresa correspondente automaticamente.
//
// Usa a service_role key (bypassa RLS) porque quem chama aqui e o Asaas, nao um usuario
// logado com sessao — nao ha como usar o client normal (baseado em cookies) nesse caso.
// A autenticidade da chamada e verificada pelo header asaas-access-token, configurado
// igual nos dois lados (aqui e no painel de Webhooks do Asaas).

const RELEVANT_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);

// comparacao em tempo constante -- "!==" normal vaza, por timing, quantos caracteres
// iniciais bateram, o que teoricamente ajuda um atacante a adivinhar o token aos poucos
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  const token = request.headers.get("asaas-access-token");
  const secret = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!secret || !token || !safeEqual(token, secret)) {
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

  const paymentId = payment.id as string | undefined;
  if (!paymentId) return NextResponse.json({ ok: true });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // idempotência: registra a chave (provider, payment.id) ANTES de renovar. Se o
  // Asaas reenviar a mesma notificação, ou mandar PAYMENT_CONFIRMED e depois
  // PAYMENT_RECEIVED pro mesmo pagamento, o insert bate na unique constraint e a
  // gente nunca soma o prazo duas vezes pra mesma cobrança (migration 0037).
  const { error: dedupeError } = await supabase
    .from("processed_webhook_events")
    .insert({ provider: "asaas", event_type: event, event_key: paymentId });
  if (dedupeError) {
    if (dedupeError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    // erro inesperado ao gravar a marca de dedupe: não falha o webhook por isso
    // (o Asaas reenviaria em loop), só não renova por segurança nesta chamada
    return NextResponse.json({ ok: true });
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, paid_until, billing_cycle")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return NextResponse.json({ ok: true });

  // renova pelo tamanho do ciclo: 1 ano (anual) ou 30 dias (mensal)
  const days = sub.billing_cycle === "anual" ? 365 : 30;
  const base = sub.paid_until && new Date(sub.paid_until) > new Date() ? new Date(sub.paid_until) : new Date();
  base.setDate(base.getDate() + days);

  await supabase
    .from("subscriptions")
    .update({ paid_until: base.toISOString(), status: "ativa" })
    .eq("id", sub.id);

  // sem o "force-dynamic" global no layout, precisa disso pra sidebar/topbar da empresa
  // mostrarem o plano/vencimento renovados na próxima navegação, e não o dado antigo em cache
  revalidatePath("/dashboard", "layout");

  return NextResponse.json({ ok: true });
}
