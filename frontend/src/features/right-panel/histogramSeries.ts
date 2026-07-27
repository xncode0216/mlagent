export type HistogramBin = {
  start?: number;
  end?: number;
  count?: number;
};

export type HistogramDatum = {
  /** Short X-axis tick (the bin's lower bound). */
  label: string;
  /** Bar height. */
  count: number;
  /** Full "start – end" range for the tooltip. */
  range: string;
};

function formatBound(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 10000 || abs < 0.01)) return value.toExponential(1);
  return value.toFixed(2);
}

/**
 * Shape profiling histogram bins into chart-ready rows. Pure so it can be unit
 * tested without rendering Recharts (which needs layout it does not get in jsdom).
 */
export function buildHistogramSeries(bins: readonly HistogramBin[]): HistogramDatum[] {
  return bins.map((bin) => {
    const start = Number(bin.start ?? 0);
    const end = Number(bin.end ?? 0);
    const count = Number(bin.count ?? 0);
    return {
      label: formatBound(start),
      count: Number.isFinite(count) ? count : 0,
      range: `${formatBound(start)} – ${formatBound(end)}`,
    };
  });
}
