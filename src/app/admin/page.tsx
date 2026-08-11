import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { RenewButton } from "./renew-button";

type Company = {
  id: string;
  name: string;
  cnpj: string | null;
  city: string | null;
  created_at: string;
  subscriptions: { status: string; paid_until: string | null; created_at: string; plans: { name: string } | null }[];
};

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") {
    return (
      <div className="grid min-h-screen place-items-center bg-app p-6">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-danger">
            <ShieldAlert size={24} />
          </div>
          <h1 className="font-display text-lg font-semibold text-heading">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted">Esta área é só para administração do NauticFlow.</p>
        </div>
      </div>
    );
  }

  const [{ data }, { data: plansData }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, cnpj, city, created_at, subscriptions(status, paid_until, created_at, plans(name))")
      .order("created_at", { ascending: false }),
    supabase.from("plans").select("code, name, price_cents").order("price_cents"),
  ]);

  const companies = (data ?? []) as unknown as Company[];
  const plans = (plansData ?? []) as { code: string; name: string; price_cents: number }[];

  const now = new Date();

  return (
    <div className="min-h-screen bg-app p-6">
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Administração NauticFlow" subtitle="Empresas cadastradas e status de pagamento." />

        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3">Plano</th>
                <th className="px-4 py-3">Cadastro</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const sub = [...(c.subscriptions ?? [])].sort(
                  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                )[0];
                const paidUntil = sub?.paid_until ? new Date(sub.paid_until) : null;
                const overdue = paidUntil ? paidUntil < now : false;
                return (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium text-heading">
                      {c.name}
                      <div className="text-xs font-normal text-muted">{c.cnpj || "CNPJ não informado"}</div>
                    </td>
                    <td className="px-4 py-3 text-body">{c.city ?? "-"}</td>
                    <td className="px-4 py-3 text-body">{sub?.plans?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-muted">{fmtDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      {!paidUntil ? (
                        <Badge tone="slate">sem assinatura</Badge>
                      ) : overdue ? (
                        <Badge tone="red">vencida desde {fmtDate(paidUntil.toISOString())}</Badge>
                      ) : (
                        <Badge tone="green">paga até {fmtDate(paidUntil.toISOString())}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RenewButton companyId={c.id} plans={plans} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
