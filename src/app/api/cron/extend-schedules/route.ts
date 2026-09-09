import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Auto-extensão da agenda recorrente (migration 0063) -- garante que toda
// regra com auto_extend=true continue com o horizonte configurado sempre
// gerado, sem o operador precisar voltar e salvar de novo. PRIMEIRO cron
// deste projeto -- nenhum mecanismo existia antes (ver auditoria).
//
// Proteção: header Authorization: Bearer $CRON_SECRET, mecanismo oficial
// documentado da Vercel (a Vercel injeta esse header automaticamente quando
// a env var CRON_SECRET existe no projeto -- nunca no client, nunca em
// nenhuma outra rota). Ausência/mismatch -> 401, fail closed. CRON_SECRET
// ainda não está configurado neste projeto -- configuração fica pro usuário,
// via Vercel, quando este mecanismo for ativado de verdade (nenhum secret
// alterado nesta sessão).
//
// Idempotente e resiliente a duplicidade/perda de execução por design (pedido
// explícito da própria documentação de Cron Jobs da Vercel): cada regra é
// processada de forma independente, generate_departures_for_schedule_rule
// (0063) já é idempotente (ON CONFLICT DO NOTHING + advisory lock por regra),
// então rodar duas vezes ou pular uma execução nunca duplica nem quebra nada.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rules, error } = await admin
    .from("tour_schedule_rules")
    .select("id")
    .eq("active", true)
    .eq("auto_extend", true);

  if (error) {
    console.error("extend-schedules cron:", error);
    return NextResponse.json({ ok: false, error: "Falha ao listar regras." }, { status: 500 });
  }

  let generated = 0;
  let failed = 0;
  for (const rule of rules ?? []) {
    const { data, error: genError } = await admin.rpc("generate_departures_for_schedule_rule", {
      p_schedule_rule_id: rule.id,
    });
    if (genError) {
      failed++;
      console.error("extend-schedules cron/generate:", rule.id, genError);
      continue;
    }
    generated += Array.isArray(data) ? data.length : 0;
  }

  return NextResponse.json({ ok: true, rulesProcessed: rules?.length ?? 0, departuresGenerated: generated, failed });
}
