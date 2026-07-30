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
      className={`rounded-card border border-slate-200 bg-white p-5 ${className}`}
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
        <h1 className="font-display text-xl font-semibold text-navy">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
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
        <p className="text-xs text-slate-500">{label}</p>
        <p className="font-display text-2xl font-semibold text-navy">{value}</p>
      </div>
    </Card>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  slate: "bg-slate-100 text-slate-600",
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
      <div className="h-2 flex-1 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="w-10 text-right text-xs text-slate-500">{pct}%</span>
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
      <p className="font-medium text-navy">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
      {action}
    </Card>
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
