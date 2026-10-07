import { useEffect, useMemo, useState } from "react";
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
  DimVModel,
  DimVehicle,
  FactComplaint,
  FactCustomerFeedback,
  FactServiceCase,
} from "../index";

import HorizontalBarChart from "../component/charts/HorizontalBarChart";
import MultiLineTrendChart from "../component/charts/MultiLineTrendChart";

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

interface FeedbackRow extends FactCustomerFeedback {
  csat_score?: number | string | null;
}

function getCsatScore(item: FactCustomerFeedback): number | null {
  const row = item as unknown as FeedbackRow;
  const val =
    row.csat_score ??
    (row as { cstat_score?: number | string | null }).cstat_score;
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function formatBusinessDate(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr.trim() === "" || dateStr === "—") return "—";

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, d] = match;
    const months = [
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
    const monthIndex = parseInt(m, 10) - 1;
    const monthName = months[monthIndex] ?? m;
    const dayNum = parseInt(d, 10);
    return `${dayNum} ${monthName} ${y}`;
  }

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;

  const day = date.getDate();
  const months = [
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
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

type CategoryPriorityNode = {
  label: string;
  count: number;
  csatSum: number;
  children: Map<string, CategoryPriorityNode>;
};

function getMonthLabel(dateValue: string | null | undefined) {
  if (!dateValue) return "Unknown";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
  }).format(date);
}

function buildCategoryPriorityHierarchy(
  rows: Array<{
    category: string;
    priority: string;
    csat: number;
  }>,
) {
  const root = new Map<string, CategoryPriorityNode>();

  for (const row of rows) {
    let categoryNode = root.get(row.category);

    if (!categoryNode) {
      categoryNode = {
        label: row.category,
        count: 0,
        csatSum: 0,
        children: new Map(),
      };

      root.set(row.category, categoryNode);
    }

    categoryNode.count += 1;
    categoryNode.csatSum += row.csat;

    let priorityNode = categoryNode.children.get(row.priority);

    if (!priorityNode) {
      priorityNode = {
        label: row.priority,
        count: 0,
        csatSum: 0,
        children: new Map(),
      };

      categoryNode.children.set(row.priority, priorityNode);
    }

    priorityNode.count += 1;
    priorityNode.csatSum += row.csat;
  }

  return root;
}

