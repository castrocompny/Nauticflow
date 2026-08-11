"use client";

import { useState } from "react";
import { brl } from "@/lib/format";

type Point = { label: string; value: number };

export function BarsChart({
  points,
  color,
  formatType,
}: {
  points: Point[];
  color: string;
  formatType: "brl" | "percent";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.value), 1);
  const hasData = points.some((p) => p.value > 0);

  if (!hasData) {
    return <div className="py-8 text-center text-sm text-muted">Sem dados ainda.</div>;
  }

  const format = (v: number) => (formatType === "brl" ? brl(Math.round(v * 100)) : `${v}%`);
  const hovered = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      {hovered && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-navy px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: `${((hover! + 0.5) / points.length) * 100}%` }}
        >
          <p className="font-semibold">{format(hovered.value)}</p>
          <p className="text-[10px] text-muted">{hovered.label}</p>
        </div>
      )}
      <svg
        viewBox={`0 0 ${points.length * 4} 40`}
        preserveAspectRatio="none"
        className="h-24 w-full cursor-crosshair"
        onMouseLeave={() => setHover(null)}
      >
        {points.map((p, i) => {
          const h = max ? (p.value / max) * 36 : 0;
          const dim = hover !== null && hover !== i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * 4} y={0} width={4} height={40} fill="transparent" />
              <rect
                x={i * 4 + 0.6}
                y={40 - h}
                width={2.8}
                height={h}
                rx={1}
                fill={color}
                opacity={dim ? 0.4 : 1}
                className="transition-opacity"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
