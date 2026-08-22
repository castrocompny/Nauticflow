export type UserRole = "super_admin" | "company_admin" | "staff";
export type VesselType = "escuna" | "lancha" | "jet_ski" | "catamara" | "taxi_maritimo" | "outro";
export type VesselStatus = "ativa" | "manutencao" | "inativa";
export type ReservationStatus = "confirmada" | "cancelada" | "pendente";
export type PassengerStatus = "confirmado" | "embarcado" | "ausente";
export type DepartureStatus = "agendada" | "em_andamento" | "encerrada" | "cancelada";

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
};
