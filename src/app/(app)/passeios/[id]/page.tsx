import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { PageHeader } from "@/components/ui";
import type { Tour, TourPhoto, TourScheduleRule, Vessel } from "@/lib/types";
import { validateTourForPublishing } from "@/lib/tour-publishing";
import { TourForm } from "./tour-form";
import { PhotoManager } from "./photo-manager";
import { PublicationPanel } from "./publication-panel";
import { ScheduleManager } from "./schedule-manager";

export default async function EditTourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  if (!profile?.company_id) notFound();

  const supabase = createClient();
  const [{ data: tour }, { data: photosData }, { data: vesselsData }, { data: ruleData }, { count: upcomingCount }] = await Promise.all([
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
          <PhotoManager tourId={tour.id} companyId={profile.company_id} photos={signedPhotos} />
          <ScheduleManager
            tourId={tour.id}
            vessels={(vesselsData ?? []) as Vessel[]}
            rule={(ruleData as TourScheduleRule) ?? null}
            upcomingCount={upcomingCount ?? 0}
          />
        </div>
        <div>
          <PublicationPanel tour={tour as Tour} photoCount={photos.length} checklist={checklist} />
        </div>
      </div>
    </>
  );
}
