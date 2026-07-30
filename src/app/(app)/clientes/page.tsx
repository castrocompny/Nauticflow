import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { NewClientForm } from "./new-client-form";
import { ClientRow } from "./client-row";
import type { Client } from "@/lib/types";

export default async function ClientsPage() {
  const supabase = createClient();
  const { data } = await supabase.from("clients").select("*").order("name");
  const clients = (data ?? []) as Client[];

  return (
    <>
      <PageHeader title="Clientes" />
      <NewClientForm />
      {clients.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            Nenhum cliente cadastrado ainda.
          </div>
        </Card>
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">CPF</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <ClientRow key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
