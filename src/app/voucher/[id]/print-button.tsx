"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

export function VoucherPrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (auto) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [auto]);
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark"
    >
      <Printer size={16} /> Imprimir / Salvar PDF
    </button>
  );
}
