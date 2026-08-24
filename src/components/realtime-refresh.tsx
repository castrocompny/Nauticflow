"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Assina mudanca (insert/update/delete) nas tabelas passadas e recarrega os dados da
// pagina atual (router.refresh(), reconsulta as Server Components sem perder estado
// de UI) quando algo muda -- pra um colaborador ver na hora o que outro colaborador
// da mesma empresa acabou de criar/editar/apagar, sem precisar sair e voltar da aba.
//
// Sem filtro de company_id de proposito: o Realtime do Supabase ja so entrega o
// evento pra quem a RLS de SELECT da tabela deixaria ver aquela linha (mesma policy
// da API normal) -- entao continua isolado por empresa sem configuracao extra.
export function RealtimeRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tablesKey = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // o Realtime só entrega o evento pra quem a RLS deixaria ver a linha, e pra isso
    // ele precisa do access_token do usuário (não só a apikey anônima). O client
    // sincroniza isso sozinho com atraso via onAuthStateChange -- se o canal já
    // tiver assinado antes disso, ele fica "autenticado" só como anon e a RLS
    // (for select to authenticated) barra tudo silenciosamente. Por isso busca a
    // sessão e chama setAuth ANTES de criar o canal.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      const c = supabase.channel(`realtime-refresh-${tablesKey}`);
      channel = c;
      for (const table of tablesKey.split(",")) {
        c.on("postgres_changes", { event: "*", schema: "public", table }, () => {
          // debounce: varias mudancas quase juntas (ex: reserva + passageiros) viram
          // um refresh so, em vez de recarregar a cada evento
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 400);
        });
      }
      c.subscribe();
    });

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [tablesKey, router]);

  return null;
}
