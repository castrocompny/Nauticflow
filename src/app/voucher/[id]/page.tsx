import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { brl, fmtDate, fmtTime } from "@/lib/format";
import { VoucherPrintButton } from "./print-button";

type Voucher = {
  id: string;
  people_count: number;
  total_cents: number;
  status: string;
  origin_name: string | null;
  notes: string | null;
  created_at: string;
  clients: { name: string; phone: string | null; email: string | null } | null;
  departures: { departs_at: string; vessels: { name: string } | null; tours: { name: string } | null } | null;
  companies: { name: string } | null;
};

export default async function VoucherPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { print?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("reservations")
    .select(
      "id, people_count, total_cents, status, origin_name, notes, created_at, clients(name, phone, email), departures(departs_at, vessels(name), tours(name)), companies(name)"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Link href="/reservas" className="inline-flex items-center gap-1.5 text-sm text-slate-500">
          <ArrowLeft size={16} /> Voltar
        </Link>
        <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Reserva não encontrada ou sem acesso.
        </p>
      </div>
    );
  }

  const v = data as unknown as Voucher;
  const code = `RES-${v.id.slice(0, 8).toUpperCase()}`;
  const dep = v.departures;

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href="/reservas" className="inline-flex items-center gap-1.5 text-sm text-slate-500">
          <ArrowLeft size={16} /> Voltar
        </Link>
        <VoucherPrintButton auto={searchParams.print === "1"} />
      </div>

      <div className="overflow-hidden rounded-card border border-slate-200 bg-white print:border-0">
        {/* Cabecalho */}
        <div className="flex items-center justify-between border-b border-slate-200 px-8 py-5">
          <div className="flex items-center gap-2.5">
            <img src="/nauticflow-icon.png" alt="NauticFlow" className="h-7 w-auto" />
            <span className="font-display text-lg font-semibold tracking-tight">
              <span className="text-navy">Nautic</span>
              <span className="text-brand">Flow</span>
            </span>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-navy">{v.companies?.name}</p>
            <p className="text-xs text-slate-500">Voucher de reserva</p>
          </div>
        </div>

        {/* Codigo e status */}
        <div className="flex items-center justify-between bg-navy px-8 py-4 text-white print:bg-navy">
          <div>
            <p className="text-xs text-slate-300">Código da reserva</p>
            <p className="font-display text-xl font-semibold tracking-wider">{code}</p>
          </div>
          <span
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              v.status === "confirmada" ? "bg-ok text-white" : "bg-slate-500 text-white"
            }`}
          >
            {v.status === "confirmada" ? "Confirmada" : v.status}
          </span>
        </div>

        {/* Dados do passeio */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 px-8 py-6">
          <Field label="Passeio" value={dep?.tours?.name ?? "-"} />
          <Field label="Embarcação" value={dep?.vessels?.name ?? "-"} />
          <Field label="Data" value={dep ? fmtDate(dep.departs_at) : "-"} />
          <Field label="Horário" value={dep ? fmtTime(dep.departs_at) : "-"} />
          <Field label="Passageiros" value={String(v.people_count)} />
          <Field label="Valor" value={v.total_cents > 0 ? brl(v.total_cents) : "-"} />
        </div>

        <div className="border-t border-slate-100 px-8 py-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Cliente</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <Field label="Nome" value={v.clients?.name ?? "-"} />
            <Field label="Telefone" value={v.clients?.phone ?? "-"} />
            {v.clients?.email && <Field label="E-mail" value={v.clients.email} />}
            {v.origin_name && <Field label="Origem" value={v.origin_name} />}
          </div>
          {v.notes && (
            <div className="mt-4">
              <p className="text-xs text-slate-500">Observações</p>
              <p className="text-sm text-navy">{v.notes}</p>
            </div>
          )}
        </div>

        <div className="mx-8 mb-6 rounded-lg bg-blue-50 px-4 py-3 text-center text-sm font-medium text-brand-dark">
          Apresente este voucher no embarque.
        </div>

        <div className="border-t border-slate-100 px-8 py-4 text-center text-[11px] text-slate-400">
          Emitido em {fmtDate(v.created_at)} {fmtTime(v.created_at)}. Voucher gerado automaticamente pelo NauticFlow.
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-medium text-navy">{value}</p>
    </div>
  );
}
