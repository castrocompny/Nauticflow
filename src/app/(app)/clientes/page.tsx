import { ScrollShadowX } from "@/components/scroll-shadow-x";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Pager } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { NewClientForm } from "./new-client-form";
import { ClientRow } from "./client-row";
import type { Client } from "@/lib/types";

const PAGE_SIZE = 25;

export default async function ClientsPage(props: { searchParams: Promise<{ page?: string }> }) {
  const searchParams = await props.searchParams;
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
      <RealtimeRefresh tables={["clients"]} />
      <PageHeader title="Clientes" subtitle={count ? `${count} cliente(s) cadastrado(s)` : undefined} />
      <NewClientForm />
      {clients.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-muted">
            {page > 1 ? "Nenhum cliente nesta página." : "Nenhum cliente cadastrado ainda."}
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-0">
            <ScrollShadowX>
              <table className="w-full text-sm">
                <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
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
            </ScrollShadowX>
          </Card>
          <Pager page={page} totalPages={totalPages} basePath="/clientes" />
        </>
      )}
    </>
  );
}
