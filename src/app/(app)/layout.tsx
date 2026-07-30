import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { startEndOfToday } from "@/lib/format";
import type { Notif } from "@/components/notifications-bell";

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
  const role = roleLabel[p?.role] ?? "Usuário";

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { start: todayStart, end: todayEnd } = startEndOfToday();

  const [subRes, vesselsCount, reservasMes, todayDeps, novasRes] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("plans(name, max_vessels)")
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
    <div className="flex min-h-screen">
      <Sidebar
        company={companyName}
        city={companyCity}
        planName={planName}
        reservasUso={reservasMes.count ?? 0}
        vesselsUso={vesselsCount.count ?? 0}
        vesselsLimite={vesselsLimite}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={firstName} role={role} notifications={notifications} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
