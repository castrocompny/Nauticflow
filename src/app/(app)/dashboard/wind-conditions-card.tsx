import Link from "next/link";
import { Wind, Navigation, MapPin, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { getWindConditions } from "@/lib/weather/provider";
import type { WindConditions } from "@/lib/weather/types";
import { Card } from "@/components/ui";

// "12h"/"13h"... -- o Open-Meteo já devolve o horário em America/Sao_Paulo
// (timezone pedido na query), então isto é só recorte de string, nunca uma
// conversão de fuso nova (evita repetir o mesmo tipo de bug já corrigido na
// automação de agenda, migrations 0065/0066 -- nunca reinterpretar um
// horário que já está correto).
function hourLabel(isoLocal: string): string {
  return `${isoLocal.slice(11, 13)}h`;
}

function timeLabel(isoLocal: string): string {
  return isoLocal.slice(11, 16);
}

type CardState =
  | { kind: "no-location" }
  | { kind: "error" }
  | { kind: "ok"; conditions: WindConditions; locationName: string | null };

// Toda a busca de dados (profile, empresa, provider de clima) fica isolada
// nesta função, fora de qualquer JSX -- o componente abaixo só decide o que
// renderizar a partir do resultado. Mistura de JSX dentro de try/catch é
// proibida pelo lint (react-hooks/error-boundaries: React não renderiza JSX
// de forma síncrona, então o catch nunca pegaria um erro de render mesmo).
async function loadState(): Promise<CardState | null> {
  try {
    const profile = await getProfile();
    if (!profile?.company_id) return null; // Dashboard já trata sessão inválida em outro lugar

    const supabase = createClient();
    const { data: company } = await supabase
      .from("companies")
      .select("weather_latitude, weather_longitude, weather_location_name")
      .eq("id", profile.company_id)
      .maybeSingle();

    const latitude = company?.weather_latitude;
    const longitude = company?.weather_longitude;

    if (latitude == null || longitude == null) {
      return { kind: "no-location" };
    }

    try {
      const conditions = await getWindConditions({ latitude, longitude });
      return { kind: "ok", conditions, locationName: company?.weather_location_name ?? null };
    } catch (error) {
      // Log server-side com contexto suficiente pra diagnóstico, sem
      // nenhum segredo (WEATHER_API_KEY nunca aparece aqui -- o erro do
      // provider, quando existe .cause, é logado à parte, não interpolado
      // em texto que poderia conter a URL com a chave).
      console.error("WindConditionsCard: falha ao consultar o provedor de clima", error);
      return { kind: "error" };
    }
  } catch (error) {
    // Rede de segurança final -- mesmo uma falha inesperada na consulta ao
    // profile/empresa (não relacionada ao provider de clima em si) nunca
    // pode derrubar o Dashboard.
    console.error("WindConditionsCard: falha inesperada", error);
    return { kind: "error" };
  }
}

// Card 100% best-effort: qualquer falha (empresa sem localização, provider
// fora do ar, resposta inesperada) termina num retângulo discreto, NUNCA
// numa exceção que derrubaria o Dashboard inteiro.
export async function WindConditionsCard() {
  const state = await loadState();
  if (!state) return null;

  if (state.kind === "no-location") {
    return (
      <Card className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <Wind size={18} className="text-muted" />
          <h3 className="font-display text-base font-semibold text-heading">Condições do vento</h3>
        </div>
        <p className="mb-3 text-sm text-muted">
          Configure a localização de operação para visualizar as condições do vento.
        </p>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <MapPin size={14} /> Configurar localização
        </Link>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card className="mb-5">
        <div className="mb-1 flex items-center gap-2">
          <Wind size={18} className="text-muted" />
          <h3 className="font-display text-base font-semibold text-heading">Condições do vento</h3>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <AlertCircle size={14} /> Condições do vento indisponíveis no momento.
        </p>
      </Card>
    );
  }

  const { current, hourly } = state.conditions;

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Wind size={18} className="text-brand" />
            <h3 className="font-display text-base font-semibold text-heading">Condições do vento</h3>
          </div>
          {state.locationName && <p className="mt-0.5 text-xs text-muted">{state.locationName}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-3xl font-semibold text-heading">{current.windSpeedKmh} km/h</p>
          <p className="text-xs text-muted">Vento atual</p>
        </div>
        <div className="space-y-1 text-sm text-body">
          {current.windGustKmh != null && (
            <p>
              Rajadas: <span className="font-medium text-heading">{current.windGustKmh} km/h</span>
            </p>
          )}
          <p className="flex items-center gap-1">
            Direção:{" "}
            <span className="inline-flex items-center gap-1 font-medium text-heading">
              <Navigation size={13} style={{ transform: `rotate(${current.windDirectionDegrees}deg)` }} />
              {current.windDirectionLabel}
            </span>
          </p>
          <p className="text-xs text-muted">Atualizado às {timeLabel(current.observedAt)}</p>
        </div>
      </div>

      {hourly.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs text-muted">Próximas horas</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {hourly.map((h) => (
              <div key={h.time} className="rounded-lg border border-line px-2 py-1.5 text-center">
                <p className="text-xs text-muted">{hourLabel(h.time)}</p>
                <p className="text-sm font-semibold text-heading">{h.windSpeedKmh} km/h</p>
                <p className="text-[11px] text-muted">{h.windDirectionLabel}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
