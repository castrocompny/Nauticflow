import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { brl, fmtDate, fmtTime } from "@/lib/format";
import { PrintButton } from "./print-button";

type Passenger = { name: string; document: string | null; nationality: string | null; status: string };
type Res = {
  id: string;
  people_count: number;
  total_cents: number;
  status: string;
  origin_name: string | null;
  notes: string | null;
  clients: { name: string; phone: string | null; email: string | null } | null;
  passengers: Passenger[];
};
type Dep = {
  id: string;
  departs_at: string;
  capacity: number;
  companies: { name: string } | null;
  vessels: { name: string; official_capacity: number; default_crew: number } | null;
  tours: { name: string } | null;
  reservations: Res[];
};

const statusLabel: Record<string, string> = {
  confirmado: "Confirmado",
  embarcado: "Embarcado",
  ausente: "Ausente",
};

export default async function ManifestPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data } = await supabase
    .from("departures")
    .select(
      "id, departs_at, capacity, companies(name), vessels(name, official_capacity, default_crew), tours(name), reservations(id, people_count, total_cents, status, origin_name, notes, clients(name, phone, email), passengers(name, document, nationality, status))"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Link href="/saidas" className="inline-flex items-center gap-1.5 text-sm text-muted">
          <ArrowLeft size={16} /> Voltar
        </Link>
        <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Saída não encontrada ou sem acesso.
        </p>
      </div>
    );
  }

  const d = data as unknown as Dep;
  const reservas = (d.reservations ?? []).filter((r) => r.status === "confirmada");
  const totalConfirmados = reservas.reduce((s, r) => s + r.people_count, 0);
  const vagas = Math.max(d.capacity - totalConfirmados, 0);

  return (
    <div className="mx-auto max-w-4xl p-8 print:p-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href={`/saidas/${d.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted">
          <ArrowLeft size={16} /> Voltar à saída
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-card border border-line bg-surface p-8 print:border-0 print:p-0">
        {/* Cabecalho */}
        <div className="mb-6 flex items-start justify-between border-b border-line pb-4">
          <div>
            <p className="font-display text-lg font-semibold text-brand">NauticFlow</p>
            <h1 className="font-display text-2xl font-semibold text-heading">Manifesto de passageiros</h1>
            <p className="text-sm text-muted">{d.companies?.name}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium text-heading">{d.vessels?.name}</p>
            <p className="text-muted">
              {fmtDate(d.departs_at)} · {fmtTime(d.departs_at)}
            </p>
          </div>
        </div>

        {/* Dados da saida */}
        <div className="mb-6 grid grid-cols-2 gap-x-10 gap-y-2 text-sm md:grid-cols-3">
          <Field label="Passeio" value={d.tours?.name ?? "-"} />
          <Field label="Embarcação" value={d.vessels?.name ?? "-"} />
          <Field label="Lotação oficial" value={String(d.vessels?.official_capacity ?? "-")} />
          <Field label="Capacidade desta saída" value={String(d.capacity)} />
          <Field label="Passageiros confirmados" value={String(totalConfirmados)} />
          <Field label="Vagas disponíveis" value={String(vagas)} />
        </div>

        {/* Reservas / passageiros */}
        {reservas.length === 0 ? (
          <div className="rounded-lg bg-surfaceHover py-10 text-center text-sm text-muted">
            Nenhum passageiro confirmado para esta saída.
          </div>
        ) : (
          <div className="space-y-4">
            {reservas.map((r, idx) => (
              <div key={r.id} className="rounded-lg border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surfaceHover px-4 py-2.5 print:bg-surface">
                  <div>
                    <p className="text-sm font-semibold text-heading">
                      {idx + 1}. {r.clients?.name ?? "Cliente"}
                    </p>
                    <p className="text-xs text-muted">
                      {r.clients?.phone ?? "sem telefone"}
                      {r.clients?.email ? ` · ${r.clients.email}` : ""}
                      {r.origin_name ? ` · origem: ${r.origin_name}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-xs text-body">
                    <p>
                      <strong>{r.people_count}</strong> passageiro(s)
                    </p>
                    {r.total_cents > 0 && <p>{brl(r.total_cents)}</p>}
                  </div>
                </div>

                {r.passengers.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="px-4 py-1.5">Passageiro</th>
                        <th className="px-4 py-1.5">Documento</th>
                        <th className="px-4 py-1.5">Nac.</th>
                        <th className="px-4 py-1.5 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.passengers.map((p, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-4 py-1.5 text-heading">{p.name}</td>
                          <td className="px-4 py-1.5 text-body">{p.document ?? "-"}</td>
                          <td className="px-4 py-1.5 text-body">{p.nationality ?? "-"}</td>
                          <td className="px-4 py-1.5 text-right text-body">{statusLabel[p.status] ?? p.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-2 text-xs text-muted">
                    Passageiros individuais não cadastrados. {r.people_count} pessoa(s) sob responsabilidade do cliente.
                  </p>
                )}

                {r.notes && <p className="border-t border-line px-4 py-2 text-xs text-muted">Obs.: {r.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Assinatura / conferencia */}
        <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
          <div>
            <div className="border-t border-slate-400 pt-1 text-center text-muted">Conferido por</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-1 text-center text-muted">Comandante</div>
          </div>
        </div>

        <p className="mt-8 text-center text-[11px] text-muted">
          Manifesto gerado automaticamente pelo NauticFlow em {fmtDate(new Date().toISOString())}{" "}
          {fmtTime(new Date().toISOString())}.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line py-1">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-heading">{value}</span>
    </div>
  );
}
