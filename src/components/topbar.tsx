import { signOut } from "@/app/login/actions";
import { NotificationsBell, type Notif } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";

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
    <header className="flex items-center justify-end gap-4 border-b border-line bg-surface px-6 py-3">
      <p className="hidden text-xs capitalize text-muted sm:block">{today}</p>
      <ThemeToggle />
      <NotificationsBell items={notifications} />
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-navy text-sm font-semibold text-white">
          {initial}
        </span>
        <div className="hidden leading-tight sm:block">
          <p className="text-sm font-medium text-heading">{name}</p>
          <p className="text-xs text-muted">{role}</p>
        </div>
      </div>
      <form action={signOut}>
        <button className="rounded-lg border border-line px-3 py-2 text-sm text-body transition hover:bg-surfaceHover">
          Sair
        </button>
      </form>
    </header>
  );
}
