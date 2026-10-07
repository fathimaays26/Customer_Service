import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../component/DashboardLayout";
import KPICard from "../component/KpiCard";
import ChartCard from "../component/ChartCard";
import type { DashboardPage } from "../component/Header";
import { useFilters } from "../context/FilterContext";
import { formatNumber, formatPercent } from "../format";
import { loadDatabaseSnapshot } from "../dataService";
import { matchesServiceCaseTimeBuckets } from "../timeBuckets";

import type {
  DimCustomer,
  DimVModel,
  DimVehicle,
  FactServiceCase,
  FactCaseStatusHistory,
} from "../index";

import HorizontalBarChart from "../component/charts/HorizontalBarChart";
import ClusteredColumnChart from "../component/charts/ClusteredColumnChart";

const AGE_BUCKETS = [
  "0–30 Days",
  "31–60 Days",
  "61–90 Days",
  "90+ Days",
] as const;

const RESOLUTION_BUCKETS = [
  "0–1 days",
  "1–2 days",
  "2–3 days",
  "3–5 days",
  "5+ days",
] as const;

type HierarchyNode = {
  label: string;
  count: number;
  tatSum: number;
  escalated: number;
  children: Map<string, HierarchyNode>;
};

function isEscalated(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "yes";
  }
  return value === true;
}

function isOpenCase(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "open" || normalized === "in progress";
}

function isResolved(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();

  return normalized === "resolved" || normalized === "closed";
}

function hoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  if (!start || !end) return 0;

  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) {
    return 0;
  }

  return (endTime - startTime) / (1000 * 60 * 60);
}

function getPendingAgeDays(openDate: string | null | undefined) {
  if (!openDate) return 0;

  const opened = new Date(openDate).getTime();

  if (Number.isNaN(opened)) return 0;

  return Math.max(0, (Date.now() - opened) / (1000 * 60 * 60 * 24));
}

function getAgeBucket(ageDays: number) {
  if (ageDays <= 30) return "0–30 Days";
  if (ageDays <= 60) return "31–60 Days";
  if (ageDays <= 90) return "61–90 Days";
  return "90+ Days";
}

function getResolutionBucket(hours: number) {
  if (hours <= 24) return "0–1 days";
  if (hours <= 48) return "1–2 days";
  if (hours <= 72) return "2–3 days";
  if (hours <= 120) return "3–5 days";
  return "5+ days";
}

function buildHierarchy(
  rows: Array<{
    labels: string[];
    tatHours: number;
    escalated: boolean;
  }>,
) {
  const root = new Map<string, HierarchyNode>();

  for (const row of rows) {
    let level = root;

    row.labels.forEach((label) => {
      const safeLabel = label || "Unknown";

      let node = level.get(safeLabel);

      if (!node) {
        node = {
          label: safeLabel,
          count: 0,
          tatSum: 0,
          escalated: 0,
          children: new Map(),
        };

        level.set(safeLabel, node);
      }

      node.count += 1;
      node.tatSum += row.tatHours;

      if (row.escalated) {
        node.escalated += 1;
      }

      level = node.children;
    });
  }

  return root;
}

function getHierarchyView(root: Map<string, HierarchyNode>, path: string[]) {
  let level = root;

  for (const label of path) {
    const node = level.get(label);

    if (!node) {
      return [];
    }

    level = node.children;
  }

  return [...level.values()].sort(
    (a, b) => b.tatSum / Math.max(b.count, 1) - a.tatSum / Math.max(a.count, 1),
  );
}

