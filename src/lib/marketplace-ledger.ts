// Fase 4B -- cálculos financeiros PUROS do marketplace (comissão + motor de
// reembolso). Nenhuma função aqui faz I/O (sem chamada a Asaas, sem acesso a
// banco) -- são usadas tanto pela RPC real (equivalente em SQL, ver migration
// 0053) quanto testáveis isoladamente. Ver docs/adr/0002-marketplace-ledger-
// payout-refund.md para o desenho completo do ledger/retenção/saque.
//
// NENHUM percentual de comissão ou de política de cancelamento aqui é
// oficial -- são só o FORMATO/CONTRATO. Valores reais são configuração
// (comissão: tabela marketplace_fee_config, vazia até alguém definir;
// política de cancelamento: ainda não existe fonte real no produto, ver ADR).

// ============================================================================
// COMISSÃO DA PLATAFORMA
// ============================================================================

export type MarketplaceFeeConfig = {
  // percentual em pontos-base (1/100 de 1%) -- inteiro, nunca float, mesmo
  // motivo de amount_cents ser inteiro. Ex: 1250 = 12,50%.
  feeBasisPoints: number;
};

export type MarketplaceAmounts = {
  grossAmountCents: number;
  platformFeeCents: number;
  operatorAmountCents: number;
};

const BASIS_POINTS_DENOMINATOR = 10_000;

// Arredondamento determinístico: a taxa da plataforma é sempre arredondada
// pra BAIXO (floor) -- o operador nunca recebe menos do que o valor exato
// menos a taxa arredondada corretamente pra cima seria mais favorável à
// plataforma; arredondar a TAXA pra baixo favorece o operador no
// arredondamento residual (1 centavo no pior caso), decisão consciente e
// documentada, não acidental. operatorAmountCents é sempre o RESTO (nunca
// calculado por si só), garantindo por construção que
// platformFeeCents + operatorAmountCents === grossAmountCents sempre.
export function calculateMarketplaceAmounts(totalCents: number, feeConfig: MarketplaceFeeConfig): MarketplaceAmounts {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error("totalCents inválido: precisa ser inteiro >= 0.");
  }
  if (!Number.isInteger(feeConfig.feeBasisPoints) || feeConfig.feeBasisPoints < 0 || feeConfig.feeBasisPoints > BASIS_POINTS_DENOMINATOR) {
    throw new Error("feeBasisPoints inválido: precisa ser inteiro entre 0 e 10000 (0% a 100%).");
  }

  const platformFeeCents = Math.floor((totalCents * feeConfig.feeBasisPoints) / BASIS_POINTS_DENOMINATOR);
  const operatorAmountCents = totalCents - platformFeeCents;

  return { grossAmountCents: totalCents, platformFeeCents, operatorAmountCents };
}

// ============================================================================
// POLÍTICA DE CANCELAMENTO -- formato/contrato, sem valor oficial nenhum.
// Faixas por horas-antes-da-partida, cada uma com o percentual de reembolso
// AO CLIENTE naquela faixa. Ordenadas da mais permissiva pra mais restritiva
// (maior hoursBeforeDeparture primeiro) -- a validação abaixo confere isso.
// ============================================================================

export type CancellationPolicyTier = {
  hoursBeforeDeparture: number; // >= este número de horas antes da partida
  customerRefundPercentBasisPoints: number; // 0-10000
};

export type CancellationPolicy = {
  tiers: CancellationPolicyTier[];
};

export function isValidCancellationPolicy(policy: CancellationPolicy): boolean {
  if (!Array.isArray(policy.tiers) || policy.tiers.length === 0) return false;
  for (const tier of policy.tiers) {
    if (!Number.isFinite(tier.hoursBeforeDeparture) || tier.hoursBeforeDeparture < 0) return false;
    if (!Number.isInteger(tier.customerRefundPercentBasisPoints) || tier.customerRefundPercentBasisPoints < 0 || tier.customerRefundPercentBasisPoints > BASIS_POINTS_DENOMINATOR) {
      return false;
    }
  }
  // ordem estritamente decrescente por hoursBeforeDeparture -- evita faixas
  // ambíguas/sobrepostas
  for (let i = 1; i < policy.tiers.length; i++) {
    if (policy.tiers[i].hoursBeforeDeparture >= policy.tiers[i - 1].hoursBeforeDeparture) return false;
  }
  return true;
}

export type ReservationOutcome = "completed" | "no_show" | "cancelled";

