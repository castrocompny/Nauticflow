import { redirect } from "next/navigation";
import { ScrollShadowX } from "@/components/scroll-shadow-x";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { Card, PageHeader, Badge } from "@/components/ui";
import { brl, fmtDate, startEndOfToday } from "@/lib/format";
import { BarsChart } from "../dashboard/bars-chart";
import { getFinancialSummary } from "./payout-actions";
import { PayoutAccountForm } from "./payout-account-ui";
import { listWithdrawals } from "./withdrawal-actions";
import { WithdrawalPanel, WithdrawalHistory } from "./withdrawal-ui";

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

type Res = {
  id: string;
  total_cents: number;
  status: string;
  created_at: string;
  clients: { name: string } | null;
  departures: { departs_at: string; vessels: { name: string } | null } | null;
};

export default async function FinanceiroPage(props: { searchParams: Promise<{ p?: string }> }) {
  // faturamento nao e coisa de operador (staff) ver
  const profile = await getProfile();
  if (profile?.role === "staff") redirect("/dashboard");

  const summary = await getFinancialSummary();
  const withdrawals = await listWithdrawals();

  const searchParams = await props.searchParams;
  const p = searchParams.p === "ano" ? "ano" : "mes";
  const supabase = createClient();
  const now = new Date();
  const periodStart = (p === "ano" ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth(), 1)).toISOString();
  const { start: todayStart } = startEndOfToday();

  const { data } = await supabase
    .from("reservations")
    .select("id, total_cents, status, created_at, clients(name), departures(departs_at, vessels(name))")
    .gte("created_at", periodStart)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as Res[];
  const confirmadas = rows.filter((r) => r.status === "confirmada");
  const canceladas = rows.filter((r) => r.status === "cancelada");
  const receitaPeriodo = confirmadas.reduce((s, r) => s + r.total_cents, 0);
  const receitaHoje = confirmadas
    .filter((r) => r.created_at >= todayStart)
    .reduce((s, r) => s + r.total_cents, 0);
  const ticket = confirmadas.length ? Math.round(receitaPeriodo / confirmadas.length) : 0;
  const periodoLabel = p === "ano" ? "do ano" : "do mês";

  // receita ao longo do tempo: por dia (mes) ou por mes (ano)
  let chartPoints: { label: string; value: number }[];
  if (p === "ano") {
    const year = now.getFullYear();
    const byMonth = Array.from({ length: 12 }, () => 0);
    confirmadas.forEach((r) => {
      const d = new Date(r.created_at);
      if (d.getFullYear() === year) byMonth[d.getMonth()] += r.total_cents;
    });
    chartPoints = byMonth.map((cents, i) => ({ label: MONTH_NAMES[i], value: cents / 100 }));
  } else {
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const byDay = Array.from({ length: daysInMonth }, () => 0);
    confirmadas.forEach((r) => {
      const d = new Date(r.created_at);
      if (d.getFullYear() === year && d.getMonth() === month) byDay[d.getDate() - 1] += r.total_cents;
    });
    chartPoints = byDay.map((cents, i) => ({
      label: `${String(i + 1).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}`,
      value: cents / 100,
    }));
  }

  // receita por embarcacao no periodo
  const porEmbarcacao: Record<string, number> = {};
  confirmadas.forEach((r) => {
    const name = r.departures?.vessels?.name ?? "Sem embarcação";
    porEmbarcacao[name] = (porEmbarcacao[name] ?? 0) + r.total_cents;
  });
  const topVessels = Object.entries(porEmbarcacao)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <>
      <PageHeader title="Financeiro" subtitle="Movimentação do período selecionado, com base nas reservas." />

      <Card className="mb-5">
        <h2 className="mb-1 font-display text-base font-semibold text-heading">Marketplace ToursFlow — Recebimento</h2>
        <p className="mb-4 text-xs text-muted">
          Saldo das vendas feitas pelo marketplace ToursFlow. Nenhuma transferência real acontece enquanto o saque não
          estiver habilitado e sua chave Pix não estiver verificada.
        </p>
        {"error" in summary ? (
          <p className="text-sm text-danger">{summary.error}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted">Saldo bloqueado</p>
                  <p className="mt-1 font-display text-lg font-semibold text-heading">{brl(summary.blockedCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Saldo disponível</p>
                  <p className="mt-1 font-display text-lg font-semibold text-ok">{brl(summary.availableCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Em processamento de saque</p>
                  <p className="mt-1 text-sm text-body">{brl(summary.pendingWithdrawalCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Já transferido</p>
                  <p className="mt-1 text-sm text-body">{brl(summary.transferredCents)}</p>
                </div>
              </div>
              <WithdrawalPanel
                availableCents={summary.availableCents}
                payoutMasked={summary.payout?.pixKeyMasked ?? null}
                canWithdraw={Boolean(summary.payout) && summary.payout?.verificationStatus === "verified"}
                blockedReason={
                  !summary.payout
                    ? "Cadastre uma chave Pix para poder sacar."
                    : summary.payout.verificationStatus !== "verified"
                      ? "Sua chave Pix ainda não foi verificada -- saque indisponível até a verificação."
                      : null
                }
              />
            </div>
            <div className="border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Conta para recebimento</p>
              {summary.payout ? (
                <div className="mb-3 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-heading">{summary.payout.pixKeyMasked}</p>
                    <p className="text-xs text-muted">Chave {summary.payout.pixKeyType.toUpperCase()}</p>
                  </div>
                  <Badge tone={summary.payout.verificationStatus === "verified" ? "green" : summary.payout.verificationStatus === "rejected" ? "red" : "amber"}>
                    {summary.payout.verificationStatus === "verified"
                      ? "Verificada"
                      : summary.payout.verificationStatus === "rejected"
                        ? "Rejeitada"
                        : "Titularidade não verificada"}
                  </Badge>
                </div>
              ) : (
                <p className="mb-3 text-sm text-muted">Nenhuma chave Pix cadastrada ainda.</p>
              )}
              <PayoutAccountForm hasExisting={Boolean(summary.payout)} />
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 font-display text-base font-semibold text-heading">Histórico de saques</h2>
        {Array.isArray(withdrawals) ? (
          <WithdrawalHistory withdrawals={withdrawals} />
        ) : (
          <p className="text-sm text-danger">{withdrawals.error}</p>
        )}
      </Card>

      <div className="mb-4 flex gap-2">
        <Link
          href="/financeiro?p=mes"
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            p === "mes" ? "border-brand bg-brand text-white" : "border-line bg-surface text-body hover:bg-surfaceHover"
          }`}
        >
          Receita do mês
        </Link>
        <Link
          href="/financeiro?p=ano"
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            p === "ano" ? "border-brand bg-brand text-white" : "border-line bg-surface text-body hover:bg-surfaceHover"
          }`}
        >
          Receita do ano
        </Link>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Receita ${periodoLabel}`} value={brl(receitaPeriodo)} tone="text-ok" />
        <Stat label="Receita de hoje" value={brl(receitaHoje)} tone="text-ok" />
        <Stat label="Ticket médio" value={brl(ticket)} tone="text-heading" />
        <Stat label="Reservas confirmadas" value={String(confirmadas.length)} tone="text-brand" />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Reservas canceladas" value={String(canceladas.length)} tone="text-danger" />
        <Stat label={`Total de reservas ${periodoLabel}`} value={String(rows.length)} tone="text-heading" />
      </div>

      <Card className="mb-5">
        <h2 className="mb-3 font-display text-base font-semibold text-heading">Receita {periodoLabel}</h2>
        <BarsChart points={chartPoints} color="#2563EB" formatType="brl" />
      </Card>

      {topVessels.length > 0 && (
        <Card className="mb-5">
          <h2 className="mb-3 font-display text-base font-semibold text-heading">Receita por embarcação {periodoLabel}</h2>
          <div className="space-y-2">
            {topVessels.map(([name, cents]) => {
              const max = topVessels[0][1] || 1;
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm text-heading">{name}</span>
                  <div className="h-2 flex-1 rounded-full bg-surfaceHover">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${(cents / max) * 100}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs text-muted">{brl(cents)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="p-0">
        <h2 className="px-5 py-4 font-display text-base font-semibold text-heading">Movimentações {periodoLabel}</h2>
        {rows.length === 0 ? (
          <p className="px-5 pb-6 text-center text-sm text-muted">Nenhuma movimentação {periodoLabel}.</p>
        ) : (
          <ScrollShadowX>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs text-muted">
                <th className="px-5 py-2.5">Data</th>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Saída</th>
                <th className="px-4 py-2.5 text-right">Valor</th>
                <th className="px-5 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 text-muted">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-heading">{r.clients?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-body">{r.departures?.vessels?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-right">{brl(r.total_cents)}</td>
                  <td className="px-5 py-3 text-right">
                    <Badge tone={r.status === "confirmada" ? "green" : "slate"}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </ScrollShadowX>
        )}
      </Card>

      <p className="mt-3 text-xs text-muted">
        Valores reais das reservas. O sistema ainda não tem forma de pagamento nem status pago/pendente separados, então
        considera receita as reservas confirmadas.
      </p>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}
