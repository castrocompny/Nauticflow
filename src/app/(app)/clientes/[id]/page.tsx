import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, EmptyState } from "@/components/ui";
import { brl, fmtDate, fmtTime } from "@/lib/format";
import type { Client } from "@/lib/types";

type ResRow = {
  id: string;
  people_count: number;
  total_cents: number;
  status: string;
  created_at: string;
  departures: { departs_at: string; vessels: { name: string } | null } | null;
};

export default async function ClientDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: client }, { data: res }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("reservations")
      .select("id, people_count, total_cents, status, created_at, departures(departs_at, vessels(name))")
      .eq("client_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  if (!client) notFound();
  const c = client as Client;
  const reservations = (res ?? []) as unknown as ResRow[];

  const statusTone: Record<string, "green" | "amber" | "slate"> = {
    confirmada: "green",
    pendente: "amber",
    cancelada: "slate",
  };

  return (
    <>
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy">
        <ArrowLeft size={16} /> Clientes
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-navy">{c.name}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {c.cpf ?? "sem CPF"} · {c.phone ?? "sem telefone"} · {c.city ?? "sem cidade"}
        </p>
      </div>

      <h2 className="mb-3 font-display text-base font-semibold text-navy">Histórico de reservas</h2>

      {reservations.length === 0 ? (
        <EmptyState title="Nenhuma reserva deste cliente ainda" />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Saída</th>
                <th className="px-4 py-3 text-center">Pessoas</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-500">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.departures?.vessels?.name}
                    {r.departures && ` · ${fmtDate(r.departures.departs_at)} ${fmtTime(r.departures.departs_at)}`}
                  </td>
                  <td className="px-4 py-3 text-center">{r.people_count}</td>
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
