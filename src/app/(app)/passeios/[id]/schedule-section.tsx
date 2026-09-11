"use client";

import { useState } from "react";
import { QuickScheduleSetup } from "./quick-schedule-setup";
import { ScheduleManager } from "./schedule-manager";
import type { TourScheduleRule, Vessel } from "@/lib/types";

// Decide entre o passo único de configuração inicial (sem regra ainda) e a
// tela completa de edição (regra já existe, ou o operador pediu pra pular o
// passo simplificado). Nenhuma lógica de agenda mora aqui -- só a escolha de
// QUAL formulário mostrar; ScheduleManager continua sendo a única fonte de
// edição recorrente/datas específicas/pause/reactivate.
export function ScheduleSection({
  tourId,
  vessels,
  rule,
  upcomingCount,
  tourBasePriceCents,
}: {
  tourId: string;
  vessels: Vessel[];
  rule: TourScheduleRule | null;
  upcomingCount: number;
  tourBasePriceCents: number;
}) {
  const [skipped, setSkipped] = useState(false);

  if (!rule && !skipped) {
    return (
      <QuickScheduleSetup
        tourId={tourId}
        vessels={vessels}
        tourBasePriceCents={tourBasePriceCents}
        onSkip={() => setSkipped(true)}
      />
    );
  }

  return <ScheduleManager tourId={tourId} vessels={vessels} rule={rule} upcomingCount={upcomingCount} />;
}
