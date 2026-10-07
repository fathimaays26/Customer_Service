import { Fragment, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../component/DashboardLayout";
import KPICard from "../component/KpiCard";
import ChartCard from "../component/ChartCard";
import type { DashboardPage } from "../component/Header";
import { useFilters } from "../context/FilterContext";
import { formatNumber } from "../format";
import { loadDatabaseSnapshot } from "../dataService";
import { matchesServiceCaseTimeBuckets } from "../timeBuckets";

import type {
  DimCustomer,
  DimRegion,
  DimVModel,
  DimVehicle,
  FactServiceCase,
  FactCaseStatusHistory,
  FactCustomerFeedback,
  OverviewKpis,
} from "../index";

import HorizontalBarChart from "../component/charts/HorizontalBarChart";
import ClusteredColumnChart from "../component/charts/ClusteredColumnChart";

const MONTH_ORDER = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthLabelFromDate(dateValue: string | null | undefined): string {
  if (!dateValue) return "Unknown";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
  }).format(date);
}

function hoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  if (!start || !end) return 0;

  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return 0;
  }

  /*
   * Signed difference — negative values are kept so the
   * average matches the verified database calculation
   * AVG(resolution_datetime - open_datetime).
   */
  return (endTime - startTime) / (1000 * 60 * 60);
}

function isResolved(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();

  return normalized === "resolved" || normalized === "closed";
}

function isOpenCase(status: string | null | undefined) {
  return !isResolved(status);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    return normalized === "true" || normalized === "yes" || normalized === "1";
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return false;
}

interface CategoryRow {
  label: string;
  value: number;
  secondaryLabel?: string;
  color?: string;
}

interface RegionRow {
  label: string;
  value: number;
  secondaryLabel?: string;
  color?: string;
}

interface ChannelRow {
  label: string;
  value: number;
  secondaryLabel?: string;
  color?: string;
}

/*
 * The Supabase column is `csat_score`, while the shared
 * FactCustomerFeedback interface still declares the older
 * `cstat_score` typo. Reading the real column through this
 * local row shape keeps Overview correct without editing
 * other pages.
 */
interface FeedbackScoreRow extends FactCustomerFeedback {
  csat_score?: number | string | null;
}

/*
 * Drill-down hierarchy used by the Geographical
 * Service Demand chart:
 * Region → Vehicle Type → Model → Variant
 */
interface DrillNode {
  label: string;
  count: number;
  children: Map<string, DrillNode>;
}

const REGION_DRILL_LEVELS = ["Region", "Vehicle Type", "Model", "Variant"];

function buildDrillHierarchy(
  rows: Array<{ labels: string[] }>,
): Map<string, DrillNode> {
  const root = new Map<string, DrillNode>();

  for (const row of rows) {
    let level = root;

    row.labels.forEach((label) => {
      const safeLabel = label || "Unknown";

      let node = level.get(safeLabel);

      if (!node) {
        node = {
          label: safeLabel,
          count: 0,
          children: new Map(),
        };

        level.set(safeLabel, node);
      }

      node.count += 1;
      level = node.children;
    });
  }

  return root;
}

function getDrillLevel(
  root: Map<string, DrillNode>,
  path: string[],
): Map<string, DrillNode> {
  let level = root;

  for (const label of path) {
    const node = level.get(label);

    if (!node) return new Map();

    level = node.children;
  }

  return level;
}

