import type { FactServiceCase } from "./index";

export const PENDING_AGE_BUCKETS = [
  "0–30 Days",
  "31–60 Days",
  "61–90 Days",
  "90+ Days",
] as const;

export const RESOLUTION_TIME_BUCKETS = [
  "0–1 days",
  "1–2 days",
  "2–3 days",
  "3–5 days",
  "5+ days",
] as const;

export function getPendingAgeDays(openDate: string | null | undefined) {
  if (!openDate) return 0;

  const opened = new Date(openDate).getTime();
  if (Number.isNaN(opened)) return 0;

  return Math.max(0, (Date.now() - opened) / (1000 * 60 * 60 * 24));
}

export function getPendingAgeBucket(ageDays: number) {
  if (ageDays <= 30) return "0–30 Days";
  if (ageDays <= 60) return "31–60 Days";
  if (ageDays <= 90) return "61–90 Days";
  return "90+ Days";
}

export function getHoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
) {
  if (!start || !end) return 0;

  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) {
    return 0;
  }

  return (endTime - startTime) / (1000 * 60 * 60);
}

export function getResolutionHours(
  serviceCase: Pick<FactServiceCase, "open_datetime" | "resolution_datetime">,
) {
  return getHoursBetween(
    serviceCase.open_datetime,
    serviceCase.resolution_datetime,
  );
}

export function getResolutionTimeBucket(hours: number) {
  if (hours <= 24) return "0–1 days";
  if (hours <= 48) return "1–2 days";
  if (hours <= 72) return "2–3 days";
  if (hours <= 120) return "3–5 days";
  return "5+ days";
}

export function matchesServiceCaseTimeBuckets(
  serviceCase: FactServiceCase,
  pendingAgeBucket: string | null,
  resolutionTimeBucket: string | null,
) {
  if (pendingAgeBucket) {
    const status = (serviceCase.status ?? "").trim().toLowerCase();
    if (status === "resolved" || status === "closed") return false;

    if (
      getPendingAgeBucket(getPendingAgeDays(serviceCase.open_datetime)) !==
      pendingAgeBucket
    ) {
      return false;
    }
  }

  if (resolutionTimeBucket) {
    const status = (serviceCase.status ?? "").trim().toLowerCase();
    if (status !== "resolved" && status !== "closed") return false;

    const hours = getResolutionHours(serviceCase);
    if (hours <= 0 || getResolutionTimeBucket(hours) !== resolutionTimeBucket) {
      return false;
    }
  }

  return true;
}