export type CalculateRefundInput = {
  paidAmountCents: number; // gross pago pelo cliente nesta reserva
  operatorAmountCents: number; // já descontada a comissão (snapshot do payment)
  departureAt: string; // ISO -- data/hora agendada da saída
  cancelledAt: string; // ISO -- momento em que o cancelamento/avaliação ocorre
  policySnapshot: CancellationPolicy; // política CONGELADA no momento da venda -- nunca a atual
  reservationOutcome: ReservationOutcome;
  // Obrigação legal que precisa SOBREPOR a política comercial (ex: direito de
  // arrependimento em algum contexto específico) -- null = não se aplica.
  // NUNCA calculado/inferido aqui -- decidido fora, por quem tem autoridade
  // pra isso (nunca uma interpretação jurídica embutida no código).
  legalOverride: { customerRefundPercentBasisPoints: number } | null;
};

export type CalculateRefundOutput = {
  customerRefundCents: number;
  operatorCompensationCents: number; // quanto o operador efetivamente fica
  platformFeeAdjustmentCents: number; // quanto da comissão é devolvida/ajustada
};

// Função PURA -- nenhum I/O, nenhum acesso a política "atual" (só a que foi
// passada, que deve ser sempre o SNAPSHOT congelado no momento da venda,
// nunca uma consulta ao vivo). "no_show" não recebe tratamento automático de
// "operador fica com 100%" -- usa a MESMA política de cancelamento (a menos
// que um legalOverride diga o contrário), decisão explícita da auditoria:
// a % depende da política aplicável, não de uma regra fixa por outcome.
export function calculateRefund(input: CalculateRefundInput): CalculateRefundOutput {
  if (!Number.isInteger(input.paidAmountCents) || input.paidAmountCents < 0) {
    throw new Error("paidAmountCents inválido.");
  }
  if (!Number.isInteger(input.operatorAmountCents) || input.operatorAmountCents < 0 || input.operatorAmountCents > input.paidAmountCents) {
    throw new Error("operatorAmountCents inválido.");
  }
  if (!isValidCancellationPolicy(input.policySnapshot)) {
    throw new Error("policySnapshot inválido.");
  }

  // obrigação legal sempre vence a política comercial -- nunca o contrário
  let refundPercentBasisPoints: number;
  if (input.legalOverride) {
    refundPercentBasisPoints = input.legalOverride.customerRefundPercentBasisPoints;
  } else if (input.reservationOutcome === "completed") {
    // passeio efetivamente prestado -- sem reembolso por definição (não é
    // "cancelamento", é a venda cumprida). Não usa a tabela de faixas.
    refundPercentBasisPoints = 0;
  } else {
    const hoursBefore = (new Date(input.departureAt).getTime() - new Date(input.cancelledAt).getTime()) / (1000 * 60 * 60);
    const tier = input.policySnapshot.tiers.find((t) => hoursBefore >= t.hoursBeforeDeparture);
    // nenhuma faixa bateu (cancelamento depois da partida, ou dentro da
    // janela mais restritiva sem faixa "catch-all") -- fail-closed: 0% de
    // reembolso automático, precisa de decisão manual/legalOverride explícito.
    refundPercentBasisPoints = tier ? tier.customerRefundPercentBasisPoints : 0;
  }

  if (!Number.isInteger(refundPercentBasisPoints) || refundPercentBasisPoints < 0 || refundPercentBasisPoints > BASIS_POINTS_DENOMINATOR) {
    throw new Error("Percentual de reembolso resultante é inválido.");
  }

  const customerRefundCents = Math.floor((input.paidAmountCents * refundPercentBasisPoints) / BASIS_POINTS_DENOMINATOR);
  // a comissão da plataforma é ajustada NA MESMA PROPORÇÃO do reembolso --
  // decisão simples e defensável (a plataforma não fica com comissão total
  // sobre uma venda parcialmente/totalmente desfeita), mas NÃO assume
  // nenhum tratamento de taxas do PROVIDER (Asaas) -- ver pendência
  // documentada no ADR (seção "taxas do provider").
  const platformFeeCents = input.paidAmountCents - input.operatorAmountCents;
  const platformFeeAdjustmentCents = Math.floor((platformFeeCents * refundPercentBasisPoints) / BASIS_POINTS_DENOMINATOR);
  const operatorDeductionCents = customerRefundCents - platformFeeAdjustmentCents;
  const operatorCompensationCents = input.operatorAmountCents - operatorDeductionCents;

  return { customerRefundCents, operatorCompensationCents, platformFeeAdjustmentCents };
}