export default function CustomerSatisfaction({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const { filters, matchingModelIds, matchingCustomerIds } = useFilters();

  const [loading, setLoading] = useState(true);

  const [feedback, setFeedback] = useState<FactCustomerFeedback[]>([]);

  const [complaints, setComplaints] = useState<FactComplaint[]>([]);

  const [serviceCases, setServiceCases] = useState<FactServiceCase[]>([]);

  const [vehicles, setVehicles] = useState<DimVehicle[]>([]);

  const [models, setModels] = useState<DimVModel[]>([]);

  const [customers, setCustomers] = useState<DimCustomer[]>([]);

  const [categoryDrillPath, setCategoryDrillPath] = useState<string[]>([]);
  const [showComplaintDetails, setShowComplaintDetails] = useState(false);

  const [tableCategoryFilter, setTableCategoryFilter] = useState<string>("All");
  const [tableTypeFilter, setTableTypeFilter] = useState<string>("All");
  const [complaintSortColumn, setComplaintSortColumn] = useState<string | null>(
    null,
  );
  const [complaintSortDirection, setComplaintSortDirection] = useState<
    "asc" | "desc"
  >("asc");

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

        setFeedback(snapshot.customerFeedback);

        setComplaints(snapshot.complaints);

        setServiceCases(snapshot.serviceCases);

        setVehicles(snapshot.vehicles);
        setModels(snapshot.models);
        setCustomers(snapshot.customers);
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

  const caseById = useMemo(
    () =>
      new Map(
        serviceCases.map((serviceCase) => [serviceCase.case_id, serviceCase]),
      ),
    [serviceCases],
  );

  /*
   * ---------------------------------------------------------
   * FILTER SERVICE CASES
   * ---------------------------------------------------------
   *
   * The service case is the bridge between:
   * Case → Vehicle → Model
   * Case → Customer → Region / Customer Type
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

      if (filters.startDate && serviceCase.created_date < filters.startDate) {
        return false;
      }

      if (filters.endDate && serviceCase.created_date > filters.endDate) {
        return false;
      }

      if (filters.regionId && customer?.region_id !== filters.regionId) {
        return false;
      }

      if (filters.modelId && vehicle?.model_id !== filters.modelId) {
        return false;
      }

      if (
        matchingModelIds &&
        !matchingModelIds.includes(vehicle?.model_id ?? "")
      ) {
        return false;
      }

      if (filters.variant && model?.variant !== filters.variant) {
        return false;
      }

      if (filters.vehicleType && model?.vehicle_type !== filters.vehicleType) {
        return false;
      }

      if (
        filters.customerType &&
        customer?.customer_type !== filters.customerType
      ) {
        return false;
      }

      if (
        matchingCustomerIds &&
        !matchingCustomerIds.includes(serviceCase.customer_id)
      ) {
        return false;
      }

      if (filters.category && serviceCase.category !== filters.category) {
        return false;
      }

      if (filters.channel && serviceCase.channel !== filters.channel) {
        return false;
      }

      if (filters.priority && serviceCase.priority !== filters.priority) {
        return false;
      }

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

  /*
   * ---------------------------------------------------------
   * FILTER FEEDBACK
   * ---------------------------------------------------------
   */

  const filteredFeedback = useMemo(() => {
    const allowedCaseIds = new Set(
      filteredCases.map((serviceCase) => serviceCase.case_id),
    );

    return feedback.filter((item) => {
      if (!allowedCaseIds.has(item.case_id)) {
        return false;
      }

      if (filters.startDate && item.feedback_date < filters.startDate) {
        return false;
      }

      if (filters.endDate && item.feedback_date > filters.endDate) {
        return false;
      }

      return true;
    });
  }, [feedback, filteredCases, filters.startDate, filters.endDate]);

  /*
   * ---------------------------------------------------------
   * FILTER COMPLAINTS
   * ---------------------------------------------------------
   */

  const filteredComplaints = useMemo(() => {
    const allowedCaseIds = new Set(
      filteredCases.map((serviceCase) => serviceCase.case_id),
    );

    return complaints.filter((complaint) => {
      if (!allowedCaseIds.has(complaint.case_id)) {
        return false;
      }

      if (filters.startDate && complaint.complaint_date < filters.startDate) {
        return false;
      }

      if (filters.endDate && complaint.complaint_date > filters.endDate) {
        return false;
      }

      return true;
    });
  }, [complaints, filteredCases, filters.startDate, filters.endDate]);

  /*
   * ---------------------------------------------------------
   * KPI CALCULATIONS
   * ---------------------------------------------------------
   */

  const feedbackScores = filteredFeedback
    .map((item) => getCsatScore(item))
    .filter((score): score is number => score !== null);

  const averageCSAT =
    feedbackScores.length > 0
      ? feedbackScores.reduce((sum, score) => sum + score, 0) /
        feedbackScores.length
      : 0;

  /*
   * Positive / negative classification
   *
   * We use the feedback_type field when it is
   * populated. If it is not populated, we do
   * not invent a classification threshold.
   */

  const positiveFeedback = filteredFeedback.filter(
    (item) => String(item.feedback_type ?? "").toLowerCase() === "positive",
  ).length;

  const negativeFeedback = filteredFeedback.filter(
    (item) => String(item.feedback_type ?? "").toLowerCase() === "negative",
  ).length;

  const positiveFeedbackRate =
    filteredFeedback.length > 0
      ? (positiveFeedback / filteredFeedback.length) * 100
      : 0;

  const negativeFeedbackRate =
    filteredFeedback.length > 0
      ? (negativeFeedback / filteredFeedback.length) * 100
      : 0;

  /*
   * ---------------------------------------------------------
   * CSAT TREND
   * ---------------------------------------------------------
   */

  const csatTrendData = useMemo(() => {
    const monthly = new Map<
      string,
      {
        total: number;
        count: number;
      }
    >();

    for (const month of MONTH_ORDER) {
      monthly.set(month, {
        total: 0,
        count: 0,
      });
    }

    for (const item of filteredFeedback) {
      const month = getMonthLabel(item.feedback_date);

      const row = monthly.get(month);

      if (!row) continue;

      const score = getCsatScore(item);

      if (score === null) {
        continue;
      }

      row.total += score;
      row.count += 1;
    }

    return {
      labels: MONTH_ORDER,
      series: [
        {
          name: "Average CSAT",
          color: "#2563eb",
          data: MONTH_ORDER.map((month) => {
            const row = monthly.get(month);

            return row && row.count > 0
              ? Number((row.total / row.count).toFixed(2))
              : 0;
          }),
        },
      ],
    };
  }, [filteredFeedback]);

  /*
   * ---------------------------------------------------------
   * CSAT BY CATEGORY → PRIORITY
   * ---------------------------------------------------------
   */

  const categoryPriorityRows = useMemo(() => {
    const rows: Array<{
      category: string;
      priority: string;
      csat: number;
    }> = [];

    for (const feedbackItem of filteredFeedback) {
      const serviceCase = caseById.get(feedbackItem.case_id);

      if (!serviceCase) continue;

      const score = getCsatScore(feedbackItem);

      if (score === null) {
        continue;
      }

      rows.push({
        category: serviceCase.category || "Unknown Category",
        priority: serviceCase.priority || "Unknown Priority",
        csat: score,
      });
    }

    return rows;
  }, [filteredFeedback, caseById]);

  const categoryPriorityHierarchy = useMemo(
    () => buildCategoryPriorityHierarchy(categoryPriorityRows),
    [categoryPriorityRows],
  );

  const categoryCSATData = useMemo(() => {
    const categoryMap = new Map<
      string,
      {
        total: number;
        count: number;
      }
    >();

    for (const row of categoryPriorityRows) {
      const current = categoryMap.get(row.category) ?? {
        total: 0,
        count: 0,
      };

      current.total += row.csat;
      current.count += 1;

      categoryMap.set(row.category, current);
    }

    return [...categoryMap.entries()]
      .map(([label, stats]) => ({
        label,
        value:
          stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0,
        secondaryLabel: `${formatNumber(stats.count)} responses`,
        color: "bg-blue-600",
      }))
      .sort((a, b) => b.value - a.value);
  }, [categoryPriorityRows]);

  /*
   * ---------------------------------------------------------
   * COMPLAINT TYPE RATE
   * ---------------------------------------------------------
   */

  const complaintTypeRateData = useMemo(() => {
    const typeMap = new Map<string, number>();

    for (const complaint of filteredComplaints) {
      const type = complaint.complaint_type || "Unknown Complaint Type";
      typeMap.set(type, (typeMap.get(type) ?? 0) + 1);
    }

    const totalComplaints = filteredComplaints.length;

    return [...typeMap.entries()]
      .map(([label, count]) => ({
        label,
        value:
          totalComplaints > 0
            ? Number(((count / totalComplaints) * 100).toFixed(1))
            : 0,
        secondaryLabel: `${formatNumber(count)} complaints`,
        color: "bg-amber-500",
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredComplaints]);

  /*
   * ---------------------------------------------------------
   * INLINE COMPLAINT DETAILS
   * ---------------------------------------------------------
   */

  const availableComplaintTypes = useMemo(() => {
    const types = new Set<string>();
    for (const c of complaints) {
      if (c.complaint_type) types.add(c.complaint_type);
    }
    return Array.from(types).sort();
  }, [complaints]);

  const handleComplaintSort = (columnKey: string) => {
    if (complaintSortColumn === columnKey) {
      if (complaintSortDirection === "asc") {
        setComplaintSortDirection("desc");
      } else {
        setComplaintSortColumn(null);
        setComplaintSortDirection("asc");
      }
    } else {
      setComplaintSortColumn(columnKey);
      setComplaintSortDirection("asc");
    }
  };

  const displayedComplaints = useMemo(() => {
    let list = filteredComplaints;

    if (tableCategoryFilter !== "All") {
      list = list.filter((c) => {
        const cat = caseById.get(c.case_id)?.category;
        return cat === tableCategoryFilter;
      });
    }

    if (tableTypeFilter !== "All") {
      list = list.filter((c) => c.complaint_type === tableTypeFilter);
    }

    if (complaintSortColumn === null) {
      return [...list].sort((a, b) => {
        // 1. Complaint Date descending (newest first)
        const aDate = a.complaint_date ?? "";
        const bDate = b.complaint_date ?? "";
        if (aDate !== bDate) {
          if (!aDate) return 1;
          if (!bDate) return -1;
          const dateComp = bDate.localeCompare(aDate);
          if (dateComp !== 0) return dateComp;
        }
        // 2. Complaint ID ascending
        return a.complaint_id.localeCompare(b.complaint_id);
      });
    }

    return [...list].sort((a, b) => {
      let comparison = 0;
      switch (complaintSortColumn) {
        case "complaint_id":
          comparison = a.complaint_id.localeCompare(b.complaint_id);
          break;
        case "case_id":
          comparison = a.case_id.localeCompare(b.case_id);
          break;
        case "customer": {
          const custA = customerById.get(a.customer_id)?.customer_name || "";
          const custB = customerById.get(b.customer_id)?.customer_name || "";
          comparison = custA.localeCompare(custB);
          break;
        }
        case "category": {
          const catA = caseById.get(a.case_id)?.category || "";
          const catB = caseById.get(b.case_id)?.category || "";
          comparison = catA.localeCompare(catB);
          break;
        }
        case "complaint_type":
          comparison = (a.complaint_type || "").localeCompare(
            b.complaint_type || "",
          );
          break;
        case "complaint_date":
          comparison = (a.complaint_date || "").localeCompare(
            b.complaint_date || "",
          );
          break;
        default:
          comparison = 0;
      }
      return complaintSortDirection === "asc" ? comparison : -comparison;
    });
  }, [
    filteredComplaints,
    tableCategoryFilter,
    tableTypeFilter,
    complaintSortColumn,
    complaintSortDirection,
    caseById,
    customerById,
  ]);

  if (showComplaintDetails) {
    return (
      <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">
                Complaint Details
              </h1>

              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                {formatNumber(displayedComplaints.length)} Complaints
              </span>
            </div>

            <p className="mt-1 text-xs text-slate-500">
              Individual complaints matching the current global filters.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowComplaintDetails(false)}
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
                  <th
                    scope="col"
                    onClick={() => handleComplaintSort("complaint_id")}
                    className="cursor-pointer whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600 transition hover:text-slate-900 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Complaint ID
                      {complaintSortColumn === "complaint_id" && (
                        <span>
                          {complaintSortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </span>
                  </th>
                  <th
                    scope="col"
                    onClick={() => handleComplaintSort("case_id")}
                    className="cursor-pointer whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600 transition hover:text-slate-900 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Case ID
                      {complaintSortColumn === "case_id" && (
                        <span>
                          {complaintSortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </span>
                  </th>
                  <th
                    scope="col"
                    onClick={() => handleComplaintSort("customer")}
                    className="cursor-pointer whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600 transition hover:text-slate-900 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Customer
                      {complaintSortColumn === "customer" && (
                        <span>
                          {complaintSortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </span>
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600"
                  >
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleComplaintSort("category")}
                        className="inline-flex items-center gap-0.5 font-semibold text-slate-600 transition hover:text-slate-900"
                      >
                        <span>Category</span>
                        {complaintSortColumn === "category" && (
                          <span>
                            {complaintSortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                      <div className="relative inline-flex items-center">
                        <select
                          value={tableCategoryFilter}
                          aria-label="Filter Category"
                          onChange={(e) =>
                            setTableCategoryFilter(e.target.value)
                          }
                          className="cursor-pointer appearance-none rounded border border-slate-300 bg-white py-0.5 pl-1.5 pr-4 text-[10px] font-medium text-slate-700 shadow-2xs hover:border-blue-400 focus:border-blue-500 focus:outline-none"
                        >
                          <option value="All">All</option>
                          <option value="Service Request">
                            Service Request
                          </option>
                          <option value="Vehicle Issue">Vehicle Issue</option>
                          <option value="Warranty Query">Warranty Query</option>
                        </select>
                        <svg
                          className="pointer-events-none absolute right-1 h-2.5 w-2.5 text-slate-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                        </svg>
                      </div>
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600"
                  >
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleComplaintSort("complaint_type")}
                        className="inline-flex items-center gap-0.5 font-semibold text-slate-600 transition hover:text-slate-900"
                      >
                        <span>Complaint Type</span>
                        {complaintSortColumn === "complaint_type" && (
                          <span>
                            {complaintSortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                      <div className="relative inline-flex items-center">
                        <select
                          value={tableTypeFilter}
                          aria-label="Filter Complaint Type"
                          onChange={(e) => setTableTypeFilter(e.target.value)}
                          className="cursor-pointer appearance-none rounded border border-slate-300 bg-white py-0.5 pl-1.5 pr-4 text-[10px] font-medium text-slate-700 shadow-2xs hover:border-blue-400 focus:border-blue-500 focus:outline-none"
                        >
                          <option value="All">All</option>
                          {availableComplaintTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <svg
                          className="pointer-events-none absolute right-1 h-2.5 w-2.5 text-slate-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                        </svg>
                      </div>
                    </div>
                  </th>
                  <th
                    scope="col"
                    onClick={() => handleComplaintSort("complaint_date")}
                    className="cursor-pointer whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-600 transition hover:text-slate-900 select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Complaint Date
                      {complaintSortColumn === "complaint_date" ? (
                        <span>
                          {complaintSortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      ) : (
                        <span className="text-slate-400">↓</span>
                      )}
                    </span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {displayedComplaints.map((complaint) => {
                  const customer = customerById.get(complaint.customer_id);
                  const serviceCase = caseById.get(complaint.case_id);
                  const category = serviceCase?.category || "Unknown";

                  return (
                    <tr
                      key={complaint.complaint_id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {complaint.complaint_id}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {complaint.case_id}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {customer?.customer_name ?? complaint.customer_id}
                      </td>

                      <td className="px-4 py-3 text-slate-700 font-medium">
                        {category}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {complaint.complaint_type}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {formatBusinessDate(complaint.complaint_date)}
                      </td>
                    </tr>
                  );
                })}

                {displayedComplaints.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-slate-500"
                    >
                      No complaints match the current filters.
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
              Customer Satisfaction &amp; Complaints
            </h1>

            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              Page 4
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Understand customer satisfaction, feedback patterns, and complaint
            drivers.
          </p>
        </div>
      </div>

      {/* =====================================================
          KPI ROW
          ===================================================== */}

      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <KPICard
          title="Average CSAT Score"
          value={averageCSAT > 0 ? averageCSAT.toFixed(2) : "—"}
          subtext={`${formatNumber(feedbackScores.length)} responses`}
          tooltip="Average customer satisfaction score across feedback responses"
          accentColor="blue"
          loading={loading}
        />

        <KPICard
          title="Feedback Response Count"
          value={formatNumber(filteredFeedback.length)}
          subtext="Customer feedback responses"
          tooltip="Total customer feedback responses matching current filters"
          accentColor="indigo"
          loading={loading}
        />

        <KPICard
          title="Positive Feedback"
          value={`${positiveFeedbackRate.toFixed(1)}%`}
          subtext={`${formatNumber(positiveFeedback)} positive responses`}
          tooltip="Positive feedback responses as a percentage of total feedback responses"
          accentColor="emerald"
          loading={loading}
        />

        <KPICard
          title="Negative Feedback"
          value={`${negativeFeedbackRate.toFixed(1)}%`}
          subtext={`${formatNumber(negativeFeedback)} negative responses`}
          tooltip="Negative feedback responses as a percentage of total feedback responses"
          accentColor="rose"
          loading={loading}
        />

        <KPICard
          title="Total Complaints"
          value={formatNumber(filteredComplaints.length)}
          subtext="Recorded complaints"
          tooltip="Total complaints matching current filters"
          accentColor="amber"
          loading={loading}
        />
      </div>

      {/* =====================================================
          ROW 1 — CSAT TREND + CSAT CATEGORY
          ===================================================== */}

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* CSAT Trend */}

        <ChartCard
          title="CSAT Trend"
          subtitle="Monthly average customer satisfaction score"
          height={320}
        >
          <MultiLineTrendChart
            labels={csatTrendData.labels}
            series={csatTrendData.series}
            valueFormatter={(value) => value.toFixed(2)}
            height={240}
          />
        </ChartCard>

        {/* CSAT by Category */}

        <ChartCard
          title="CSAT by Category"
          subtitle="Average satisfaction by service category · Drill: Category → Priority"
          height={320}
          action={
            categoryDrillPath.length > 0 ? (
              <button
                type="button"
                onClick={() => setCategoryDrillPath([])}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                ← Back
              </button>
            ) : undefined
          }
        >
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            {categoryDrillPath.length === 0 ? (
              <span className="font-semibold text-blue-700">
                Category → Priority
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategoryDrillPath([])}
                  className="font-semibold text-slate-600 hover:text-blue-700"
                >
                  Category
                </button>
                <span className="text-slate-300">→</span>
                <span className="font-semibold text-blue-700">
                  {categoryDrillPath[0]} (Priority)
                </span>
              </span>
            )}
          </div>

          <div className="h-[215px] overflow-y-auto pr-1">
            {categoryDrillPath.length === 0 ? (
              <div className="space-y-3">
                {categoryCSATData.map((row, index) => (
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
                        <span>{row.value.toFixed(2)}</span>
                      </span>
                    </div>

                    <div className="h-3 overflow-hidden rounded-md bg-slate-100">
                      <div
                        className="h-full rounded-md bg-blue-600 transition-all group-hover:bg-blue-700"
                        style={{
                          width: `${Math.min(100, (row.value / 5) * 100)}%`,
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
                {(() => {
                  const node = categoryPriorityHierarchy.get(
                    categoryDrillPath[0],
                  );

                  if (!node) {
                    return (
                      <p className="text-sm text-slate-500">
                        No priority data found.
                      </p>
                    );
                  }

                  const priorityNodes = [...node.children.values()].sort(
                    (a, b) => {
                      const avgA = a.count > 0 ? a.csatSum / a.count : 0;
                      const avgB = b.count > 0 ? b.csatSum / b.count : 0;
                      return avgB - avgA;
                    },
                  );

                  return priorityNodes.map((pNode) => {
                    const avg =
                      pNode.count > 0 ? pNode.csatSum / pNode.count : 0;

                    return (
                      <div key={pNode.label} className="group">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700">
                            {pNode.label} Priority
                          </span>

                          <span className="flex items-center gap-2 font-semibold text-slate-600">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                              {formatNumber(pNode.count)} responses
                            </span>
                            <span>{avg.toFixed(2)}</span>
                          </span>
                        </div>

                        <div className="h-3 overflow-hidden rounded-md bg-slate-100">
                          <div
                            className="h-full rounded-md bg-blue-600"
                            style={{
                              width: `${Math.min(100, (avg / 5) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </ChartCard>
      </div>

      {/* =====================================================
          ROW 2 — COMPLAINT TYPE RATE
          ===================================================== */}

      <div className="mb-5 grid grid-cols-1 gap-5">
        <ChartCard
          title="Complaint Type & Rate"
          subtitle="Distribution of complaints by complaint type · Rate = share of total complaints"
          height={340}
          action={
            <button
              type="button"
              onClick={() => setShowComplaintDetails(true)}
              title="View Complaint Details"
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
          <div className="h-[250px] overflow-y-auto pr-1">
            <HorizontalBarChart
              data={complaintTypeRateData}
              valueFormatter={(value) => `${value.toFixed(1)}%`}
              showRank={true}
            />
          </div>
        </ChartCard>
      </div>
    </DashboardLayout>
  );
}
