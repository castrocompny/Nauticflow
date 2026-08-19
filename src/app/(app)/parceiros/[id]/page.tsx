import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, EmptyState } from "@/components/ui";
import { brl, fmtDate, fmtTime } from "@/lib/format";

type Partner = {
  id: string;
  name: string;
  type: string;
  contact: string | null;
  commission_rate: number;
  active: boolean;
};

type ResRow = {
  id: string;
  people_count: number;
  total_cents: number;
  status: string;
  created_at: string;
  clients: { name: string } | null;
  departures: { departs_at: string; vessels: { name: string } | null } | null;
};

const typeLabel: Record<string, string> = {
  hotel: "Hotel",
  pousada: "Pousada",
  agencia: "Agência",
  outro: "Outro",
};

const statusTone: Record<string, "green" | "amber" | "slate"> = {
  confirmada: "green",
  pendente: "amber",
  cancelada: "slate",
};

export default async function PartnerDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const [{ data: partner }, { data: res }] = await Promise.all([
    supabase.from("partners").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("reservations")
      .select("id, people_count, total_cents, status, created_at, clients(name), departures(departs_at, vessels(name))")
      .eq("partner_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  if (!partner) notFound();
  const p = partner as Partner;
  const reservations = (res ?? []) as unknown as ResRow[];

  return (
    <>
      <Link href="/parceiros" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-heading">
        <ArrowLeft size={16} /> Parceiros
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-heading">{p.name}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {typeLabel[p.type] ?? p.type} · {p.contact ?? "sem contato"} · comissão {Number(p.commission_rate)}%
          </p>
        </div>
        <Badge tone={p.active ? "green" : "slate"}>{p.active ? "ativo" : "inativo"}</Badge>
      </div>

      <h2 className="mb-3 font-display text-base font-semibold text-heading">Histórico de reservas</h2>

      {reservations.length === 0 ? (
        <EmptyState title="Nenhuma reserva vinculada a este parceiro ainda" />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Saída</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-muted">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-heading">{r.clients?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-body">
                    {r.departures?.vessels?.name}
                    {r.departures && ` · ${fmtDate(r.departures.departs_at)} ${fmtTime(r.departures.departs_at)}`}
                  </td>
                  <td className="px-4 py-3 text-right">{brl(r.total_cents)}</td>
                  <td className="px-4 py-3 text-right">
                    <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
