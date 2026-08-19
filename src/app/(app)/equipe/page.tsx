import { ScrollShadowX } from "@/components/scroll-shadow-x";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { Card, PageHeader, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { InviteForm } from "./invite-form";
import { RemoveButton } from "./remove-button";

const roleLabel: Record<string, string> = {
  company_admin: "Administrador",
  staff: "Operador",
  super_admin: "Super admin",
};

type Member = { id: string; name: string | null; email: string | null; role: string; created_at: string };

export default async function EquipePage() {
  const profile = await getProfile();
  const supabase = createClient();

  const [{ data: membersData }, { data: sub }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, name, email, role, created_at")
      .eq("company_id", profile?.company_id ?? "")
      .order("created_at"),
    supabase
      .from("subscriptions")
      .select("plans(max_users)")
      .eq("company_id", profile?.company_id ?? "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const members = (membersData ?? []) as Member[];
  const maxUsers = (sub as any)?.plans?.max_users as number | null | undefined;
  const canInvite = profile?.role === "company_admin" || profile?.role === "super_admin";

  return (
    <>
      <PageHeader
        title="Equipe"
        subtitle={`Quem tem acesso a esta empresa. ${maxUsers != null ? `${members.length} / ${maxUsers} usuário(s) do plano.` : `${members.length} usuário(s), plano com usuários ilimitados.`}`}
      />

      {canInvite && <InviteForm />}

      <Card className="p-0">
        <ScrollShadowX>
              <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Cargo</th>
              <th className="px-4 py-3">Desde</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const removable =
                canInvite && m.id !== profile?.id && m.role !== "company_admin" && m.role !== "super_admin";
              return (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium text-heading">{m.name ?? "-"}</td>
                  <td className="px-4 py-3 text-body">{m.email ?? "-"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={m.role === "company_admin" ? "green" : "slate"}>
                      {roleLabel[m.role] ?? m.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{fmtDate(m.created_at)}</td>
                  <td className="px-4 py-3">{removable && <RemoveButton memberId={m.id} memberName={m.name ?? "este usuário"} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </ScrollShadowX>
      </Card>
    </>
  );
}
