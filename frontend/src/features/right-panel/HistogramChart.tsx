import { memo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { buildHistogramSeries, type HistogramBin } from "./histogramSeries";

type Props = {
  bins: readonly HistogramBin[];
  column?: string;
};

const AXIS_TICK = { fill: "var(--color-text-muted)", fontSize: 10 };

/**
 * Real distribution histogram (Recharts) replacing the hand-built div bars.
 * Lazy-loaded from RightPanel so Recharts stays out of the initial bundle until
 * a histogram artifact is opened.
 */
export const HistogramChart = memo(function HistogramChart({ bins, column }: Props) {
  const data = buildHistogramSeries(bins);

  return (
    <div className="histogram-chart" role="img" aria-label={`${column || "字段"} 分布直方图`}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            stroke="var(--color-border-strong)"
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis tick={AXIS_TICK} stroke="var(--color-border-strong)" allowDecimals={false} width={34} />
          <Tooltip
            cursor={{ fill: "rgb(var(--rgb-accent) / 0.12)" }}
            contentStyle={{
              background: "var(--color-bg-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              color: "var(--color-text)",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--color-text-subtle)" }}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.range ?? String(label)}
          />
          <Bar dataKey="count" name="计数" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default HistogramChart;