export default function Overview({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const [loading, setLoading] = useState(true);

  const [serviceCases, setServiceCases] = useState<FactServiceCase[]>([]);

  const [feedback, setFeedback] = useState<FactCustomerFeedback[]>([]);

  const [models, setModels] = useState<DimVModel[]>([]);
  const [vehicles, setVehicles] = useState<DimVehicle[]>([]);
  const [regions, setRegions] = useState<DimRegion[]>([]);
  const [customers, setCustomers] = useState<DimCustomer[]>([]);

  const [caseStatusHistory, setCaseStatusHistory] = useState<
    FactCaseStatusHistory[]
  >([]);

  const [showDetails, setShowDetails] = useState(false);

  const [categoryDrillPath, setCategoryDrillPath] = useState<string[]>([]);

  const [regionDrillPath, setRegionDrillPath] = useState<string[]>([]);

  const { filters, matchingModelIds, matchingCustomerIds } = useFilters();

  useEffect(() => {
    async function loadData() {
      setLoading(true);

      try {
        const snapshot = await loadDatabaseSnapshot();

        setServiceCases(snapshot.serviceCases);
        setFeedback(snapshot.customerFeedback);
        setModels(snapshot.models);
        setVehicles(snapshot.vehicles);
        setRegions(snapshot.regions);
        setCustomers(snapshot.customers);
        setCaseStatusHistory(snapshot.caseStatusHistory);
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  /*
   * ---------------------------------------------------------
   * FILTER SERVICE CASES
   * ---------------------------------------------------------
   */

  const filteredCases = useMemo(() => {
    let result = serviceCases.filter((serviceCase) =>
      matchesServiceCaseTimeBuckets(
        serviceCase,
        filters.pendingAgeBucket,
        filters.resolutionTimeBucket,
      ),
    );

    const vehicleMap = new Map(
      vehicles.map((vehicle) => [vehicle.vehicle_id, vehicle]),
    );

    const customerMap = new Map(
      customers.map((customer) => [customer.customer_id, customer]),
    );

    /*
     * Date
     */
    if (filters.startDate || filters.endDate) {
      result = result.filter((serviceCase) => {
        const date = serviceCase.created_date;

        if (!date) return true;

        if (filters.startDate && date < filters.startDate) {
          return false;
        }

        if (filters.endDate && date > filters.endDate) {
          return false;
        }

        return true;
      });
    }

    /*
     * Region
     */
    if (filters.regionId) {
      result = result.filter((serviceCase) => {
        const customer = customerMap.get(serviceCase.customer_id);

        return customer?.region_id === filters.regionId;
      });
    }

    /*
     * Application
     *
     * fact_service_case carries no application column, so
     * the link runs through the case vehicle:
     * fact_service_case.vehicle_id → dim_vehicle.application_id
     * → dim_application.application_id.
     */
    if (filters.applicationId) {
      const allowedVehicles = new Set(
        vehicles
          .filter((vehicle) => vehicle.application_id === filters.applicationId)
          .map((vehicle) => vehicle.vehicle_id),
      );

      result = result.filter((serviceCase) =>
        allowedVehicles.has(serviceCase.vehicle_id),
      );
    }

    /*
     * Model / Variant / Vehicle Type
     */
    if (
      filters.modelId ||
      filters.variant ||
      filters.vehicleType ||
      matchingModelIds
    ) {
      const allowedModelIds = new Set(
        (matchingModelIds ?? (filters.modelId ? [filters.modelId] : [])).filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
      );

      const hasModelFilter =
        filters.modelId ||
        filters.variant ||
        filters.vehicleType ||
        matchingModelIds;

      if (hasModelFilter) {
        result = result.filter((serviceCase) => {
          const vehicle = vehicleMap.get(serviceCase.vehicle_id);

          if (!vehicle) return false;

          return allowedModelIds.has(vehicle.model_id);
        });
      }
    }

    /*
     * Customer Type
     */
    if (filters.customerType) {
      result = result.filter((serviceCase) => {
        const customer = customerMap.get(serviceCase.customer_id);

        return customer?.customer_type === filters.customerType;
      });
    }

    /*
     * Channel
     */
    if (filters.channel) {
      result = result.filter(
        (serviceCase) => serviceCase.channel === filters.channel,
      );
    }

    /*
     * Priority
     */
    if (filters.priority) {
      result = result.filter(
        (serviceCase) => serviceCase.priority === filters.priority,
      );
    }

    /*
     * Case Status
     */
    if (filters.caseStatus) {
      result = result.filter(
        (serviceCase) => serviceCase.status === filters.caseStatus,
      );
    }

    /*
     * Category
     */
    if (filters.category) {
      result = result.filter(
        (serviceCase) => serviceCase.category === filters.category,
      );
    }

    /*
     * matchingCustomerIds from Customer Type / Region
     */
    if (matchingCustomerIds) {
      const allowedCustomers = new Set(matchingCustomerIds);

      result = result.filter((serviceCase) =>
        allowedCustomers.has(serviceCase.customer_id),
      );
    }

    return result;
  }, [
    serviceCases,
    vehicles,
    customers,
    filters,
    matchingModelIds,
    matchingCustomerIds,
  ]);

  /*
   * Reset chart drill-downs whenever the global
   * filters change the underlying case set.
   *
   * Adjusted during render (instead of in an effect)
   * following React's "previous value" pattern.
   */
  const [prevFilteredCases, setPrevFilteredCases] = useState(filteredCases);

  if (prevFilteredCases !== filteredCases) {
    setPrevFilteredCases(filteredCases);
    setCategoryDrillPath([]);
    setRegionDrillPath([]);
  }

  /*
   * ---------------------------------------------------------
   * FEEDBACK FILTERING
   * ---------------------------------------------------------
   */

  const filteredFeedback = useMemo(() => {
    const caseIds = new Set(
      filteredCases.map((serviceCase) => serviceCase.case_id),
    );

    return feedback.filter((item) => caseIds.has(item.case_id));
  }, [feedback, filteredCases]);

  /*
   * ---------------------------------------------------------
   * REOPENED CASES
   *
   * Derived purely from fact_case_status_history: a case is
   * reopened when its history shows it reached Resolved /
   * Closed and a later event moved it back to a non-resolved
   * status (Open / In Progress).
   * ---------------------------------------------------------
   */
  const reopenedCaseIds = useMemo(() => {
    const eventsByCase = new Map<string, FactCaseStatusHistory[]>();

    for (const historyEntry of caseStatusHistory) {
      const entries = eventsByCase.get(historyEntry.case_id) ?? [];

      entries.push(historyEntry);
      eventsByCase.set(historyEntry.case_id, entries);
    }

    const reopenedIds = new Set<string>();

    for (const [caseId, entries] of eventsByCase) {
      entries.sort(
        (a, b) =>
          new Date(a.status_date_time).getTime() -
            new Date(b.status_date_time).getTime() ||
          a.history_id.localeCompare(b.history_id),
      );

      let resolvedSeen = false;

      for (const entry of entries) {
        if (isResolved(entry.status)) {
          resolvedSeen = true;
          continue;
        }

        if (resolvedSeen) {
          reopenedIds.add(caseId);
          break;
        }
      }
    }

    return reopenedIds;
  }, [caseStatusHistory]);

  /*
   * ---------------------------------------------------------
   * KPIs + CHART DATA
   * ---------------------------------------------------------
   */

  const metrics = useMemo(() => {
    const totalCases = filteredCases.length;

    const openCases = filteredCases.filter((serviceCase) =>
      isOpenCase(serviceCase.status),
    );

    const resolvedCases = filteredCases.filter(
      (serviceCase) =>
        isResolved(serviceCase.status) && serviceCase.resolution_datetime,
    );

    /*
     * Average Resolution Time (hours).
     *
     * Matches the verified database calculation:
     * AVG(resolution_datetime - open_datetime) over
     * Resolved/Closed cases that have a resolution
     * timestamp (2,447 rows → 304.76 hours).
     *
     * Every difference counts — including negative
     * ones — so the frontend stays in sync with the
     * SQL result. Do not re-add a positivity filter.
     */
    const resolutionHours = resolvedCases.map((serviceCase) =>
      hoursBetween(serviceCase.open_datetime, serviceCase.resolution_datetime),
    );

    const averageResolutionTime =
      resolutionHours.length > 0
        ? resolutionHours.reduce((sum, value) => sum + value, 0) /
          resolutionHours.length
        : 0;

    /*
     * CSAT
     */
    const csatScores = filteredFeedback
      .map((item) =>
        Number((item as FeedbackScoreRow).csat_score ?? item.cstat_score),
      )
      .filter((value) => Number.isFinite(value));

    const csatScore =
      csatScores.length > 0
        ? csatScores.reduce((sum, value) => sum + value, 0) / csatScores.length
        : 0;

    /*
     * Escalations
     */
    const escalatedCases = filteredCases.filter((serviceCase) =>
      toBoolean(serviceCase.escalated_flag),
    );

    /*
     * Reopened Cases — filtered cases whose status history
     * shows a resolution followed by a return to an
     * unresolved status.
     */
    const reopenedCases = filteredCases.filter((serviceCase) =>
      reopenedCaseIds.has(serviceCase.case_id),
    );

    /*
     * -------------------------------------------------------
     * SERVICE CASE TREND
     * -------------------------------------------------------
     */

    const enquiriesByMonth = new Map<string, number>();

    const resolvedByMonth = new Map<string, number>();

    for (const month of MONTH_ORDER) {
      enquiriesByMonth.set(month, 0);
      resolvedByMonth.set(month, 0);
    }

    for (const serviceCase of filteredCases) {
      const enquiryMonth = monthLabelFromDate(serviceCase.created_date);

      if (MONTH_ORDER.includes(enquiryMonth)) {
        enquiriesByMonth.set(
          enquiryMonth,
          (enquiriesByMonth.get(enquiryMonth) ?? 0) + 1,
        );
      }

      if (serviceCase.resolution_datetime && isResolved(serviceCase.status)) {
        const resolutionMonth = monthLabelFromDate(
          serviceCase.resolution_datetime,
        );

        if (MONTH_ORDER.includes(resolutionMonth)) {
          resolvedByMonth.set(
            resolutionMonth,
            (resolvedByMonth.get(resolutionMonth) ?? 0) + 1,
          );
        }
      }
    }

    /*
     * Category
     */
    const categoryMap = new Map<string, number>();

    for (const serviceCase of filteredCases) {
      const category = serviceCase.category || "Unknown";

      categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
    }

    const categoryData: CategoryRow[] = [...categoryMap.entries()]
      .map(([label, value]) => ({
        label,
        value,
        secondaryLabel: `${((value / Math.max(totalCases, 1)) * 100).toFixed(
          1,
        )}%`,
        color: "bg-blue-600",
      }))
      .sort((a, b) => b.value - a.value);

    /*
     * Region
     */
    const regionMap = new Map<string, number>();

    const regionLookup = new Map(
      regions.map((region) => [region.region_id, region]),
    );

    const customerLookup = new Map(
      customers.map((customer) => [customer.customer_id, customer]),
    );

    for (const serviceCase of filteredCases) {
      const customer = customerLookup.get(serviceCase.customer_id);

      const regionName =
        regionLookup.get(customer?.region_id ?? "")?.region_name ?? "Unknown";

      regionMap.set(regionName, (regionMap.get(regionName) ?? 0) + 1);
    }

    const regionData: RegionRow[] = [...regionMap.entries()]
      .map(([label, value]) => ({
        label,
        value,
        secondaryLabel: `${((value / Math.max(totalCases, 1)) * 100).toFixed(
          1,
        )}% of cases`,
        color: "bg-indigo-600",
      }))
      .sort((a, b) => b.value - a.value);

    /*
     * Channel
     */
    const channelMap = new Map<string, number>();

    for (const serviceCase of filteredCases) {
      const channel = serviceCase.channel || "Unknown";

      channelMap.set(channel, (channelMap.get(channel) ?? 0) + 1);
    }

    const channelData: ChannelRow[] = [...channelMap.entries()]
      .map(([label, value]) => ({
        label,
        value,
        secondaryLabel: `${((value / Math.max(totalCases, 1)) * 100).toFixed(
          1,
        )}% of cases`,
        color: "bg-blue-600",
      }))
      .sort((a, b) => b.value - a.value);

    return {
      kpis: {
        totalServiceCases: totalCases,
        openCases: openCases.length,
        averageResolutionTime,
        csatScore,
        escalatedCases: escalatedCases.length,
        reopenedCases: reopenedCases.length,
      } satisfies OverviewKpis,

      trendData: {
        labels: MONTH_ORDER,
        series: [
          {
            name: "Service Cases",
            data: MONTH_ORDER.map((month) => enquiriesByMonth.get(month) ?? 0),
            color: "#2563eb",
          },
          {
            name: "Resolved Cases",
            data: MONTH_ORDER.map((month) => resolvedByMonth.get(month) ?? 0),
            color: "#10b981",
          },
        ],
      },

      categoryData,
      regionData,
      channelData,
    };
  }, [filteredCases, filteredFeedback, reopenedCaseIds, regions, customers]);

  const kpis = metrics.kpis;

  /*
   * ---------------------------------------------------------
   * CHART DRILL-DOWNS
   * ---------------------------------------------------------
   */

  /*
   * Service Cases by Category → Priority
   */
  const categoryPriorityData = useMemo<CategoryRow[]>(() => {
    const selectedCategory = categoryDrillPath[0];

    if (!selectedCategory) return [];

    const priorityMap = new Map<string, number>();

    let total = 0;

    for (const serviceCase of filteredCases) {
      const category = serviceCase.category || "Unknown";

      if (category !== selectedCategory) continue;

      const priority = serviceCase.priority || "Unknown";

      priorityMap.set(priority, (priorityMap.get(priority) ?? 0) + 1);

      total += 1;
    }

    return [...priorityMap.entries()]
      .map(([label, value]) => ({
        label,
        value,
        secondaryLabel: `${((value / Math.max(total, 1)) * 100).toFixed(1)}%`,
        color: "bg-blue-600",
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredCases, categoryDrillPath]);

  /*
   * Geographical Service Demand
   * Region → Vehicle Type → Model → Variant
   */
  const regionHierarchy = useMemo(() => {
    const vehicleMap = new Map(
      vehicles.map((vehicle) => [vehicle.vehicle_id, vehicle]),
    );

    const modelMap = new Map(models.map((model) => [model.model_id, model]));

    const customerMap = new Map(
      customers.map((customer) => [customer.customer_id, customer]),
    );

    const regionMap = new Map(
      regions.map((region) => [region.region_id, region]),
    );

    return buildDrillHierarchy(
      filteredCases.map((serviceCase) => {
        const customer = customerMap.get(serviceCase.customer_id);

        const vehicle = vehicleMap.get(serviceCase.vehicle_id);

        const model = vehicle ? modelMap.get(vehicle.model_id) : undefined;

        const regionName =
          regionMap.get(customer?.region_id ?? "")?.region_name ?? "Unknown";

        return {
          labels: [
            regionName,
            model?.vehicle_type || "Unknown",
            model?.model_name || "Unknown",
            model?.variant || "Unknown",
          ],
        };
      }),
    );
  }, [filteredCases, regions, models, vehicles, customers]);

  const regionDrillData = useMemo<RegionRow[]>(() => {
    const level = getDrillLevel(regionHierarchy, regionDrillPath);

    const total = [...level.values()].reduce(
      (sum, node) => sum + node.count,
      0,
    );

    return [...level.values()]
      .map((node) => ({
        label: node.label,
        value: node.count,
        secondaryLabel: `${((node.count / Math.max(total, 1)) * 100).toFixed(
          1,
        )}%`,
        color: "bg-indigo-600",
      }))
      .sort((a, b) => b.value - a.value);
  }, [regionHierarchy, regionDrillPath]);

  /*
   * ---------------------------------------------------------
   * INLINE SERVICE CASE DETAILS
   * ---------------------------------------------------------
   */

  if (showDetails) {
    const customerMap = new Map(
      customers.map((customer) => [customer.customer_id, customer]),
    );

    return (
      <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">
                Service Case Details
              </h1>

              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                {filteredCases.length} Cases
              </span>
            </div>

            <p className="mt-1 text-xs text-slate-500">
              Underlying customer service cases matching the current global
              filters.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowDetails(false)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-blue-300 hover:text-blue-700"
          >
            ← Back to Overview
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="max-h-[calc(100vh-190px)] overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200">
                  {[
                    "Case ID",
                    "Customer",
                    "Category",
                    "Channel",
                    "Priority",
                    "Status",
                    "Created",
                    "Resolution",
                  ].map((header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredCases.map((serviceCase) => {
                  const customer = customerMap.get(serviceCase.customer_id);

                  return (
                    <tr
                      key={serviceCase.case_id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {serviceCase.case_id}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {customer?.customer_name ?? serviceCase.customer_id}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {serviceCase.category}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {serviceCase.channel}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {serviceCase.priority}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {serviceCase.status}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {serviceCase.created_date}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {serviceCase.resolution_datetime ?? "—"}
                      </td>
                    </tr>
                  );
                })}

                {filteredCases.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      No service cases match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  /*
   * ---------------------------------------------------------
   * MAIN OVERVIEW
   * ---------------------------------------------------------
   */

  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      {/* Header Banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Service Overview
            </h1>

            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              Page 1
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Executive view of service demand, workload, resolution performance,
            and customer satisfaction.
          </p>
        </div>
      </div>

      {/* =====================================================
          KPI ROW
          ===================================================== */}

      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-6">
        <KPICard
          title="Total Service Cases"
          value={formatNumber(kpis.totalServiceCases)}
          tooltip="Total number of customer service cases matching the current filters"
          accentColor="blue"
          loading={loading}
        />

        <KPICard
          title="Open Cases"
          value={formatNumber(kpis.openCases)}
          tooltip="Cases whose current status is not Resolved or Closed"
          accentColor="amber"
          loading={loading}
        />

        <KPICard
          title="Avg Resolution Time"
          value={`${(kpis.averageResolutionTime / 24).toFixed(1)} days`}
          tooltip="Average time between case open time and resolution time for resolved cases, shown in days"
          accentColor="indigo"
          loading={loading}
        />

        <KPICard
          title="CSAT Score"
          value={kpis.csatScore.toFixed(2)}
          tooltip="Average customer satisfaction score from available feedback responses"
          accentColor="emerald"
          loading={loading}
        />

        <KPICard
          title="Escalated Cases"
          value={formatNumber(kpis.escalatedCases)}
          tooltip="Number of service cases marked as escalated"
          accentColor="rose"
          loading={loading}
        />

        <KPICard
          title="Reopened Cases"
          value={formatNumber(kpis.reopenedCases)}
          tooltip="Cases whose status history shows they were resolved and later moved back to an unresolved status"
          accentColor="slate"
          loading={loading}
        />
      </div>

      {/* =====================================================
          ROW 1 — TREND + CATEGORY
          ===================================================== */}

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Service Case Trend */}

        <div className="lg:col-span-7">
          <ChartCard
            title="Service Case Trend"
            subtitle="Monthly service cases compared with completed resolutions"
            height={285}
            action={
              <button
                type="button"
                onClick={() => setShowDetails(true)}
                title="View Service Case Details"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 shadow-2xs transition-all hover:bg-blue-600 hover:text-white"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </button>
            }
          >
            <div className="h-[205px]">
              <ClusteredColumnChart
                data={MONTH_ORDER.map((month, index) => ({
                  category: month,
                  series: [
                    {
                      name: "Service Cases",
                      value: metrics.trendData.series[0].data[index],
                      color: "bg-blue-600",
                    },
                    {
                      name: "Resolved Cases",
                      value: metrics.trendData.series[1].data[index],
                      color: "bg-emerald-500",
                    },
                  ],
                }))}
                valueFormatter={(value) => formatNumber(value)}
                height={195}
                showLegend={true}
              />
            </div>
          </ChartCard>
        </div>

        {/* Service Cases by Category */}

        <div className="lg:col-span-5">
          <ChartCard
            title="Service Cases by Category"
            subtitle="Service demand by category · Click a category to view priority"
            height={285}
            action={
              categoryDrillPath.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setCategoryDrillPath((currentPath) =>
                      currentPath.slice(0, -1),
                    )
                  }
                  className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  ← Back
                </button>
              ) : undefined
            }
          >
            {categoryDrillPath.length > 0 && (
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                {[...categoryDrillPath, "Priority"].map(
                  (label, index, path) => (
                    <Fragment key={`${label}-${index}`}>
                      {index > 0 && <span className="text-slate-300">→</span>}
                      <span
                        className={
                          index === path.length - 1
                            ? "font-semibold text-blue-700"
                            : ""
                        }
                      >
                        {label}
                      </span>
                    </Fragment>
                  ),
                )}
              </div>
            )}

            <div className="h-[220px] overflow-y-auto pr-1">
              {categoryDrillPath.length === 0 ? (
                <HorizontalBarChart
                  data={metrics.categoryData}
                  valueFormatter={(value) => formatNumber(value)}
                  showRank={true}
                  onBarClick={(label) => setCategoryDrillPath([label])}
                />
              ) : (
                <HorizontalBarChart
                  data={categoryPriorityData}
                  valueFormatter={(value) => formatNumber(value)}
                  showRank={true}
                />
              )}
            </div>
          </ChartCard>
        </div>
      </div>

      {/* =====================================================
          ROW 2 — REGION + CHANNEL
          ===================================================== */}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Service Demand by Region */}

        <ChartCard
          title="Service Demand by Region"
          subtitle="Service demand by region · Click a region to drill into vehicle details"
          height={285}
          action={
            regionDrillPath.length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setRegionDrillPath((currentPath) => currentPath.slice(0, -1))
                }
                className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                ← Back
              </button>
            ) : undefined
          }
        >
          {regionDrillPath.length > 0 && (
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
              {[
                ...regionDrillPath,
                REGION_DRILL_LEVELS[regionDrillPath.length],
              ].map((label, index, path) => (
                <Fragment key={`${label}-${index}`}>
                  {index > 0 && <span className="text-slate-300">→</span>}
                  <span
                    className={
                      index === path.length - 1
                        ? "font-semibold text-blue-700"
                        : ""
                    }
                  >
                    {label}
                  </span>
                </Fragment>
              ))}
            </div>
          )}

          <div className="h-[220px] overflow-y-auto pr-1">
            {regionDrillPath.length === 0 ? (
              <HorizontalBarChart
                data={metrics.regionData}
                valueFormatter={(value) => formatNumber(value)}
                barColor="bg-indigo-600"
                showRank={true}
                onBarClick={(label) => setRegionDrillPath([label])}
              />
            ) : (
              <HorizontalBarChart
                data={regionDrillData}
                valueFormatter={(value) => formatNumber(value)}
                barColor="bg-indigo-600"
                showRank={true}
                onBarClick={
                  regionDrillPath.length < REGION_DRILL_LEVELS.length - 1
                    ? (label) =>
                        setRegionDrillPath((currentPath) => [
                          ...currentPath,
                          label,
                        ])
                    : undefined
                }
              />
            )}
          </div>
        </ChartCard>

        {/* Service Cases by Channel */}

        <ChartCard
          title="Service Cases by Channel"
          subtitle="Customer contact channels"
          height={285}
        >
          <div className="h-[220px] overflow-y-auto pr-1">
            <HorizontalBarChart
              data={metrics.channelData}
              valueFormatter={(value) => formatNumber(value)}
              barColor="bg-blue-600"
              showRank={true}
            />
          </div>
        </ChartCard>
      </div>
    </DashboardLayout>
  );
}
