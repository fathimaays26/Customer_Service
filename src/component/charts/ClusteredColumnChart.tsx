import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

export interface ColumnGroupItem {
  category: string;
  series: {
    name: string;
    value: number;
    color?: string;
  }[];
}

interface ClusteredColumnChartProps {
  data: ColumnGroupItem[];
  valueFormatter?: (val: number) => string;
  height?: number;
  emptyMessage?: string;
  showLegend?: boolean;
  benchmark?: { value: number; label: string };
  unit?: string;
}

const DEFAULT_SERIES_COLORS = [
  "bg-blue-600",
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-purple-500",
];

export default function ClusteredColumnChart({
  data,
  valueFormatter = (v) => formatNumber(v),
  height = 260,
  emptyMessage = "No data available",
  showLegend = true,
  benchmark,
}: ClusteredColumnChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<{
    catIdx: number;
    serIdx: number;
  } | null>(null);

  const seriesNames = useMemo(() => {
    const names = new Set<string>();

    for (const d of data) {
      for (const s of d.series) {
        names.add(s.name);
      }
    }

    return Array.from(names);
  }, [data]);

  const { minVal, maxVal } = useMemo(() => {
    let min = 0;
    let max = 0;

    for (const d of data) {
      for (const s of d.series) {
        if (s.value < min) min = s.value;
        if (s.value > max) max = s.value;
      }
    }

    if (benchmark) {
      if (benchmark.value > max) max = benchmark.value;
      if (benchmark.value < min) min = benchmark.value;
    }

    if (min === 0 && max === 0) {
      max = 1;
    }

    // Keep enough headroom for value labels.
    const rangeHeadroom = (max - min) * 0.15 || 1;

    return {
      minVal: min < 0 ? min - rangeHeadroom : 0,
      maxVal: max + rangeHeadroom,
    };
  }, [data, benchmark]);

  const totalRange = maxVal - minVal || 1;
  const zeroLinePct =
    minVal < 0
      ? ((0 - minVal) / totalRange) * 100
      : 0;

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  const gridTicks = [1, 0.75, 0.5, 0.25, 0];

  /*
   * Reserve a dedicated row for the category labels.
   * This prevents the X-axis labels from being positioned
   * inside the plotting area.
   */
  const labelAreaHeight = 28;
  const plotHeight = Math.max(height - labelAreaHeight, 120);

  return (
    <div className="w-full">
      {/* Legend & Benchmark */}
      {((showLegend && seriesNames.length > 1) || benchmark) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-2 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            {seriesNames.map((name, i) => (
              <div
                key={name}
                className="flex items-center gap-1.5"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-xs ${
                    DEFAULT_SERIES_COLORS[
                      i % DEFAULT_SERIES_COLORS.length
                    ]
                  }`}
                />

                <span className="font-semibold text-slate-700">
                  {name}
                </span>
              </div>
            ))}
          </div>

          {benchmark && (
            <div className="flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-0.5">
              <span className="h-0.5 w-3 bg-rose-500" />

              <span className="text-[11px] font-semibold text-rose-700">
                {benchmark.label} (
                {valueFormatter(benchmark.value)})
              </span>
            </div>
          )}
        </div>
      )}

      {/* Chart + dedicated X-axis */}
      <div
        className="w-full"
        style={{ height }}
      >
        {/* Plot area */}
        <div
          className="relative w-full"
          style={{ height: plotHeight }}
        >
          {/* Background grid */}
          <div className="pointer-events-none absolute inset-0">
            {gridTicks.map((pct) => (
              <div
                key={pct}
                className="absolute left-0 right-0 border-b border-slate-100"
                style={{
                  bottom: `${pct * 100}%`,
                }}
              >
                <span className="absolute right-0 -top-2.5 pr-1 text-[10px] tabular-nums text-slate-400">
                  {valueFormatter(
                    minVal + pct * totalRange,
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Benchmark line */}
          {benchmark && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-dashed border-rose-500/80"
              style={{
                bottom: `${
                  ((benchmark.value - minVal) /
                    totalRange) *
                  100
                }%`,
              }}
            />
          )}

          {/* Zero baseline */}
          {minVal < 0 && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-10 border-b-2 border-slate-300"
              style={{
                bottom: `${zeroLinePct}%`,
              }}
            />
          )}

          {/* Bars */}
          <div className="absolute inset-0 flex items-end gap-2 px-2 sm:gap-4">
            {data.map((group, catIdx) => (
              <div
                key={group.category}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <div className="flex h-full w-full items-end justify-center gap-1.5">
                  {group.series.map((s, serIdx) => {
                    const isHovered =
                      hoveredIdx?.catIdx === catIdx &&
                      hoveredIdx?.serIdx === serIdx;

                    const isPositive = s.value >= 0;

                    const barHeightPct =
                      (Math.abs(s.value) /
                        totalRange) *
                      100;

                    const color =
                      s.color ||
                      DEFAULT_SERIES_COLORS[
                        serIdx %
                          DEFAULT_SERIES_COLORS.length
                      ];

                    return (
                      <div
                        key={s.name}
                        className="relative flex h-full max-w-[56px] flex-1 cursor-pointer flex-col items-center justify-end"
                        onMouseEnter={() =>
                          setHoveredIdx({
                            catIdx,
                            serIdx,
                          })
                        }
                        onMouseLeave={() =>
                          setHoveredIdx(null)
                        }
                      >
                        {/* Value label */}
                        <span
                          className={`pointer-events-none absolute text-[10px] font-bold tabular-nums transition-all duration-200 ${
                            isHovered
                              ? "-translate-y-0.5 scale-105 text-blue-700"
                              : "text-slate-700"
                          }`}
                          style={{
                            bottom: `${Math.min(
                              barHeightPct + 1.5,
                              96,
                            )}%`,
                          }}
                        >
                          {valueFormatter(s.value)}
                        </span>

                        {/* Bar */}
                        <div
                          className={`w-full rounded-t-md shadow-xs transition-all duration-300 ${color} ${
                            isHovered
                              ? "brightness-110 ring-2 ring-blue-400 ring-offset-1"
                              : "hover:brightness-105"
                          }`}
                          style={{
                            height: `${Math.max(
                              barHeightPct,
                              1.5,
                            )}%`,
                            minHeight: "4px",
                            marginBottom:
                              minVal < 0 && isPositive
                                ? `${zeroLinePct}%`
                                : undefined,
                          }}
                        />

                        {/* Tooltip */}
                        {isHovered && (
                          <div className="absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-xl pointer-events-none">
                            <div className="font-semibold text-slate-200">
                              {group.category}
                            </div>

                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="text-slate-400">
                                {s.name}:
                              </span>

                              <span className="font-bold text-white">
                                {valueFormatter(s.value)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dedicated X-axis labels */}
        <div className="flex h-7 items-start gap-2 px-2 sm:gap-4">
          {data.map((group) => (
            <div
              key={group.category}
              className="min-w-0 flex-1 text-center"
            >
              <span
                className="block truncate px-1 text-[11px] font-semibold leading-5 text-slate-600"
                title={group.category}
              >
                {group.category}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}