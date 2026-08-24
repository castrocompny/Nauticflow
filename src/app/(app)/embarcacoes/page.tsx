import { ScrollShadowX } from "@/components/scroll-shadow-x";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { NewVesselForm } from "./new-vessel-form";
import { VesselRow } from "./vessel-row";
import type { Vessel } from "@/lib/types";

export default async function VesselsPage() {
  const supabase = createClient();
  const { data } = await supabase.from("vessels").select("*").order("name");
  const vessels = (data ?? []) as Vessel[];

  return (
    <>
      <RealtimeRefresh tables={["vessels"]} />
      <PageHeader title="Embarcações" action={<NewVesselForm />} />
      {vessels.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-muted">
            Nenhuma embarcação cadastrada. Cadastre a primeira para poder criar saídas.
          </div>
        </Card>
      ) : (
        <Card className="p-0">
          <ScrollShadowX>
              <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3 text-center">Oficial</th>
                <th className="px-4 py-3 text-center">Comercial</th>
                <th className="px-4 py-3 text-right">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => (
                <VesselRow key={v.id} v={v} />
              ))}
            </tbody>
          </table>
          </ScrollShadowX>
        </Card>
      )}
    </>
  );
}
