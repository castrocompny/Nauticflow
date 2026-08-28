export type UserRole = "super_admin" | "company_admin" | "staff";
export type VesselType = "escuna" | "lancha" | "jet_ski" | "catamara" | "taxi_maritimo" | "outro";
export type VesselStatus = "ativa" | "manutencao" | "inativa";
export type ReservationStatus = "confirmada" | "cancelada" | "pendente";
export type ReservationSource = "manual" | "operator" | "website" | "marketplace" | "partner" | "agency";
export type PassengerStatus = "confirmado" | "embarcado" | "ausente";
export type DepartureStatus = "agendada" | "em_andamento" | "encerrada" | "cancelada";
export type TourCategory = "passeio_privativo" | "por_do_sol" | "praias" | "ilhas" | "passeio_compartilhado" | "outro";
export type TourPriceType = "por_pessoa" | "por_grupo" | "a_partir_de";
export type TourMarketplaceStatus = "draft" | "review" | "published" | "paused" | "rejected";

export type Profile = {
  id: string;
  company_id: string | null;
  role: UserRole;
  name: string | null;
  email: string | null;
  companies?: Company | null;
};

export type Company = {
  id: string;
  name: string;
  city: string | null;
};

export type Vessel = {
  id: string;
  company_id: string;
  name: string;
  type: VesselType;
  official_capacity: number;
  default_crew: number;
  commercial_capacity: number;
  gross_tonnage: number | null;
  registration: string | null;
  status: VesselStatus;
};

export type Tour = {
  id: string;
  company_id: string;
  name: string;
  base_price_cents: number;
  active: boolean;
  slug: string;
  description: string | null;
  short_description: string | null;
  itinerary: string | null;
  duration_minutes: number | null;
  category: TourCategory | null;
  destination: string | null;
  destination_slug: string | null;
  price_type: TourPriceType;
  cancellation_policy: string | null;
  important_information: string | null;
  included: string | null;
  not_included: string | null;
  boarding_name: string | null;
  boarding_address: string | null;
  boarding_neighborhood: string | null;
  boarding_city: string | null;
  boarding_state: string | null;
  boarding_zip_code: string | null;
  boarding_reference: string | null;
  boarding_instructions: string | null;
  boarding_latitude: number | null;
  boarding_longitude: number | null;
  marketplace_status: TourMarketplaceStatus;
  published_at: string | null;
  marketplace_rejection_reason: string | null;
  marketplace_suspended_at: string | null;
  marketplace_suspended_by: string | null;
  marketplace_suspension_reason: string | null;
};

export type PhotoModerationStatus = "pending" | "approved" | "rejected" | "moderation_unavailable" | "legacy_approved" | "manual_approved";

export type TourPhoto = {
  id: string;
  company_id: string;
  tour_id: string;
  storage_path: string;
  is_cover: boolean;
  position: number;
  created_at: string;
  moderation_status: PhotoModerationStatus;
  moderation_provider: string | null;
  moderation_checked_at: string | null;
  moderation_reason_code: string | null;
  width: number | null;
  height: number | null;
};

export type Client = {
  id: string;
  company_id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
};

export type Departure = {
  id: string;
  company_id: string;
  vessel_id: string;
  tour_id: string;
  departs_at: string;
  capacity: number;
  status: DepartureStatus;
  price_cents: number | null;
  price_type: TourPriceType | null;
};

export type Reservation = {
  id: string;
  company_id: string;
  departure_id: string;
  client_id: string;
  people_count: number;
  total_cents: number;
  status: ReservationStatus;
  partner_id: string | null;
  origin_name: string | null;
  source: ReservationSource;
};
