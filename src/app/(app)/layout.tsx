import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { AppShell } from "@/components/app-shell";
import { startEndOfToday } from "@/lib/format";
import { OverdueBanner } from "./overdue-banner";
import type { Notif } from "@/components/notifications-bell";

// Este layout usa cookies() (via createClient/getProfile), o que já obriga o Next.js a
// renderizar por requisição -- não precisa de "force-dynamic" pra isso. O que "force-dynamic"
// + "revalidate = 0" faziam de verdade era desligar o cache de navegação do lado do cliente,
// forçando TODO clique no menu lateral a refazer a checagem de auth + as 5 queries do layout
// no servidor, mesmo clicando entre páginas já visitadas há poucos segundos -- essa era a
// causa principal do atraso ao clicar no menu.
//
// Sem essas duas linhas, o Next.js volta a cachear a navegação por ~30s (padrão do App
// Router), então clicar de novo numa página recente é instantâneo. O motivo original pra
// essas linhas existirem era evitar mostrar plano/assinatura desatualizados logo após uma
// renovação -- isso agora é resolvido de forma cirúrgica: `revalidatePath` é chamado direto
// nos dois lugares que alteram a assinatura (webhook do Asaas e renovação manual no /admin),
// então o dado fica fresco assim que muda, sem precisar desligar o cache pra todo mundo o
// tempo todo.

const roleLabel: Record<string, string> = {
  company_admin: "Administrador",
  staff: "Operador",
  super_admin: "Super admin",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const companyName = profile.companies?.name ?? "Minha empresa";
  const companyCity = profile.companies?.city ?? null;
  const firstName = (profile.name ?? "").split(" ")[0] || "operador";
  const rawRole = profile.role as string | undefined;
  const role = roleLabel[rawRole ?? ""] ?? "Usuário";

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { start: todayStart, end: todayEnd } = startEndOfToday();

  const [subRes, todayDeps, novasRes, companyStatusRes] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("status, paid_until, plans(name, max_vessels)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("departures")
      .select("capacity, reservations(people_count, status)")
      .gte("departs_at", todayStart)
      .lt("departs_at", todayEnd),
    supabase.from("reservations").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
    supabase.from("companies").select("suspended_at, suspended_reason").eq("id", profile.company_id).maybeSingle(),
  ]);

  const planName = (subRes.data as any)?.plans?.name ?? "Sem plano";
  const paidUntil = (subRes.data as any)?.paid_until as string | null;
  const suspendedAt = companyStatusRes.data?.suspended_at as string | null;
  const suspendedReason = companyStatusRes.data?.suspended_reason as string | null;
  const isSuspended = rawRole !== "super_admin" && !!suspendedAt;
  const isOverdue = !isSuspended && rawRole !== "super_admin" && paidUntil != null && new Date(paidUntil) < new Date();

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
    <AppShell
      sidebar={{
        company: companyName,
        city: companyCity,
        planName,
        overdue: isOverdue || isSuspended,
        isSuperAdmin: rawRole === "super_admin",
        isStaff: rawRole === "staff",
      }}
      topbar={{ name: firstName, role, notifications }}
      banner={
        (isOverdue || isSuspended) && (
          <OverdueBanner companyName={companyName} suspended={isSuspended} suspendedReason={suspendedReason} />
        )
      }
    >
      {children}
    </AppShell>
  );
}
