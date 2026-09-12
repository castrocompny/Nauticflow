import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { getWindForecastWindow } from "@/lib/weather/provider";
import type { WindConditions } from "@/lib/weather/types";

export type WeatherState =
  | null // sem profile/empresa válida -- Dashboard já trata sessão inválida em outro lugar
  | { kind: "no-location" }
  | { kind: "error" }
  // `conditions.hourly` aqui é a JANELA COMPLETA (até ~7 dias), não o
  // digest de 6h -- quem só precisa do digest (WindConditionsCard) recorta
  // com `.slice(0, 6)` na hora de renderizar, nunca reconsultando o
  // provider.
  | { kind: "ok"; conditions: WindConditions; locationName: string | null };

// ÚNICA leitura de clima por renderização do Dashboard (pedido explícito,
// Etapa 2 seção 13) -- chamada UMA vez em page.tsx e reaproveitada tanto
// pelo WindConditionsCard (que recorta o digest de 6h) quanto pela
// associação de vento por saída na Agenda de passeios (que usa a janela
// completa). Toda a busca de dados (profile, empresa, provider de clima)
// fica isolada nesta função, fora de qualquer JSX -- mistura de JSX dentro
// de try/catch é proibida pelo lint deste projeto
// (react-hooks/error-boundaries).
export async function loadWeatherState(): Promise<WeatherState> {
  try {
    const profile = await getProfile();
    if (!profile?.company_id) return null;

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
      const conditions = await getWindForecastWindow({ latitude, longitude });
      return { kind: "ok", conditions, locationName: company?.weather_location_name ?? null };
    } catch (error) {
      // Log server-side com contexto suficiente pra diagnóstico, sem
      // nenhum segredo (WEATHER_API_KEY nunca aparece aqui -- o erro do
      // provider, quando existe .cause, é logado à parte, não interpolado
      // em texto que poderia conter a URL com a chave).
      console.error("Dashboard: falha ao consultar o provedor de clima", error);
      return { kind: "error" };
    }
  } catch (error) {
    // Rede de segurança final -- mesmo uma falha inesperada na consulta ao
    // profile/empresa (não relacionada ao provider de clima em si) nunca
    // pode derrubar o Dashboard.
    console.error("Dashboard: falha inesperada ao carregar estado de clima", error);
    return { kind: "error" };
  }
}
