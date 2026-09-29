import { supabase } from "./supabaseClient";

import type {
  DimApplication,
  DimCustomer,
  DimRegion,
  DimVehicle,
  DimVModel,
  FactServiceCase,
  FactCaseStatusHistory,
  FactCustomerFeedback,
  FactComplaint,
} from "./index";

export interface DatabaseSnapshot {
  vehicles: DimVehicle[];
  models: DimVModel[];
  regions: DimRegion[];
  customers: DimCustomer[];
  applications: DimApplication[];
  serviceCases: FactServiceCase[];
  caseStatusHistory: FactCaseStatusHistory[];
  customerFeedback: FactCustomerFeedback[];
  complaints: FactComplaint[];
}

let cachedSnapshot: DatabaseSnapshot | null = null;
let activeFetchPromise: Promise<DatabaseSnapshot> | null = null;

/**
 * Fetch all rows from a Supabase table while handling
 * PostgREST's 1000-row response limit.
 *
 * This loads the complete real backend dataset.
 */
async function fetchAllTableRows<T>(
  tableName: string,
  columns = "*",
): Promise<T[]> {
  if (!supabase) return [];

  const { count, error: countError } = await supabase
    .from(tableName)
    .select(columns, { count: "exact", head: true });

  if (countError) {
    console.error(
      `Error counting table ${tableName}:`,
      countError.message,
    );
  }

  const total = count && count > 0 ? count : 1000;
  const pageSize = 1000;
  const numPages = Math.ceil(total / pageSize);

  const requests: Promise<{ data: T[] | null }>[] = [];

  for (let page = 0; page < numPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    requests.push(
      supabase
        .from(tableName)
        .select(columns)
        .range(from, to) as unknown as Promise<{
        data: T[] | null;
      }>,
    );
  }

  const results = await Promise.all(requests);

  const allRows: T[] = [];

  for (const result of results) {
    if (result.data) {
      allRows.push(...result.data);
    }
  }

  return allRows;
}

/**
 * Loads all Customer Service backend tables from Supabase
 * in parallel and caches them in memory.
 */
export async function loadDatabaseSnapshot(
  forceRefresh = false,
): Promise<DatabaseSnapshot> {
  if (!forceRefresh && cachedSnapshot) {
    return cachedSnapshot;
  }

  if (!forceRefresh && activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    try {
      const [
        vehicles,
        models,
        regions,
        customers,
        applications,
        serviceCases,
        caseStatusHistory,
        customerFeedback,
        complaints,
      ] = await Promise.all([
        fetchAllTableRows<DimVehicle>("dim_vehicle"),
        fetchAllTableRows<DimVModel>("dim_v_model"),
        fetchAllTableRows<DimRegion>("dim_region"),
        fetchAllTableRows<DimCustomer>("dim_customer"),
        fetchAllTableRows<DimApplication>("dim_application"),
        fetchAllTableRows<FactServiceCase>("fact_service_case"),
        fetchAllTableRows<FactCaseStatusHistory>(
          "fact_case_status_history",
        ),
        fetchAllTableRows<FactCustomerFeedback>(
          "fact_customer_feedback",
        ),
        fetchAllTableRows<FactComplaint>("fact_complaints"),
      ]);

      cachedSnapshot = {
        vehicles,
        models,
        regions,
        customers,
        applications,
        serviceCases,
        caseStatusHistory,
        customerFeedback,
        complaints,
      };

      return cachedSnapshot;
    } finally {
      activeFetchPromise = null;
    }
  })();

  return activeFetchPromise;
}

export function clearDatabaseCache() {
  cachedSnapshot = null;
  activeFetchPromise = null;
}