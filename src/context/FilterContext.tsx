import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../supabaseClient";

import type {
  DimApplication,
  DimCustomer,
  DimRegion,
  DimVModel,
  DimensionLookups,
  GlobalFilters,
} from "../index";

import { EMPTY_FILTERS } from "../index";

interface FilterContextValue {
  filters: GlobalFilters;

  setFilter: <K extends keyof GlobalFilters>(
    key: K,
    value: GlobalFilters[K],
  ) => void;

  resetFilters: () => void;

  lookups: DimensionLookups | null;
  loadingLookups: boolean;

  matchingModelIds: string[] | null;
  matchingCustomerIds: string[] | null;
}

const FilterContext = createContext<FilterContextValue | undefined>(
  undefined,
);

export function FilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [filters, setFilters] =
    useState<GlobalFilters>(EMPTY_FILTERS);

  const [lookups, setLookups] =
    useState<DimensionLookups | null>(null);

  const [loadingLookups, setLoadingLookups] =
    useState(true);

  useEffect(() => {
    async function loadLookups() {
      setLoadingLookups(true);

      if (!supabase) {
        setLookups(null);
        setLoadingLookups(false);
        return;
      }

      const [
        regionsRes,
        modelsRes,
        customersRes,
        applicationsRes,
        serviceCasesRes,
        feedbackRes,
        complaintsRes,
      ] = await Promise.all([
        supabase
          .from("dim_region")
          .select("region_id, region_name, state, country"),

        supabase
          .from("dim_v_model")
          .select(
            "model_id, model_name, variant, vehicle_type",
          ),

        supabase
          .from("dim_customer")
          .select(
            "customer_id, customer_name, customer_type, region_id",
          ),

        supabase
          .from("dim_application")
          .select(
            "application_id, application_name, sub_application_name",
          ),

        supabase
          .from("fact_service_case")
          .select(
            "channel, priority, status, category",
          ),

        supabase
          .from("fact_customer_feedback")
          .select("feedback_type"),

        supabase
          .from("fact_complaints")
          .select("complaint_type"),
      ]);

      const regions =
        (regionsRes.data ?? []) as DimRegion[];

      const models =
        (modelsRes.data ?? []) as DimVModel[];

      const customers =
        (customersRes.data ?? []) as DimCustomer[];

      /*
       * Real dim_application rows, sorted by id so the
       * Application filter options are stable.
       */
      const applications = (
        (applicationsRes.data ?? []) as DimApplication[]
      ).slice().sort((a, b) =>
        a.application_id.localeCompare(b.application_id),
      );

      const uniqueStrings = (
        values: unknown[],
      ): string[] =>
        Array.from(
          new Set(
            values.filter(
              (value): value is string =>
                typeof value === "string" &&
                value.trim().length > 0,
            ),
          ),
        ).sort();

      const channels = uniqueStrings(
        (serviceCasesRes.data ?? []).map(
          (item) => item?.channel,
        ),
      );

      const priorities = uniqueStrings(
        (serviceCasesRes.data ?? []).map(
          (item) => item?.priority,
        ),
      );

      const caseStatuses = uniqueStrings(
        (serviceCasesRes.data ?? []).map(
          (item) => item?.status,
        ),
      );

      const caseCategories = uniqueStrings(
        (serviceCasesRes.data ?? []).map(
          (item) => item?.category,
        ),
      );

      const feedbackTypes = uniqueStrings(
        (feedbackRes.data ?? []).map(
          (item) => item?.feedback_type,
        ),
      );

      const complaintTypes = uniqueStrings(
        (complaintsRes.data ?? []).map(
          (item) => item?.complaint_type,
        ),
      );

      const variants = uniqueStrings(
        models.map((model) => model.variant),
      );

      const vehicleTypes = uniqueStrings(
        models.map((model) => model.vehicle_type),
      );

      const customerTypes = uniqueStrings(
        customers.map(
          (customer) => customer.customer_type,
        ),
      );

      setLookups({
        regions,
        models,
        applications,

        regionsById: new Map(
          regions.map((region) => [
            region.region_id,
            region,
          ]),
        ),

        modelsById: new Map(
          models.map((model) => [
            model.model_id,
            model,
          ]),
        ),

        customersById: new Map(
          customers.map((customer) => [
            customer.customer_id,
            customer,
          ]),
        ),

        variants,
        vehicleTypes,
        customerTypes,

        channels,
        priorities,
        caseStatuses,
        caseCategories,
        feedbackTypes,
        complaintTypes,
      });

      setLoadingLookups(false);
    }

    void loadLookups();
  }, []);

  const setFilter: FilterContextValue["setFilter"] = (
    key,
    value,
  ) => {
    setFilters((previousFilters) => ({
      ...previousFilters,
      [key]: value,
    }));
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
  };

  /*
   * Models matching the current Model / Variant /
   * Vehicle Type filters.
   */
  const matchingModelIds = useMemo(() => {
    if (!lookups) return null;

    const { modelId, variant, vehicleType } = filters;

    if (!modelId && !variant && !vehicleType) {
      return null;
    }

    return lookups.models
      .filter((model) =>
        modelId
          ? model.model_id === modelId
          : true,
      )
      .filter((model) =>
        variant
          ? model.variant === variant
          : true,
      )
      .filter((model) =>
        vehicleType
          ? model.vehicle_type === vehicleType
          : true,
      )
      .map((model) => model.model_id);
  }, [
    lookups,
    filters.modelId,
    filters.variant,
    filters.vehicleType,
  ]);

  /*
   * Customers matching the current Customer Type /
   * Region filters.
   */
  const matchingCustomerIds = useMemo(() => {
    if (!lookups) return null;

    const { customerType, regionId } = filters;

    if (!customerType && !regionId) {
      return null;
    }

    return Array.from(
      lookups.customersById.values(),
    )
      .filter((customer) =>
        customerType
          ? customer.customer_type === customerType
          : true,
      )
      .filter((customer) =>
        regionId
          ? customer.region_id === regionId
          : true,
      )
      .map((customer) => customer.customer_id);
  }, [
    lookups,
    filters.customerType,
    filters.regionId,
  ]);

  return (
    <FilterContext.Provider
      value={{
        filters,
        setFilter,
        resetFilters,
        lookups,
        loadingLookups,
        matchingModelIds,
        matchingCustomerIds,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(FilterContext);

  if (!context) {
    throw new Error(
      "useFilters must be used within a FilterProvider",
    );
  }

  return context;
}

export { EMPTY_FILTERS };
export type {
  GlobalFilters,
  DimensionLookups,
};