export default function SLAResolutionAnalytics({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const { filters, setFilter, matchingModelIds, matchingCustomerIds } =
    useFilters();

  const [loading, setLoading] = useState(true);

  const [serviceCases, setServiceCases] = useState<FactServiceCase[]>([]);

  const [vehicles, setVehicles] = useState<DimVehicle[]>([]);

  const [models, setModels] = useState<DimVModel[]>([]);

  const [customers, setCustomers] = useState<DimCustomer[]>([]);

  const [caseStatusHistory, setCaseStatusHistory] = useState<
    FactCaseStatusHistory[]
  >([]);

  const [categoryDrillPath, setCategoryDrillPath] = useState<string[]>([]);

  /*
   * ---------------------------------------------------------
   * LOAD DATA
   * ---------------------------------------------------------
   */

  useEffect(() => {
    async function loadPageData() {
      setLoading(true);

      try {
        const snapshot = await loadDatabaseSnapshot();

        setServiceCases(snapshot.serviceCases);
        setVehicles(snapshot.vehicles);
        setModels(snapshot.models);
        setCustomers(snapshot.customers);
        setCaseStatusHistory(snapshot.caseStatusHistory);
      } finally {
        setLoading(false);
      }
    }

    void loadPageData();
  }, []);

  /*
   * ---------------------------------------------------------
   * LOOKUPS
   * ---------------------------------------------------------
   */

  const vehicleById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.vehicle_id, vehicle])),
    [vehicles],
  );

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.model_id, model])),
    [models],
  );

  const customerById = useMemo(
    () =>
      new Map(customers.map((customer) => [customer.customer_id, customer])),
    [customers],
  );

  /*
   * ---------------------------------------------------------
   * FILTER CASES
   * ---------------------------------------------------------
   */

  const filteredCases = useMemo(() => {
    return serviceCases.filter((serviceCase) => {
      if (
        !matchesServiceCaseTimeBuckets(
          serviceCase,
          filters.pendingAgeBucket,
          filters.resolutionTimeBucket,
        )
      ) {
        return false;
      }

      const vehicle = vehicleById.get(serviceCase.vehicle_id);

      const model = vehicle ? modelById.get(vehicle.model_id) : undefined;

      const customer = customerById.get(serviceCase.customer_id);

      /*
       * Date
       */

      if (filters.startDate && serviceCase.created_date < filters.startDate) {
        return false;
      }

      if (filters.endDate && serviceCase.created_date > filters.endDate) {
        return false;
      }

      /*
       * Region
       */

      if (filters.regionId && customer?.region_id !== filters.regionId) {
        return false;
      }

      /*
       * Application
       */

      if (
        filters.applicationId &&
        vehicle?.application_id !== filters.applicationId
      ) {
        return false;
      }

      /*
       * Model
       */

      if (filters.modelId && vehicle?.model_id !== filters.modelId) {
        return false;
      }

      if (
        matchingModelIds &&
        !matchingModelIds.includes(vehicle?.model_id ?? "")
      ) {
        return false;
      }

      /*
       * Variant
       */

      if (filters.variant && model?.variant !== filters.variant) {
        return false;
      }

      /*
       * Vehicle Type
       */

      if (filters.vehicleType && model?.vehicle_type !== filters.vehicleType) {
        return false;
      }

      /*
       * Customer Type
       */

      if (
        filters.customerType &&
        customer?.customer_type !== filters.customerType
      ) {
        return false;
      }

      /*
       * Customer IDs from context
       */

      if (
        matchingCustomerIds &&
        !matchingCustomerIds.includes(serviceCase.customer_id)
      ) {
        return false;
      }

      /*
       * Category
       */

      if (filters.category && serviceCase.category !== filters.category) {
        return false;
      }

      /*
       * Channel
       */

      if (filters.channel && serviceCase.channel !== filters.channel) {
        return false;
      }

      /*
       * Priority
       */

      if (filters.priority && serviceCase.priority !== filters.priority) {
        return false;
      }

      /*
       * Status
       */

      if (filters.caseStatus && serviceCase.status !== filters.caseStatus) {
        return false;
      }

      return true;
    });
  }, [
    serviceCases,
    vehicleById,
    modelById,
    customerById,
    filters,
    matchingModelIds,
    matchingCustomerIds,
  ]);

  useEffect(() => {
    setCategoryDrillPath([]);
  }, [filteredCases]);

  /*
   * ---------------------------------------------------------
   * RESOLUTION + WORKLOAD KPIs
   * ---------------------------------------------------------
   */

  const resolvedCases = filteredCases.filter(
    (serviceCase) =>
      isResolved(serviceCase.status) &&
      serviceCase.resolution_datetime &&
      serviceCase.open_datetime,
  );

  const resolutionTATHours = resolvedCases
    .map((serviceCase) =>
      hoursBetween(serviceCase.open_datetime, serviceCase.resolution_datetime),
    )
    .filter((hours) => hours > 0);

  const averageResolutionTAT =
    resolutionTATHours.length > 0
      ? resolutionTATHours.reduce((sum, hours) => sum + hours, 0) /
        resolutionTATHours.length
      : 0;

  const pendingCases = filteredCases.filter(
    (serviceCase) => !isResolved(serviceCase.status),
  );

  const averagePendingCaseAge =
    pendingCases.length > 0
      ? pendingCases
          .map((serviceCase) => getPendingAgeDays(serviceCase.open_datetime))
          .filter((days) => days >= 0)
          .reduce((sum, days) => sum + days, 0) /
        Math.max(
          1,
          pendingCases
            .map((serviceCase) => getPendingAgeDays(serviceCase.open_datetime))
            .filter((days) => days >= 0).length,
        )
      : 0;

  const openCaseBacklog = filteredCases.filter((serviceCase) =>
    isOpenCase(serviceCase.status),
  ).length;

  const escalatedCases = filteredCases.filter((serviceCase) =>
    isEscalated(serviceCase.escalated_flag),
  );

  const escalationRate =
    filteredCases.length > 0
      ? (escalatedCases.length / filteredCases.length) * 100
      : 0;

  /*
   * A case is reopened when its status history reaches Resolved / Closed
   * and a later history event moves it back to Open / In Progress.
   */
  const reopenedEvents = useMemo(() => {
    const filteredCaseIds = new Set(
      filteredCases.map((serviceCase) => serviceCase.case_id),
    );
    const eventsByCase = new Map<string, FactCaseStatusHistory[]>();

    for (const entry of caseStatusHistory) {
      if (!filteredCaseIds.has(entry.case_id)) continue;
      const entries = eventsByCase.get(entry.case_id) ?? [];
      entries.push(entry);
      eventsByCase.set(entry.case_id, entries);
    }

    const firstReopenByCase = new Map<string, string>();

    for (const [caseId, entries] of eventsByCase) {
      const ordered = [...entries].sort(
        (a, b) =>
          new Date(a.status_date_time).getTime() -
            new Date(b.status_date_time).getTime() ||
          a.history_id.localeCompare(b.history_id),
      );

      let resolvedSeen = false;

      for (const entry of ordered) {
        if (isResolved(entry.status)) {
          resolvedSeen = true;
          continue;
        }

        if (
          resolvedSeen &&
          (entry.status.trim().toLowerCase() === "open" ||
            entry.status.trim().toLowerCase() === "in progress")
        ) {
          firstReopenByCase.set(caseId, entry.status_date_time);
          break;
        }
      }
    }

    return firstReopenByCase;
  }, [caseStatusHistory, filteredCases]);

  const reopenedCaseIds = useMemo(
    () => new Set(reopenedEvents.keys()),
    [reopenedEvents],
  );

  /*
   * REOPEN RATE BY CATEGORY
   *
   * A case is considered reopened when its status history shows
   * Resolved / Closed followed later by Open / In Progress.
   *
   * The rate is calculated as:
   * reopened cases in category / total filtered cases in category × 100.
   */
  const reopenRateByCategory = useMemo(() => {
    const categoryMap = new Map<
      string,
      {
        total: number;
        reopened: number;
      }
    >();

    for (const serviceCase of filteredCases) {
      const category = serviceCase.category || "Unknown";

      const current = categoryMap.get(category) ?? {
        total: 0,
        reopened: 0,
      };

      current.total += 1;

      if (reopenedCaseIds.has(serviceCase.case_id)) {
        current.reopened += 1;
      }

      categoryMap.set(category, current);
    }

    return [...categoryMap.entries()]
      .map(([label, stats]) => {
        const rate =
          stats.total > 0
            ? Number(((stats.reopened / stats.total) * 100).toFixed(1))
            : 0;

        return {
          label,
          value: rate,
          secondaryLabel: `${formatNumber(stats.reopened)}/${formatNumber(
            stats.total,
          )} reopened`,
          color:
            rate >= 20
              ? "bg-rose-500"
              : rate >= 10
                ? "bg-amber-500"
                : "bg-blue-600",
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [filteredCases, reopenedCaseIds]);

  /*
   * ---------------------------------------------------------
   * CASE LIFECYCLE / STATUS FUNNEL
   * ---------------------------------------------------------
   */

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>([
      ["Open", 0],
      ["In Progress", 0],
      ["Resolved", 0],
    ]);

    for (const serviceCase of filteredCases) {
      const normalized = (serviceCase.status ?? "").trim().toLowerCase();

      if (normalized === "open") {
        counts.set("Open", (counts.get("Open") ?? 0) + 1);
      } else if (normalized === "in progress") {
        counts.set("In Progress", (counts.get("In Progress") ?? 0) + 1);
      } else if (normalized === "resolved" || normalized === "closed") {
        counts.set("Resolved", (counts.get("Resolved") ?? 0) + 1);
      }
    }

    return [...counts.entries()];
  }, [filteredCases]);

  /*
   * ---------------------------------------------------------
   * PENDING CASE AGEING
   * ---------------------------------------------------------
   */

  const pendingAgeingData = useMemo(() => {
    const counts = new Map<string, number>();

    for (const bucket of AGE_BUCKETS) {
      counts.set(bucket, 0);
    }

    for (const serviceCase of pendingCases) {
      const age = getPendingAgeDays(serviceCase.open_datetime);

      const bucket = getAgeBucket(age);

      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }

    return AGE_BUCKETS.map((bucket) => ({
      label: bucket,
      value: counts.get(bucket) ?? 0,
      color:
        bucket === "90+ Days"
          ? "bg-rose-500"
          : bucket === "61–90 Days"
            ? "bg-amber-500"
            : "bg-blue-600",
    }));
  }, [pendingCases]);

  /*
   * ---------------------------------------------------------
   * RESOLUTION TIME DISTRIBUTION
   * ---------------------------------------------------------
   */

  const resolutionDistributionData = useMemo(() => {
    const counts = new Map<string, number>();

    for (const bucket of RESOLUTION_BUCKETS) {
      counts.set(bucket, 0);
    }

    for (const serviceCase of resolvedCases) {
      const hours = hoursBetween(
        serviceCase.open_datetime,
        serviceCase.resolution_datetime,
      );

      if (hours <= 0) continue;

      const bucket = getResolutionBucket(hours);

      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }

    return RESOLUTION_BUCKETS.map((bucket) => ({
      category: bucket,
      series: [
        {
          name: "Resolved Cases",
          value: counts.get(bucket) ?? 0,
          color: "bg-blue-600",
        },
      ],
    }));
  }, [resolvedCases]);

  /*
   * ---------------------------------------------------------
   * CATEGORY → PRIORITY
   * ---------------------------------------------------------
   */

  const categoryHierarchy = useMemo(() => {
    const rows = filteredCases.map((serviceCase) => {
      const tatHours = isResolved(serviceCase.status)
        ? hoursBetween(
            serviceCase.open_datetime,
            serviceCase.resolution_datetime,
          )
        : 0;

      return {
        labels: [
          serviceCase.category || "Unknown Category",

          serviceCase.priority || "Unknown Priority",
        ],
        tatHours,
        escalated: isEscalated(serviceCase.escalated_flag),
      };
    });

    return buildHierarchy(rows);
  }, [filteredCases]);

  const categoryHierarchyView = useMemo(
    () => getHierarchyView(categoryHierarchy, categoryDrillPath),
    [categoryHierarchy, categoryDrillPath],
  );

  /*
   * ---------------------------------------------------------
   * RESOLUTION TAT BY CATEGORY
   * ---------------------------------------------------------
   */

  const resolutionTATByCategory = useMemo(() => {
    const categoryMap = new Map<
      string,
      {
        totalHours: number;
        resolvedCount: number;
      }
    >();

    for (const serviceCase of resolvedCases) {
      const category = serviceCase.category || "Unknown";

      const tat = hoursBetween(
        serviceCase.open_datetime,
        serviceCase.resolution_datetime,
      );

      const current = categoryMap.get(category) ?? {
        totalHours: 0,
        resolvedCount: 0,
      };

      current.totalHours += tat;
      current.resolvedCount += 1;

      categoryMap.set(category, current);
    }

    return [...categoryMap.entries()]
      .map(([label, stats]) => ({
        label,
        value:
          stats.resolvedCount > 0
            ? Number((stats.totalHours / stats.resolvedCount).toFixed(1))
            : 0,
        secondaryLabel: `${formatNumber(stats.resolvedCount)} resolved`,
        color: "bg-blue-600",
      }))
      .sort((a, b) => b.value - a.value);
  }, [resolvedCases]);

  /*
   * ---------------------------------------------------------
   * ESCALATION RATE BY CATEGORY
   * ---------------------------------------------------------
   */

  const escalationRateByCategory = useMemo(() => {
    const categoryMap = new Map<
      string,
      {
        total: number;
        escalated: number;
      }
    >();

    for (const serviceCase of filteredCases) {
      const category = serviceCase.category || "Unknown";

      const current = categoryMap.get(category) ?? {
        total: 0,
        escalated: 0,
      };

      current.total += 1;

      if (isEscalated(serviceCase.escalated_flag)) {
        current.escalated += 1;
      }

      categoryMap.set(category, current);
    }

    return [...categoryMap.entries()]
      .map(([label, stats]) => {
        const rate =
          stats.total > 0
            ? Number(((stats.escalated / stats.total) * 100).toFixed(1))
            : 0;

        return {
          label,
          value: rate,
          secondaryLabel: `${formatNumber(stats.escalated)}/${formatNumber(
            stats.total,
          )} escalated`,
          color:
            rate >= 20
              ? "bg-rose-500"
              : rate >= 10
                ? "bg-amber-500"
                : "bg-blue-600",
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [filteredCases]);

  /*
   * ---------------------------------------------------------
   * STATUS FUNNEL VISUAL
   * ---------------------------------------------------------
   *
   * This is a status distribution rather than inventing
   * a lifecycle transition rule that is not defined in
   * the current model.
   */

  const lifecycleData = useMemo(() => {
    return statusCounts.map(([status, count]) => ({
      category: status,
      series: [
        {
          name: "Cases",
          value: count,
          color: status === "Resolved" ? "bg-emerald-500" : "bg-blue-600",
        },
      ],
    }));
  }, [statusCounts]);

  /*
   * ---------------------------------------------------------
   * MAIN PAGE
   * ---------------------------------------------------------
   */

  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Resolution &amp; Workload Analytics
            </h1>

            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              Page 3
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Resolution performance, current workload, ageing, and escalation
            patterns.
          </p>
        </div>
      </div>

      {/* =====================================================
          KPI ROW
          ===================================================== */}

      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <KPICard
          title="Avg Resolution Time"
          value={`${(averageResolutionTAT / 24).toFixed(1)} days`}
          subtext="Resolved cases"
          tooltip="Average time from case open to resolution for resolved cases"
          accentColor="indigo"
          loading={loading}
        />

        <KPICard
          title="Avg Pending Case Age"
          value={`${averagePendingCaseAge.toFixed(1)} days`}
          subtext="Current unresolved cases"
          tooltip="Average age of currently unresolved cases based on open datetime"
          accentColor="amber"
          loading={loading}
        />

        <KPICard
          title="Open Case Backlog"
          value={formatNumber(openCaseBacklog)}
          subtext="Open and in-progress cases"
          tooltip="Cases currently in Open or In Progress status"
          accentColor="blue"
          loading={loading}
        />

        <KPICard
          title="Escalated Cases"
          value={formatNumber(escalatedCases.length)}
          subtext={`${formatPercent(escalationRate)} of filtered cases`}
          tooltip="Cases marked as escalated in the service case data"
          accentColor="amber"
          loading={loading}
        />

        <KPICard
          title="Reopened Cases"
          value={formatNumber(reopenedCaseIds.size)}
          subtext="Cases reopened after resolution"
          tooltip="Cases with a later Open or In Progress status after reaching Resolved or Closed"
          accentColor="rose"
          loading={loading}
        />
      </div>

      {/* =====================================================
          ROW 1 — LIFECYCLE + AGEING
          ===================================================== */}

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Case Lifecycle / Status Funnel */}

        <ChartCard
          title="Current Case Status"
          subtitle="Current distribution of open, in-progress, and resolved cases"
          height={320}
        >
          <div className="flex h-[240px] items-center justify-center">
            {lifecycleData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-500">
                No matching cases found.
              </p>
            ) : (
              (() => {
                const totalCases = statusCounts.reduce(
                  (sum, [, value]) => sum + value,
                  0,
                );

                let accumulated = 0;

                const segments = statusCounts.map(([status, count]) => {
                  const percentage =
                    totalCases > 0 ? (count / totalCases) * 100 : 0;
                  const start = accumulated;
                  accumulated += percentage;

                  return {
                    status,
                    count,
                    percentage,
                    start,
                    end: accumulated,
                  };
                });

                const gradient = segments
                  .map((segment) => {
                    const color =
                      segment.status === "Resolved"
                        ? "#10b981"
                        : segment.status === "In Progress"
                          ? "#2563eb"
                          : "#60a5fa";

                    return `${color} ${segment.start}% ${segment.end}%`;
                  })
                  .join(", ");

                return (
                  <div className="flex w-full items-center justify-center gap-8">
                    <div
                      className="relative h-44 w-44 shrink-0 rounded-full"
                      style={{
                        background: `conic-gradient(${gradient})`,
                      }}
                      aria-label="Current case status distribution"
                    >
                      <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full bg-white">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Total Cases
                        </span>
                        <span className="mt-1 text-2xl font-bold text-slate-900">
                          {formatNumber(totalCases)}
                        </span>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                      {segments.map((segment) => {
                        const dotColor =
                          segment.status === "Resolved"
                            ? "bg-emerald-500"
                            : segment.status === "In Progress"
                              ? "bg-blue-600"
                              : "bg-blue-400";

                        return (
                          <div
                            key={segment.status}
                            className="flex items-center justify-between gap-4"
                            onClick={() =>
                              setFilter("caseStatus", segment.status)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setFilter("caseStatus", segment.status);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`}
                              />
                              <span className="truncate text-xs font-semibold text-slate-700">
                                {segment.status}
                              </span>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-xs font-semibold tabular-nums text-slate-700">
                                {formatNumber(segment.count)}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                                {segment.percentage.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </ChartCard>

        {/* Pending Case Ageing */}

        <ChartCard
          title="Pending Case Ageing"
          subtitle="How long currently unresolved cases have been open"
          height={320}
        >
          <div className="h-[240px] px-2">
            <div className="flex h-full items-end justify-between gap-4">
              {pendingAgeingData.map((row) => {
                const maxValue = Math.max(
                  1,
                  ...pendingAgeingData.map((item) => item.value),
                );
                const height = Math.max(
                  row.value > 0 ? 8 : 0,
                  (row.value / maxValue) * 100,
                );

                return (
                  <div
                    key={row.label}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                    onClick={() => setFilter("pendingAgeBucket", row.label)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setFilter("pendingAgeBucket", row.label);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="mb-2 text-xs font-semibold tabular-nums text-slate-600">
                      {formatNumber(row.value)}
                    </span>

                    <div className="flex h-[155px] w-full items-end justify-center">
                      <div
                        className={`w-10 max-w-full rounded-t-md ${row.color} transition-all`}
                        style={{ height: `${height}%` }}
                        title={`${row.label}: ${formatNumber(row.value)} cases`}
                      />
                    </div>

                    <span className="mt-2 text-center text-[10px] font-semibold leading-tight text-slate-500">
                      {row.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </ChartCard>
      </div>

      {/* =====================================================
          ROW 2 — RESOLUTION DISTRIBUTION + TAT CATEGORY
          ===================================================== */}

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Resolution Time Distribution */}

        <ChartCard
          title="Resolution Time Distribution"
          subtitle="Distribution of resolved cases by resolution-time bucket"
          height={320}
        >
          <ClusteredColumnChart
            data={resolutionDistributionData}
            valueFormatter={(value) => formatNumber(value)}
            height={235}
            showLegend={false}
            onCategoryClick={(label) =>
              setFilter("resolutionTimeBucket", label)
            }
          />
        </ChartCard>

        {/* Resolution TAT by Category */}

        <ChartCard
          title="Resolution Time by Category"
          subtitle="Average resolution time · Drill: Category → Priority"
          height={320}
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
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {["Category", "Priority"].map((level, index) => (
              <span key={level} className="flex items-center gap-1.5">
                {index > 0 && <span className="text-slate-300">→</span>}

                <span
                  className={
                    index === categoryDrillPath.length
                      ? "font-semibold text-blue-700"
                      : ""
                  }
                >
                  {level}
                </span>
              </span>
            ))}
          </div>

          <div className="h-[215px] overflow-y-auto pr-1">
            {categoryDrillPath.length === 0 ? (
              <div className="space-y-3">
                {resolutionTATByCategory.map((row, index) => (
                  <button
                    key={row.label}
                    type="button"
                    onClick={() => setCategoryDrillPath([row.label])}
                    className="group block w-full text-left"
                    title={`Drill into ${row.label} by priority`}
                  >
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-semibold text-slate-700">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-500">
                          {index + 1}
                        </span>
                        <span className="transition-colors group-hover:text-blue-700">
                          {row.label}
                        </span>
                      </span>

                      <span className="flex items-center gap-2 font-semibold text-slate-600">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          {row.secondaryLabel}
                        </span>
                        <span>{(row.value / 24).toFixed(1)} days</span>
                      </span>
                    </div>

                    <div className="h-3 overflow-hidden rounded-md bg-slate-100">
                      <div
                        className="h-full rounded-md bg-blue-600 transition-all group-hover:bg-blue-700"
                        style={{
                          width: `${Math.min(
                            100,
                            (row.value /
                              Math.max(
                                0.1,
                                ...resolutionTATByCategory.map(
                                  (item) => item.value,
                                ),
                              )) *
                              100,
                          )}%`,
                        }}
                      />
                    </div>

                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">
                        Click to drill into priority
                      </span>
                      <span className="text-[10px] font-semibold text-blue-500 opacity-0 transition-opacity group-hover:opacity-100">
                        View Priority →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {categoryHierarchyView.map((node) => {
                  const avgTAT = node.count > 0 ? node.tatSum / node.count : 0;

                  return (
                    <div key={node.label} className="group">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">
                          {node.label}
                        </span>

                        <span className="font-semibold text-slate-600">
                          {(avgTAT / 24).toFixed(1)} days
                        </span>
                      </div>

                      <div className="h-3 overflow-hidden rounded-md bg-slate-100">
                        <div
                          className="h-full rounded-md bg-blue-600"
                          style={{
                            width: `${Math.min(
                              100,
                              (avgTAT /
                                Math.max(
                                  1,
                                  ...categoryHierarchyView.map(
                                    (item) =>
                                      item.tatSum / Math.max(item.count, 1),
                                  ),
                                )) *
                                100,
                            )}%`,
                          }}
                        />
                      </div>

                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        {formatNumber(node.count)} resolved cases
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {categoryDrillPath.length === 0 && (
            <div className="mt-2 text-[10px] text-slate-400">
              Click a category to drill into priority.
            </div>
          )}
        </ChartCard>
      </div>
      {/* =====================================================
          ROW 3 — ESCALATION + REOPENED CASES
          ===================================================== */}

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard
          title="Escalation Rate by Category"
          subtitle="Escalated cases divided by total cases within each category"
          height={320}
        >
          <div className="h-[235px] overflow-y-auto pr-1">
            <HorizontalBarChart
              data={escalationRateByCategory}
              valueFormatter={(value) => `${value}%`}
              maxVal={100}
              showRank={true}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Reopen Rate by Category"
          subtitle="Reopened cases divided by total cases within each category"
          height={320}
        >
          <div className="h-[235px] overflow-y-auto pr-1">
            <HorizontalBarChart
              data={reopenRateByCategory}
              valueFormatter={(value) => `${value}%`}
              maxVal={100}
              showRank={true}
            />
          </div>
        </ChartCard>
      </div>
    </DashboardLayout>
  );
}
