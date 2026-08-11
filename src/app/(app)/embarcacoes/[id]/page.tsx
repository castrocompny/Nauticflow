import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, OccupancyBar, EmptyState } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";
import type { Vessel } from "@/lib/types";

const typeLabel: Record<string, string> = {
  escuna: "Escuna",
  lancha: "Lancha",
  jet_ski: "Jet ski",
  catamara: "Catamarã",
  outro: "Outro",
};

type DepRow = {
  id: string;
  departs_at: string;
  capacity: number;
  status: string;
  tours: { name: string } | null;
  reservations: { people_count: number; status: string }[];
};

export default async function VesselDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: vessel }, { data: deps }] = await Promise.all([
    supabase.from("vessels").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("departures")
      .select("id, departs_at, capacity, status, tours(name), reservations(people_count, status)")
      .eq("vessel_id", params.id)
      .order("departs_at", { ascending: false }),
  ]);

  if (!vessel) notFound();
  const v = vessel as Vessel;
  const rows = (deps ?? []) as unknown as DepRow[];
  const booked = (r: DepRow) =>
    r.reservations.filter((x) => x.status === "confirmada").reduce((s, x) => s + x.people_count, 0);

  return (
    <>
      <Link href="/embarcacoes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-heading">
        <ArrowLeft size={16} /> Embarcações
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-xl font-semibold text-heading">{v.name}</h1>
        <p className="mt-0.5 text-sm text-muted">
          {typeLabel[v.type]} · capacidade oficial {v.official_capacity} · capacidade comercial {v.commercial_capacity}
        </p>
      </div>

      <h2 className="mb-3 font-display text-base font-semibold text-heading">Histórico de saídas</h2>

      {rows.length === 0 ? (
        <EmptyState title="Nenhuma saída registrada para esta embarcação" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const b = booked(r);
            return (
              <Card key={r.id} className="flex items-center gap-4">
                <div className="w-24">
                  <p className="font-display font-semibold text-heading">{fmtTime(r.departs_at)}</p>
                  <p className="text-xs text-muted">{fmtDate(r.departs_at)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.tours?.name}</p>
                  <div className="mt-1.5">
                    <OccupancyBar booked={b} capacity={r.capacity} />
                  </div>
                </div>
                <Badge tone={r.status === "cancelada" ? "slate" : r.status === "encerrada" ? "green" : "amber"}>
                  {r.status}
                </Badge>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
