import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

export interface HorizontalBarItem {
  label: string;
  value: number;
  secondaryLabel?: string;
  color?: string;
}

interface HorizontalBarChartProps {
  data: HorizontalBarItem[];
  valueFormatter?: (val: number) => string;
  height?: number | string;
  maxVal?: number;
  emptyMessage?: string;
  barColor?: string;
  showRank?: boolean;
  onBarClick?: (label: string) => void;
}

export default function HorizontalBarChart({
  data,
  valueFormatter = (v) => formatNumber(v),
  height = "auto",
  maxVal,
  emptyMessage = "No data available",
  barColor = "bg-blue-600",
  showRank = true,
  onBarClick,
}: HorizontalBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const computedMax = useMemo(() => {
    if (typeof maxVal === "number" && maxVal > 0) return maxVal;
    const highest = Math.max(...data.map((d) => d.value), 0);
    return highest > 0 ? highest : 1;
  }, [data, maxVal]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="w-full space-y-3.5" style={{ height }}>
      {data.map((item, idx) => {
        const pct = Math.min(
          100,
          Math.max(0, (item.value / computedMax) * 100),
        );
        const isHovered = hoveredIdx === idx;

        return (
          <div
            key={item.label + idx}
            className={`group relative${
              onBarClick ? " cursor-pointer" : ""
            }`}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={
              onBarClick
                ? () => onBarClick(item.label)
                : undefined
            }
            onKeyDown={
              onBarClick
                ? (event) => {
                    if (
                      event.key === "Enter" ||
                      event.key === " "
                    ) {
                      event.preventDefault();
                      onBarClick(item.label);
                    }
                  }
                : undefined
            }
            role={onBarClick ? "button" : undefined}
            tabIndex={onBarClick ? 0 : undefined}
          >
            {/* Top row: Label + Values */}
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0 max-w-[70%]">
                {showRank && (
                  <span
                    className={`h-4.5 w-4.5 shrink-0 rounded flex items-center justify-center text-[10px] font-bold ${
                      idx === 0
                        ? "bg-amber-100 text-amber-800 border border-amber-300"
                        : idx === 1
                          ? "bg-slate-200 text-slate-700"
                          : idx === 2
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {idx + 1}
                  </span>
                )}
                <span className="font-semibold text-slate-800 truncate">
                  {item.label}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {item.secondaryLabel && (
                  <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    {item.secondaryLabel}
                  </span>
                )}
                <span className="font-bold tabular-nums text-slate-900 text-xs">
                  {valueFormatter(item.value)}
                </span>
              </div>
            </div>

            {/* Track + Fill */}
            <div className="h-3.5 w-full rounded-md bg-slate-100 overflow-hidden relative">
              <div
                className={`h-full rounded-md transition-all duration-500 ease-out ${
                  item.color || barColor
                } ${isHovered ? "brightness-110 shadow-xs" : ""}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
