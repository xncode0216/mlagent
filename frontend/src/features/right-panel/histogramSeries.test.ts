import { describe, expect, it } from "vitest";

import { buildHistogramSeries } from "./histogramSeries";

describe("buildHistogramSeries", () => {
  it("returns nothing for no bins", () => {
    expect(buildHistogramSeries([])).toEqual([]);
  });

  it("maps each bin to a count and a labelled range", () => {
    const series = buildHistogramSeries([
      { start: 0, end: 1.5, count: 42 },
      { start: 1.5, end: 3, count: 18 },
    ]);

    expect(series).toEqual([
      { label: "0", count: 42, range: "0 – 1.50" },
      { label: "1.50", count: 18, range: "1.50 – 3" },
    ]);
  });

  it("defaults missing fields to zero instead of NaN", () => {
    const series = buildHistogramSeries([{}]);
    expect(series[0]).toEqual({ label: "0", count: 0, range: "0 – 0" });
  });

  it("keeps large integer bounds readable but uses scientific notation otherwise", () => {
    expect(buildHistogramSeries([{ start: 25000, end: 0.001, count: 3 }])[0].range).toBe(
      "25000 – 1.0e-3",
    );
    expect(buildHistogramSeries([{ start: 25000.5, end: 0.5, count: 3 }])[0].range).toBe(
      "2.5e+4 – 0.50",
    );
  });
});
