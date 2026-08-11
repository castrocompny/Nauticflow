import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-heading">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const tones: Record<string, string> = {
  blue: "bg-brand",
  green: "bg-ok",
  purple: "bg-purpleflow",
  amber: "bg-amberflow",
};

export function StatCard({
  label,
  value,
  tone = "blue",
}: {
  label: string;
  value: string;
  tone?: keyof typeof tones;
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className={`grid h-11 w-11 place-items-center rounded-xl ${tones[tone]}`} />
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p className="font-display text-2xl font-semibold text-heading">{value}</p>
      </div>
    </Card>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  red: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  slate: "bg-surfaceHover text-body",
};

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
}) {
  return (
    <span
      className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function OccupancyBar({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = capacity > 0 ? Math.round((booked / capacity) * 100) : 0;
  const color = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-amberflow" : "bg-brand";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-surfaceHover">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="w-10 text-right text-xs text-muted">{pct}%</span>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="font-medium text-heading">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </Card>
  );
}

export function Pager({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <Link
        href={`${basePath}?page=${page - 1}`}
        aria-disabled={page <= 1}
        className={`rounded-lg border border-line px-3 py-1.5 ${
          page <= 1 ? "pointer-events-none text-muted" : "text-body hover:bg-surfaceHover"
        }`}
      >
        Anterior
      </Link>
      <span className="text-xs text-muted">
        Página {page} de {totalPages}
      </span>
      <Link
        href={`${basePath}?page=${page + 1}`}
        aria-disabled={page >= totalPages}
        className={`rounded-lg border border-line px-3 py-1.5 ${
          page >= totalPages ? "pointer-events-none text-muted" : "text-body hover:bg-surfaceHover"
        }`}
      >
        Próxima
      </Link>
    </div>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
    >
      {children}
    </Link>
  );
}
