import { memo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { buildHistogramSeries, type HistogramBin } from "./histogramSeries";

type Props = {
  bins: readonly HistogramBin[];
  column?: string;
};

const AXIS_TICK = { fill: "#6c7086", fontSize: 10 };

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
          <CartesianGrid stroke="#313244" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            stroke="#45475a"
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis tick={AXIS_TICK} stroke="#45475a" allowDecimals={false} width={34} />
          <Tooltip
            cursor={{ fill: "rgba(137, 180, 250, 0.12)" }}
            contentStyle={{
              background: "#11111b",
              border: "1px solid #313244",
              borderRadius: 8,
              color: "#cdd6f4",
              fontSize: 12,
            }}
            labelStyle={{ color: "#a6adc8" }}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.range ?? String(label)}
          />
          <Bar dataKey="count" name="计数" fill="#89b4fa" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default HistogramChart;
