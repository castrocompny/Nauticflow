import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { startEndOfToday } from "@/lib/format";
import { OverdueBanner } from "./overdue-banner";
import type { Notif } from "@/components/notifications-bell";

// forca toda a area logada a buscar dado fresco do banco a cada requisicao — sem isso,
// o Next.js pode reaproveitar uma resposta antiga em cache (ex: plano/assinatura logo
// depois de uma renovacao feita em outra tela) e mostrar informacao desatualizada.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const roleLabel: Record<string, string> = {
  company_admin: "Administrador",
  staff: "Operador",
  super_admin: "Super admin",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, role, company_id, companies(name, city)")
    .eq("id", user.id)
    .single();

  const p = profile as any;
  const companyName = p?.companies?.name ?? "Minha empresa";
  const companyCity = p?.companies?.city ?? null;
  const firstName = (p?.name ?? "").split(" ")[0] || "operador";
  const rawRole = p?.role as string | undefined;
  const role = roleLabel[rawRole ?? ""] ?? "Usuário";

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { start: todayStart, end: todayEnd } = startEndOfToday();

  const [subRes, vesselsCount, reservasMes, todayDeps, novasRes] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("status, paid_until, plans(name, max_vessels)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("vessels").select("id", { count: "exact", head: true }),
    supabase.from("reservations").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    supabase
      .from("departures")
      .select("capacity, reservations(people_count, status)")
      .gte("departs_at", todayStart)
      .lt("departs_at", todayEnd),
    supabase.from("reservations").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
  ]);

  const planName = (subRes.data as any)?.plans?.name ?? "Sem plano";
  const vesselsLimite = (subRes.data as any)?.plans?.max_vessels ?? null;
  const paidUntil = (subRes.data as any)?.paid_until as string | null;
  const isOverdue = rawRole !== "super_admin" && paidUntil != null && new Date(paidUntil) < new Date();

  const deps = (todayDeps.data ?? []) as any[];
  const lotadas = deps.filter((d) => {
    const b = (d.reservations ?? [])
      .filter((x: any) => x.status === "confirmada")
      .reduce((s: number, x: any) => s + x.people_count, 0);
    return b >= d.capacity && d.capacity > 0;
  }).length;

  const notifications: Notif[] = [];
  if ((novasRes.count ?? 0) > 0)
    notifications.push({ id: "novas-reservas", title: `${novasRes.count} novas reservas`, desc: "nas últimas 24 horas" });
  if (deps.length > 0)
    notifications.push({ id: "saidas-hoje", title: `${deps.length} saídas hoje`, desc: "confira a agenda do dia" });
  if (lotadas > 0)
    notifications.push({ id: "saidas-lotadas", title: `${lotadas} saídas lotadas hoje`, desc: "capacidade máxima atingida" });

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        company={companyName}
        city={companyCity}
        planName={planName}
        reservasUso={reservasMes.count ?? 0}
        vesselsUso={vesselsCount.count ?? 0}
        vesselsLimite={vesselsLimite}
        paidUntil={paidUntil}
        overdue={isOverdue}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar name={firstName} role={role} notifications={notifications} />
        {isOverdue && <OverdueBanner companyName={companyName} />}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
