import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../component/DashboardLayout";
import type { DashboardPage } from "../component/Header";
import KPICard from "../component/KpiCard";
import ChartCard from "../component/ChartCard";
import { useFilters } from "../context/FilterContext";
import { formatNumber } from "../format";
import { loadDatabaseSnapshot } from "../dataService";
import { matchesServiceCaseTimeBuckets } from "../timeBuckets";

import type {
  DimCustomer,
  DimRegion,
  DimVModel,
  DimVehicle,
  FactComplaint,
  FactServiceCase,
} from "../index";

import MultiLineTrendChart from "../component/charts/MultiLineTrendChart";
import DonutChart from "../component/charts/DonutChart";

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

const CUSTOMER_TYPE_COLORS = [
  "#2563eb",
  "#3b82f6",
  "#0ea5e9",
  "#06b6d4",
  "#14b8a6",
  "#10b981",
  "#6366f1",
];

type HierarchyNode = {
  label: string;
  count: number;
  children: Map<string, HierarchyNode>;
};

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

function buildHierarchy(
  rows: Array<{
    labels: string[];
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

function getHierarchyView(root: Map<string, HierarchyNode>, path: string[]) {
  let level = root;

  for (const label of path) {
    const selectedNode = level.get(label) ?? null;

    if (!selectedNode) {
      return {
        nodes: [],
        level: 0,
      };
    }

    level = selectedNode.children;
  }

  return {
    nodes: [...level.values()].sort((a, b) => b.count - a.count),
    level: path.length,
  };
}

function isHighPriority(priority: string | null | undefined) {
  return (priority ?? "").trim().toLowerCase() === "high";
}

/*
 * The database stores boolean flags such as
 * escalated_flag / sla_met as "Yes" / "No" strings,
 * so strings like "yes" and "1" must count as true.
 * Same handling as the Overview page.
 */
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

export default function EnquiryProfile({
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

  const [complaints, setComplaints] = useState<FactComplaint[]>([]);

  const [models, setModels] = useState<DimVModel[]>([]);

  const [vehicles, setVehicles] = useState<DimVehicle[]>([]);

  const [customers, setCustomers] = useState<DimCustomer[]>([]);

  const [regions, setRegions] = useState<DimRegion[]>([]);

  /*
   * Drill-down state
   */

  const [vehicleDrillPath, setVehicleDrillPath] = useState<string[]>([]);

  const [customerDrillPath, setCustomerDrillPath] = useState<string[]>([]);

  /*
   * ---------------------------------------------------------
   * LOAD CUSTOMER SERVICE DATA
   * ---------------------------------------------------------
   */

  useEffect(() => {
    async function loadPageData() {
      setLoading(true);

      try {
        const snapshot = await loadDatabaseSnapshot();

        setServiceCases(snapshot.serviceCases);
        setComplaints(snapshot.complaints);
        setModels(snapshot.models);
        setVehicles(snapshot.vehicles);
        setCustomers(snapshot.customers);
        setRegions(snapshot.regions);
      } finally {
        setLoading(false);
      }
    }

    void loadPageData();
  }, []);

  /*
   * ---------------------------------------------------------
   * LOOKUP MAPS
   * ---------------------------------------------------------
   */

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.model_id, model])),
    [models],
  );

  const vehicleById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.vehicle_id, vehicle])),
    [vehicles],
  );

  const customerById = useMemo(
    () =>
      new Map(customers.map((customer) => [customer.customer_id, customer])),
    [customers],
  );

  const regionById = useMemo(
    () => new Map(regions.map((region) => [region.region_id, region])),
    [regions],
  );

  /*
   * ---------------------------------------------------------
   * FILTER SERVICE CASES
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

      const customer = customerById.get(serviceCase.customer_id);

      const model = vehicle ? modelById.get(vehicle.model_id) : undefined;

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
       *
       * fact_service_case does not carry application_id.
       * Use the existing backend relationship:
       * fact_service_case.vehicle_id
       * → dim_vehicle.application_id
       * → dim_application.application_id.
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
       * Case Status
       */

      if (filters.caseStatus && serviceCase.status !== filters.caseStatus) {
        return false;
      }

      /*
       * Category
       */

      if (filters.category && serviceCase.category !== filters.category) {
        return false;
      }

      /*
       * Customer IDs generated by context
       */

      if (
        matchingCustomerIds &&
        !matchingCustomerIds.includes(serviceCase.customer_id)
      ) {
        return false;
      }

      return true;
    });
  }, [
    serviceCases,
    vehicleById,
    customerById,
    modelById,
    filters,
    matchingModelIds,
    matchingCustomerIds,
  ]);

  /*
   * Reset drill paths when filters change.
   *
   * Adjusted during render (instead of in an effect)
   * following React's "previous value" pattern.
   */

  const [prevFilteredCases, setPrevFilteredCases] = useState(filteredCases);

  if (prevFilteredCases !== filteredCases) {
    setPrevFilteredCases(filteredCases);
    setVehicleDrillPath([]);
    setCustomerDrillPath([]);
  }

  /*
   * ---------------------------------------------------------
   * COMPLAINT CASES
   * ---------------------------------------------------------
   */

  const complaintCaseIds = useMemo(
    () => new Set(complaints.map((complaint) => complaint.case_id)),
    [complaints],
  );

  /*
   * ---------------------------------------------------------
   * KPI CALCULATIONS
   * ---------------------------------------------------------
   */

  const totalEnquiries = filteredCases.length;

  const highPriorityCases = filteredCases.filter((serviceCase) =>
    isHighPriority(serviceCase.priority),
  ).length;

  const escalatedCases = filteredCases.filter((serviceCase) =>
    toBoolean(serviceCase.escalated_flag),
  ).length;

  const complaintCases = filteredCases.filter((serviceCase) =>
    complaintCaseIds.has(serviceCase.case_id),
  ).length;

  /*
   * ---------------------------------------------------------
   * CATEGORY × CHANNEL HEATMAP
   * ---------------------------------------------------------
   */

  const categoryChannelData = useMemo(() => {
    const categories = Array.from(
      new Set(
        filteredCases.map((serviceCase) => serviceCase.category || "Unknown"),
      ),
    ).sort();

    const channels = Array.from(
      new Set(
        filteredCases.map((serviceCase) => serviceCase.channel || "Unknown"),
      ),
    ).sort();

    const matrix = new Map<string, Map<string, number>>();

    for (const category of categories) {
      matrix.set(category, new Map(channels.map((channel) => [channel, 0])));
    }

    for (const serviceCase of filteredCases) {
      const category = serviceCase.category || "Unknown";

      const channel = serviceCase.channel || "Unknown";

      const row = matrix.get(category);

      if (row) {
        row.set(channel, (row.get(channel) ?? 0) + 1);
      }
    }

    return {
      categories,
      channels,
      matrix,
    };
  }, [filteredCases]);

  /*
   * ---------------------------------------------------------
   * VEHICLE TYPE → MODEL → VARIANT
   * ---------------------------------------------------------
   */

  const vehicleHierarchy = useMemo(() => {
    const rows = filteredCases.map((serviceCase) => {
      const vehicle = vehicleById.get(serviceCase.vehicle_id);

      const model = vehicle ? modelById.get(vehicle.model_id) : undefined;

      return {
        labels: [
          model?.vehicle_type || "Unknown Vehicle Type",

          model?.model_name || vehicle?.model_id || "Unknown Model",

          model?.variant || "Unknown Variant",
        ],
      };
    });

    return buildHierarchy(rows);
  }, [filteredCases, vehicleById, modelById]);

  const vehicleHierarchyView = useMemo(
    () => getHierarchyView(vehicleHierarchy, vehicleDrillPath),
    [vehicleHierarchy, vehicleDrillPath],
  );

  /*
   * ---------------------------------------------------------
   * CUSTOMER TYPE → REGION
   * ---------------------------------------------------------
   */

  const customerHierarchy = useMemo(() => {
    const rows = filteredCases.map((serviceCase) => {
      const customer = customerById.get(serviceCase.customer_id);

      const region = customer ? regionById.get(customer.region_id) : undefined;

      return {
        labels: [
          customer?.customer_type || "Unknown Customer Type",

          region?.region_name || "Unknown Region",
        ],
      };
    });

    return buildHierarchy(rows);
  }, [filteredCases, customerById, regionById]);

  const customerHierarchyView = useMemo(
    () => getHierarchyView(customerHierarchy, customerDrillPath),
    [customerHierarchy, customerDrillPath],
  );

  const customerTypeDonutData = useMemo(
    () =>
      customerHierarchyView.nodes.map((node, index) => ({
        label: node.label,
        value: node.count,
        color: CUSTOMER_TYPE_COLORS[index % CUSTOMER_TYPE_COLORS.length],
      })),
    [customerHierarchyView.nodes],
  );

  /*
   * ---------------------------------------------------------
   * ENQUIRY TREND BY CATEGORY
   * ---------------------------------------------------------
   *
   * Show the major categories only so the chart
   * remains readable.
   */

  const enquiryTrendData = useMemo(() => {
    const categoryTotals = new Map<string, number>();

    for (const serviceCase of filteredCases) {
      const category = serviceCase.category || "Unknown";

      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + 1);
    }

    const majorCategories = [...categoryTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category]) => category);

    return {
      labels: MONTH_ORDER,

      series: majorCategories.map((category, index) => {
        const monthCounts = new Map<string, number>();

        for (const month of MONTH_ORDER) {
          monthCounts.set(month, 0);
        }

        for (const serviceCase of filteredCases) {
          if ((serviceCase.category || "Unknown") !== category) {
            continue;
          }

          const month = monthLabelFromDate(serviceCase.created_date);

          if (MONTH_ORDER.includes(month)) {
            monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
          }
        }

        /*
         * Keep chart styling consistent with
         * the existing dashboard palette.
         */
        const colors = ["#2563eb", "#10b981", "#6366f1", "#f59e0b", "#ef4444"];

        return {
          name: category,
          data: MONTH_ORDER.map((month) => monthCounts.get(month) ?? 0),
          color: colors[index % colors.length],
        };
      }),
    };
  }, [filteredCases]);

  /*
   * ---------------------------------------------------------
   * KPI DISPLAY
   * ---------------------------------------------------------
   */

  const kpis = [
    {
      title: "Total Service Cases",
      value: formatNumber(totalEnquiries),
      subtext: "All service cases",
      tooltip: "Total customer service cases matching the current filters",
      accentColor: "blue" as const,
    },
    {
      title: "High-Priority Cases",
      value: formatNumber(highPriorityCases),
      subtext: "High-priority demand",
      tooltip: "Number of service cases marked with High priority",
      accentColor: "amber" as const,
    },
    {
      title: "Escalated Cases",
      value: formatNumber(escalatedCases),
      subtext: "Cases escalated",
      tooltip: "Number of service cases marked as escalated",
      accentColor: "rose" as const,
    },
    {
      title: "Complaint Cases",
      value: formatNumber(complaintCases),
      subtext: "Cases with complaints",
      tooltip: "Number of service cases associated with at least one complaint",
      accentColor: "indigo" as const,
    },
  ];

  /*
   * ---------------------------------------------------------
   * HIERARCHY BAR RENDERER
   * ---------------------------------------------------------
   */

  function renderHierarchy(
    nodes: HierarchyNode[],
    onSelect: (label: string) => void,
  ) {
    if (nodes.length === 0) {
      return (
        <p className="flex h-full items-center justify-center text-sm text-slate-500">
          No matching service cases found.
        </p>
      );
    }

    const max = Math.max(1, ...nodes.map((node) => node.count));

    return (
      <div className="space-y-3">
        {nodes.map((node) => (
          <button
            key={node.label}
            type="button"
            onClick={() => {
              if (node.children.size > 0) {
                onSelect(node.label);
              }
            }}
            className={`group block w-full text-left ${
              node.children.size > 0 ? "cursor-pointer" : "cursor-default"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                <span className="truncate">{node.label}</span>

                {node.children.size > 0 && (
                  <span className="shrink-0 text-[10px] text-blue-500 opacity-0 transition-opacity group-hover:opacity-100">
                    ↘
                  </span>
                )}
              </span>

              <span className="tabular-nums text-slate-600">
                {formatNumber(node.count)}
              </span>
            </div>

            <div className="h-3 overflow-hidden rounded-md bg-slate-100">
              <div
                className="h-full rounded-md bg-blue-600 transition-all duration-300 group-hover:bg-blue-500"
                style={{
                  width: `${(node.count / max) * 100}%`,
                }}
              />
            </div>
          </button>
        ))}
      </div>
    );
  }

  /*
   * ---------------------------------------------------------
   * PAGE
   * ---------------------------------------------------------
   */

  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Service Demand & Customer Profile
            </h1>

            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              Page 2
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Understand service demand by problem, customer segment, channel, and
            vehicle.
          </p>
        </div>
      </div>

      {/* =====================================================
          KPI ROW
          ===================================================== */}

      <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KPICard
            key={kpi.title}
            title={kpi.title}
            value={kpi.value}
            subtext={kpi.subtext}
            tooltip={kpi.tooltip}
            accentColor={kpi.accentColor}
            loading={loading}
          />
        ))}
      </div>

      {/* =====================================================
          ROW 1 — CATEGORY × CHANNEL + VEHICLE MODEL
          ===================================================== */}

      <div className="mb-5 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
        {/* Category × Channel */}

        <div className="lg:col-span-7 h-[300px]">
          <ChartCard
            title="Category × Channel"
            subtitle="Number of service cases by category and customer contact channel"
            height={300}
          >
            <div className="w-full min-h-[210px] overflow-hidden">
              <div className="w-full">
                {/* Column headers */}

                <div
                  className="grid items-center gap-2 border-b border-slate-200 pb-2"
                  style={{
                    gridTemplateColumns: `minmax(130px, 1.5fr) repeat(${Math.max(
                      categoryChannelData.channels.length,
                      1,
                    )}, minmax(60px, 1fr))`,
                  }}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Category
                  </div>

                  {categoryChannelData.channels.map((channel) => (
                    <div
                      key={channel}
                      className="whitespace-nowrap text-center text-[10px] font-bold uppercase tracking-wider text-slate-500"
                      title={channel}
                    >
                      {channel}
                    </div>
                  ))}
                </div>

                {/* Matrix */}

                <div className="mt-2 space-y-1.5">
                  {categoryChannelData.categories.map((category) => {
                    const row = categoryChannelData.matrix.get(category);

                    const rowValues = categoryChannelData.channels.map(
                      (channel) => row?.get(channel) ?? 0,
                    );

                    const rowMax = Math.max(1, ...rowValues);

                    return (
                      <div
                        key={category}
                        className="grid items-center gap-2"
                        style={{
                          gridTemplateColumns: `minmax(130px, 1.5fr) repeat(${Math.max(
                            categoryChannelData.channels.length,
                            1,
                          )}, minmax(60px, 1fr))`,
                        }}
                      >
                        <div
                          className="truncate pr-2 text-xs font-semibold text-slate-700"
                          title={category}
                        >
                          {category}
                        </div>

                        {categoryChannelData.channels.map((channel) => {
                          const value = row?.get(channel) ?? 0;

                          const intensity = value / rowMax;

                          return (
                            <div
                              key={`${category}-${channel}`}
                              className="flex h-9 items-center justify-center rounded-md border border-slate-100 text-xs font-semibold transition-colors"
                              style={{
                                backgroundColor:
                                  value === 0
                                    ? "#f8fafc"
                                    : `rgba(37, 99, 235, ${
                                        0.08 + intensity * 0.62
                                      })`,
                                color: intensity > 0.55 ? "#ffffff" : "#334155",
                              }}
                              onClick={() => {
                                setFilter("category", category);
                                setFilter("channel", channel);
                              }}
                              title={`${category} · ${channel}: ${formatNumber(
                                value,
                              )} enquiries`}
                            >
                              {formatNumber(value)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ChartCard>
        </div>

        {/* Enquiries by Vehicle Model */}

        <div className="lg:col-span-5 h-[390px]">
          <ChartCard
            title="Service Cases by Vehicle Model"
            subtitle="Service cases by vehicle type · Click to drill into model and variant"
            height={300}
            action={
              vehicleDrillPath.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setVehicleDrillPath((currentPath) =>
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
              {["Vehicle Type", "Model", "Variant"].map((level, index) => (
                <span key={level} className="flex items-center gap-1.5">
                  {index > 0 && <span className="text-slate-300">→</span>}

                  <span
                    className={
                      index === vehicleDrillPath.length
                        ? "font-semibold text-blue-700"
                        : "text-slate-500"
                    }
                  >
                    {level}
                  </span>
                </span>
              ))}
            </div>

            <div className="h-[190px] overflow-y-auto pr-1">
              {renderHierarchy(vehicleHierarchyView.nodes, (label) =>
                setVehicleDrillPath((currentPath) => [...currentPath, label]),
              )}
            </div>
          </ChartCard>
        </div>
      </div>

      {/* =====================================================
          ROW 2 — CUSTOMER TYPE + CATEGORY TREND
          ===================================================== */}

      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
        {/* Customer Type → Region */}

        <div className="lg:col-span-6">
          <ChartCard
            title={
              customerDrillPath.length > 0
                ? `Service Cases by Region · ${customerDrillPath[0]}`
                : "Service Cases by Customer Type"
            }
            subtitle={
              customerDrillPath.length > 0
                ? "Regional service demand for the selected customer type"
                : "Service demand by customer segment · Click a segment to view regional demand"
            }
            height={340}
            action={
              customerDrillPath.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCustomerDrillPath([])}
                  className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  ← Back to Customer Type
                </button>
              ) : undefined
            }
          >
            {customerDrillPath.length === 0 ? (
              <DonutChart
                data={customerTypeDonutData}
                height={260}
                valueFormatter={(value) => formatNumber(value)}
                emptyMessage="No customer-type service case data available"
                wrapLabels
                onItemClick={(item) => {
                  const selectedNode = customerHierarchy.get(item.label);

                  if (selectedNode && selectedNode.children.size > 0) {
                    setCustomerDrillPath([item.label]);
                  }
                }}
              />
            ) : (
              <>
                <div className="mb-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-500">
                    Customer Type
                  </span>
                  <span className="text-slate-300">→</span>
                  <span className="font-semibold text-blue-700">Region</span>
                </div>

                <div className="h-[235px] overflow-y-auto pr-1">
                  {renderHierarchy(
                    customerHierarchyView.nodes,
                    () => undefined,
                  )}
                </div>
              </>
            )}
          </ChartCard>
        </div>

        {/* Enquiry Trend by Category */}

        <div className="lg:col-span-6">
          <ChartCard
            title="Service Case Trend by Category"
            subtitle="Monthly trend of the major service case categories"
            height={340}
          >
            <MultiLineTrendChart
              labels={enquiryTrendData.labels}
              series={enquiryTrendData.series}
              valueFormatter={(value) => formatNumber(value)}
              height={260}
            />
          </ChartCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
