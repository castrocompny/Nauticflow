import { signOut } from "@/app/login/actions";
import { NotificationsBell, type Notif } from "@/components/notifications-bell";

export function Topbar({
  name,
  role,
  notifications,
}: {
  name: string;
  role: string;
  notifications: Notif[];
}) {
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <header className="flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 py-3">
      <p className="hidden text-xs capitalize text-slate-500 sm:block">{today}</p>
      <NotificationsBell items={notifications} />
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-navy text-sm font-semibold text-white">
          {initial}
        </span>
        <div className="hidden leading-tight sm:block">
          <p className="text-sm font-medium text-navy">{name}</p>
          <p className="text-xs text-slate-500">{role}</p>
        </div>
      </div>
      <form action={signOut}>
        <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50">
          Sair
        </button>
      </form>
    </header>
  );
}
