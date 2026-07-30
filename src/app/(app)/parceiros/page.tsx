import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { NewPartnerForm } from "./new-partner-form";
import { PartnerRow } from "./partner-row";

type Partner = {
  id: string;
  name: string;
  type: string;
  contact: string | null;
  commission_rate: number;
  active: boolean;
};

export default async function ParceirosPage() {
  const supabase = createClient();
  const { data } = await supabase.from("partners").select("*").order("name");
  const partners = (data ?? []) as Partner[];

  return (
    <>
      <PageHeader title="Parceiros" subtitle="Hotéis, pousadas e agências que enviam clientes." />
      <NewPartnerForm />

      {partners.length === 0 ? (
        <EmptyState title="Nenhum parceiro cadastrado" hint="Cadastre hotéis, pousadas e agências para acompanhar a origem das reservas." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3 text-center">Comissão</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <PartnerRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
