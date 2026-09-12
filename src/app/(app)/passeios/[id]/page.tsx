import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { PageHeader } from "@/components/ui";
import type { Tour, TourFlexibleBookingRule, TourPhoto, TourScheduleRule, Vessel } from "@/lib/types";
import { validateTourForPublishing } from "@/lib/tour-publishing";
import { TourForm } from "./tour-form";
import { PhotoManager } from "./photo-manager";
import { PublicationPanel } from "./publication-panel";
import { ScheduleSection } from "./schedule-section";
import { FlexibleBookingSection } from "./flexible-booking-section";
import { BookingModelSection } from "./booking-model-section";

export default async function EditTourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  if (!profile?.company_id) notFound();

  const supabase = createClient();
  const [{ data: tour }, { data: photosData }, { data: vesselsData }, { data: ruleData }, { data: flexRuleData }, { count: upcomingCount }] =
    await Promise.all([
      supabase.from("tours").select("*").eq("id", id).eq("company_id", profile.company_id).maybeSingle(),
      supabase
        .from("tour_photos")
        .select("*")
        .eq("tour_id", id)
        .eq("company_id", profile.company_id)
        .order("position", { ascending: true }),
      supabase.from("vessels").select("*").eq("company_id", profile.company_id).eq("status", "ativa").order("name"),
      supabase.from("tour_schedule_rules").select("*").eq("tour_id", id).eq("company_id", profile.company_id).maybeSingle(),
      supabase
        .from("tour_flexible_booking_rules")
        .select("*")
        .eq("tour_id", id)
        .eq("company_id", profile.company_id)
        .maybeSingle(),
      supabase
        .from("departures")
        .select("id", { count: "exact", head: true })
        .eq("tour_id", id)
        .neq("status", "cancelada")
        .gt("departs_at", new Date().toISOString()),
    ]);
  if (!tour) notFound();

  // checklist de publicação -- a REGRA mora no banco (validate_tour_for_publishing,
  // migration 0044/0063), isto aqui só busca pra mostrar o "pronto pra publicar?" na tela
  const checklist = await validateTourForPublishing(supabase, id);

  // "Preview" (sem tocar no gatilho) de quando a troca de booking_model seria
  // bloqueada -- espelha as MESMAS duas condições de
  // check_tour_booking_model_transition (migration 0073, fonte única de
  // verdade real: se este espelho ficar desatualizado, o pior caso é a UI
  // deixar tentar uma troca que o banco ainda recusa, nunca o contrário).
  // Usa dados que a página já busca acima -- nenhuma query nova. Achado de
  // UX (seção 135): sem isso, o operador só descobria o bloqueio depois de
  // clicar e ver o rádio "voltar" sem explicação.
  const hasFutureDepartures = (upcomingCount ?? 0) > 0;
  const hasActiveScheduleRule = !!(ruleData as TourScheduleRule | null)?.active;
  const hasActiveFlexRule = !!(flexRuleData as TourFlexibleBookingRule | null)?.active;
  let blockedReason: string | null = null;
  if (hasFutureDepartures) {
    blockedReason = "Não é possível alterar o modelo porque existem saídas futuras.";
  } else if ((tour as Tour).booking_model === "fixed_schedule" && hasActiveScheduleRule) {
    blockedReason = "Não é possível alterar o modelo porque este passeio possui uma agenda recorrente ativa.";
  } else if ((tour as Tour).booking_model === "flexible_private" && hasActiveFlexRule) {
    blockedReason = "Não é possível alterar o modelo porque existe uma configuração de disponibilidade privativa ativa.";
  }

  const photos = (photosData ?? []) as TourPhoto[];
  const signedPhotos = await Promise.all(
    photos.map(async (p) => {
      const { data } = await supabase.storage.from("tour-photos").createSignedUrl(p.storage_path, 3600);
      return { ...p, signedUrl: data?.signedUrl ?? null };
    })
  );

  return (
    <>
      <PageHeader
        title={(tour as Tour).name}
        subtitle="Cadastro comercial do passeio para o futuro marketplace ToursFlow."
        action={
          <Link href="/passeios" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-body">
            <ArrowLeft size={16} /> Voltar
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <TourForm tour={tour as Tour} />
          <BookingModelSection tourId={tour.id} persistedModel={(tour as Tour).booking_model} blockedReason={blockedReason} />
          <div id="schedule-section">
            {(tour as Tour).booking_model === "flexible_private" ? (
              <FlexibleBookingSection
                tourId={tour.id}
                vessels={(vesselsData ?? []) as Vessel[]}
                rule={(flexRuleData as TourFlexibleBookingRule) ?? null}
              />
            ) : (
              <ScheduleSection
                tourId={tour.id}
                vessels={(vesselsData ?? []) as Vessel[]}
                rule={(ruleData as TourScheduleRule) ?? null}
                upcomingCount={upcomingCount ?? 0}
                tourBasePriceCents={(tour as Tour).base_price_cents}
              />
            )}
          </div>
          <PhotoManager tourId={tour.id} companyId={profile.company_id} photos={signedPhotos} />
        </div>
        <div>
          <PublicationPanel tour={tour as Tour} photoCount={photos.length} checklist={checklist} />
        </div>
      </div>
    </>
  );
}
