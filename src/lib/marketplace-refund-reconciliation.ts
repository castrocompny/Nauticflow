// Lógica pura de interpretação do retorno de mark_marketplace_refund_processing
// (migration 0062) -- separada do server action (que exige contexto de sessão
// Next.js via cookies()) pra ser testável isoladamente, sem mockar request.
//
// Existe porque a versão anterior do server action ignorava `data`/`error`
// da chamada RPC e sempre devolvia ok=true/status=processing -- corrigido
// junto com o bug de rollback de mark_marketplace_refund_processing (0061 ->
// 0062, ver comentário na migration). Nunca retorna sucesso a menos que a
// RPC confirme EXPLICITAMENTE status='processing'.

export type MarkProcessingRpcRow = { id: string; status: string; provider_refund_id: string } | null;
export type MarkProcessingRpcError = { message: string } | null;

export type MarkProcessingOutcome = { ok: true; status: "processing" } | { ok: false; error: string; logCode: string };

export function interpretMarkProcessingResult(data: MarkProcessingRpcRow, error: MarkProcessingRpcError): MarkProcessingOutcome {
  if (error) {
    // o provider pode já ter aceitado o refund -- uma nova tentativa NUNCA
    // faz um POST duplicado (initiateMarketplacePaymentRefund consulta o
    // provider antes de criar, ver src/lib/asaas.ts), só reconcilia.
    return {
      ok: false,
      logCode: error.message.slice(0, 64),
      error: "O reembolso pode ter sido aceito pelo provider, mas não foi possível registrar isso no sistema -- uma nova tentativa reconcilia automaticamente, sem duplicar.",
    };
  }

  if (!data) {
    return { ok: false, logCode: "empty_row", error: "Resposta inesperada ao registrar o reembolso -- revise manualmente." };
  }

  if (data.status !== "processing") {
    // cobre manual_review (mismatch de provider_refund_id) e qualquer outro
    // status que não seja o esperado -- nunca reportado como sucesso.
    return { ok: false, logCode: `status_${data.status}`, error: "O reembolso ficou em um estado que precisa de revisão manual." };
  }

  return { ok: true, status: "processing" };
}
