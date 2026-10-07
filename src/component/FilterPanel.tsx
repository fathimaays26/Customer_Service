import { useFilters } from "../context/FilterContext";
import DateRangeSlider from "./DateRangeSlider";
import { PENDING_AGE_BUCKETS, RESOLUTION_TIME_BUCKETS } from "../timeBuckets";

function Field({
  label,
  isActive,
  children,
}: {
  label: string;
  isActive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-semibold text-slate-600">
          {label}
        </label>

        {isActive && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
      </div>

      {children}
    </div>
  );
}

const selectBase =
  "w-full rounded-lg border bg-white px-3 py-2 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20";

export default function FilterPanel() {
  const { filters, setFilter, resetFilters, lookups, loadingLookups } =
    useFilters();

  const activeCount = Object.values(filters).filter(
    (value) => value !== null && value !== "",
  ).length;

  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 bg-slate-50/70 border-r border-slate-200/90 overflow-y-auto px-4 py-4 z-20 shadow-2xs">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-4 border-b border-slate-200/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Filters
          </span>

          {activeCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
              {activeCount}
            </span>
          )}
        </div>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
          >
            Reset all
          </button>
        )}
      </div>

      <div className="space-y-1">
        {/* 1. Region */}
        <Field label="Region" isActive={Boolean(filters.regionId)}>
          <select
            className={`${selectBase} ${
              filters.regionId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.regionId ?? ""}
            onChange={(event) =>
              setFilter("regionId", event.target.value || null)
            }
          >
            <option value="">All Regions</option>

            {lookups?.regions.map((region) => (
              <option key={region.region_id} value={region.region_id}>
                {region.region_name}
              </option>
            ))}
          </select>
        </Field>

        {/* 2. Application */}
        <Field label="Application" isActive={Boolean(filters.applicationId)}>
          <select
            className={`${selectBase} ${
              filters.applicationId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.applicationId ?? ""}
            onChange={(event) =>
              setFilter("applicationId", event.target.value || null)
            }
          >
            <option value="">All Applications</option>

            {lookups?.applications.map((application) => (
              <option
                key={application.application_id}
                value={application.application_id}
              >
                {application.application_name}
              </option>
            ))}
          </select>
        </Field>

        {/* 3. Model */}
        <Field label="Model" isActive={Boolean(filters.modelId)}>
          <select
            className={`${selectBase} ${
              filters.modelId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.modelId ?? ""}
            onChange={(event) =>
              setFilter("modelId", event.target.value || null)
            }
          >
            <option value="">All Models</option>

            {lookups?.models.map((model) => (
              <option key={model.model_id} value={model.model_id}>
                {model.model_name}
              </option>
            ))}
          </select>
        </Field>

        {/* 4. Variant */}
        <Field label="Variant" isActive={Boolean(filters.variant)}>
          <select
            className={`${selectBase} ${
              filters.variant
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.variant ?? ""}
            onChange={(event) =>
              setFilter("variant", event.target.value || null)
            }
          >
            <option value="">All Variants</option>

            {lookups?.variants.map((variant) => (
              <option key={variant} value={variant}>
                {variant}
              </option>
            ))}
          </select>
        </Field>

        {/* 5. Vehicle Type */}
        <Field label="Vehicle Type" isActive={Boolean(filters.vehicleType)}>
          <select
            className={`${selectBase} ${
              filters.vehicleType
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.vehicleType ?? ""}
            onChange={(event) =>
              setFilter("vehicleType", event.target.value || null)
            }
          >
            <option value="">All Vehicle Types</option>

            {lookups?.vehicleTypes.map((vehicleType) => (
              <option key={vehicleType} value={vehicleType}>
                {vehicleType}
              </option>
            ))}
          </select>
        </Field>

        {/* 6. Customer Type */}
        <Field label="Customer Type" isActive={Boolean(filters.customerType)}>
          <select
            className={`${selectBase} ${
              filters.customerType
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.customerType ?? ""}
            onChange={(event) =>
              setFilter("customerType", event.target.value || null)
            }
          >
            <option value="">All Customer Types</option>
            {lookups?.customerTypes.map((customerType) => (
              <option key={customerType} value={customerType}>
                {customerType}
              </option>
            ))}
          </select>
        </Field>

        {/* 7. Channel */}
        <Field label="Channel" isActive={Boolean(filters.channel)}>
          <select
            className={`${selectBase} ${
              filters.channel
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.channel ?? ""}
            onChange={(event) =>
              setFilter("channel", event.target.value || null)
            }
          >
            <option value="">All Channels</option>

            {lookups?.channels.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </Field>

        {/* 8. Priority */}
        <Field label="Priority" isActive={Boolean(filters.priority)}>
          <select
            className={`${selectBase} ${
              filters.priority
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.priority ?? ""}
            onChange={(event) =>
              setFilter("priority", event.target.value || null)
            }
          >
            <option value="">All Priorities</option>

            {lookups?.priorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </Field>

        {/* 9. Case Status */}
        <Field label="Case Status" isActive={Boolean(filters.caseStatus)}>
          <select
            className={`${selectBase} ${
              filters.caseStatus
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.caseStatus ?? ""}
            onChange={(event) =>
              setFilter("caseStatus", event.target.value || null)
            }
          >
            <option value="">All Case Statuses</option>

            {lookups?.caseStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>

        {/* 10. Category */}
        <Field label="Category" isActive={Boolean(filters.category)}>
          <select
            className={`${selectBase} ${
              filters.category
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.category ?? ""}
            onChange={(event) =>
              setFilter("category", event.target.value || null)
            }
          >
            <option value="">All Categories</option>

            {lookups?.caseCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Pending Case Ageing"
          isActive={Boolean(filters.pendingAgeBucket)}
        >
          <select
            className={`${selectBase} ${
              filters.pendingAgeBucket
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            value={filters.pendingAgeBucket ?? ""}
            onChange={(event) =>
              setFilter("pendingAgeBucket", event.target.value || null)
            }
          >
            <option value="">All Pending Case Ages</option>
            {PENDING_AGE_BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Resolution Time Distribution"
          isActive={Boolean(filters.resolutionTimeBucket)}
        >
          <select
            className={`${selectBase} ${
              filters.resolutionTimeBucket
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            value={filters.resolutionTimeBucket ?? ""}
            onChange={(event) =>
              setFilter("resolutionTimeBucket", event.target.value || null)
            }
          >
            <option value="">All Resolution Times</option>
            {RESOLUTION_TIME_BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* 11. Date Filter */}
      <div className="mt-5 pt-3 border-t border-slate-200/80">
        <DateRangeSlider
          startDate={filters.startDate}
          endDate={filters.endDate}
          minDateStr="2025-01-01"
          maxDateStr="2026-12-31"
          onChange={(start, end) => {
            setFilter("startDate", start);
            setFilter("endDate", end);
          }}
        />
      </div>
    </aside>
  );
}
