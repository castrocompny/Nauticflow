import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Pager } from "@/components/ui";
import { NewClientForm } from "./new-client-form";
import { ClientRow } from "./client-row";
import type { Client } from "@/lib/types";

const PAGE_SIZE = 25;

export default async function ClientsPage({ searchParams }: { searchParams: { page?: string } }) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createClient();
  const { data, count } = await supabase
    .from("clients")
    .select("*", { count: "exact" })
    .order("name")
    .range(from, to);
  const clients = (data ?? []) as Client[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Clientes" subtitle={count ? `${count} cliente(s) cadastrado(s)` : undefined} />
      <NewClientForm />
      {clients.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            {page > 1 ? "Nenhum cliente nesta página." : "Nenhum cliente cadastrado ainda."}
          </div>
        </Card>
      ) : (
        <>
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
          <Pager page={page} totalPages={totalPages} basePath="/clientes" />
        </>
      )}
    </>
  );
}
