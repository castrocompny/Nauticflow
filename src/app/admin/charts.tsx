// Graficos simples do painel admin -- server components (sem JS no cliente), com
// rotulo direto em vez de tooltip no hover, porque sao poucos pontos (ate 12
// barras) e a pagina e um relatorio de relance, nao um dashboard denso.
// Reaproveita os tokens de cor do app (bg-brand etc.) em vez de introduzir uma
// paleta categorica nova -- cada grafico usa 1 unica cor, identidade vem do
// rotulo de texto, nao da cor (evita precisar validar contraste/CVD pra isso).

export function NewCompaniesChart({ months }: { months: { label: string; count: number }[] }) {
  const max = Math.max(...months.map((m) => m.count), 1);
  return (
    <div className="flex h-32 items-end gap-1.5">
      {months.map((m) => {
        const h = (m.count / max) * 100;
        return (
          <div key={m.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-heading">{m.count > 0 ? m.count : ""}</span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-sm bg-brand"
                style={{ height: `${Math.max(h, m.count > 0 ? 4 : 0)}%` }}
                title={`${m.label}: ${m.count}`}
              />
            </div>
            <span className="text-[10px] text-muted">{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FunnelChart({ stages }: { stages: { label: string; count: number }[] }) {
  const max = stages[0]?.count || 1;
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const pct = Math.round((s.count / max) * 100);
        const prev = i > 0 ? stages[i - 1].count : null;
        const dropPct = prev && prev > 0 ? Math.round((s.count / prev) * 100) : null;
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-heading">{s.label}</span>
              <span className="text-muted">
                {s.count} {dropPct != null && <span>· {dropPct}% do estágio anterior</span>}
              </span>
            </div>
            <div className="h-3 rounded-full bg-surfaceHover">
              <div className="h-3 rounded-full bg-brand" style={{ width: `${Math.max(pct, s.count > 0 ? 3 : 0)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PlanDistributionChart({ plans }: { plans: { name: string; count: number }[] }) {
  const max = Math.max(...plans.map((p) => p.count), 1);
  if (plans.every((p) => p.count === 0)) {
    return <p className="py-6 text-center text-sm text-muted">Sem empresas com plano definido ainda.</p>;
  }
  return (
    <div className="space-y-2.5">
      {plans.map((p) => (
        <div key={p.name}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-heading">{p.name}</span>
            <span className="text-muted">{p.count}</span>
          </div>
          <div className="h-2 rounded-full bg-surfaceHover">
            <div className="h-2 rounded-full bg-brand" style={{ width: `${(p.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
