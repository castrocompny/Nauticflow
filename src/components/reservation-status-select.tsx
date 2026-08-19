"use client";

import { useState, useTransition } from "react";

type Status = "confirmada" | "pendente";
type Result = { ok: boolean; message: string };

export function ReservationStatusSelect({
  id,
  status,
  action,
}: {
  id: string;
  status: string;
  action: (id: string, status: Status) => Promise<Result>;
}) {
  const [current, setCurrent] = useState<string>(status);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onChange(next: Status) {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const r = await action(id, next);
      if (!r.ok) {
        setCurrent(previous);
        setMsg({ ok: false, text: r.message });
        setTimeout(() => setMsg(null), 4000);
      }
    });
  }

  if (current !== "confirmada" && current !== "pendente") {
    return <span className="text-xs text-muted">{current}</span>;
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as Status)}
        className={`rounded-md border-0 px-2.5 py-1 text-xs font-medium ${
          current === "confirmada" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
        } disabled:opacity-60`}
      >
        <option value="confirmada" className="bg-surface text-heading">
          confirmada
        </option>
        <option value="pendente" className="bg-surface text-heading">
          pendente
        </option>
      </select>
      {msg && <span className="text-[11px] text-danger">{msg.text}</span>}
    </div>
  );
}
