// ---- Raw table row shapes (match existing Supabase schema exactly) ----

export interface DimCustomer {
  customer_id: string;
  customer_name: string;
  customer_type: string;
  region_id: string;
}

export interface DimRegion {
  region_id: string;
  region_name: string;
  state: string;
  country: string;
}

export interface DimVModel {
  model_id: string;
  model_name: string;
  variant: string;
  vehicle_type: string;
}

export interface DimVehicle {
  vehicle_id: string;
  VIN: string;
  model_id: string;
  customer_id: string;
  location_id: string;
  current_status: string;
  application_id: string | null;
}

export interface DimApplication {
  application_id: string;
  application_name: string;
  sub_application_name: string | null;
  tier: number | null;
  business_vertical: string | null;
  expected_monthly_uptime_minutes: number | null;
}

export interface FactServiceCase {
  case_id: string;
  customer_id: string;
  vehicle_id: string;
  category: string;
  channel: string;
  priority: string;
  status: string;
  created_date: string;
  open_datetime: string;
  resolution_datetime: string | null;
  escalated_flag: boolean;
  sla_target_hours: number;
  sla_due_date_time: string;
  sla_met: boolean;
}

export interface FactCaseStatusHistory {
  history_id: string;
  case_id: string;
  status: string;
  status_date_time: string;
}

export interface FactCustomerFeedback {
  feedback_id: string;
  case_id: string;
  customer_id: string;
  cstat_score: number;
  feedback_type: string;
  feedback_date: string;
}

export interface FactComplaint {
  complaint_id: string;
  case_id: string;
  customer_id: string;
  category: string;
  complaint_date: string;
  complaint_type: string;
}

// ---- Dimension lookup maps, built once and reused across pages ----

export interface DimensionLookups {
  regionsById: Map<string, DimRegion>;
  modelsById: Map<string, DimVModel>;
  customersById: Map<string, DimCustomer>;

  regions: DimRegion[];
  models: DimVModel[];
  variants: string[];
  vehicleTypes: string[];
  customerTypes: string[];

  applications: DimApplication[];

  channels: string[];
  priorities: string[];
  caseStatuses: string[];
  caseCategories: string[];
  feedbackTypes: string[];
  complaintTypes: string[];
}

// ---- Global filter state shared across every page ----

export interface GlobalFilters {
  startDate: string | null;
  endDate: string | null;

  regionId: string | null;
  applicationId: string | null;
  modelId: string | null;
  variant: string | null;
  vehicleType: string | null;
  customerType: string | null;

  channel: string | null;
  priority: string | null;
  caseStatus: string | null;
  category: string | null;
  pendingAgeBucket: string | null;
  resolutionTimeBucket: string | null;
}

export const EMPTY_FILTERS: GlobalFilters = {
  startDate: null,
  endDate: null,

  regionId: null,
  applicationId: null,
  modelId: null,
  variant: null,
  vehicleType: null,
  customerType: null,

  channel: null,
  priority: null,
  caseStatus: null,
  category: null,
  pendingAgeBucket: null,
  resolutionTimeBucket: null,
};

// ---- Overview KPI structure ----

export interface OverviewKpis {
  totalServiceCases: number;
  openCases: number;
  averageResolutionTime: number;
  csatScore: number;
  escalatedCases: number;
  reopenedCases: number;
}

// ---- Generic chart point ----

export interface ChartPoint {
  label: string;
  value: number;
}
