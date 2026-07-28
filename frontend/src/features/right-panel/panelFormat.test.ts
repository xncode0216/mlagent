import { describe, expect, it } from "vitest";

import {
  activeFileReadError,
  artifactNameFromPath,
  BINARY_PREVIEW_MESSAGE,
  formatFileSize,
  formatHoldoutStrategy,
  formatMetricCount,
  formatMetricPercent,
  formatPanelFilename,
  formatSampleValue,
  perClassRows,
  previewArtifactType,
  previewTabForPath,
} from "./panelFormat";

describe("metric formatting", () => {
  it("renders a ratio as a two-decimal percentage", () => {
    expect(formatMetricPercent(0.8125)).toBe("81.25%");
    expect(formatMetricPercent(0)).toBe("0.00%");
  });

  it("falls back to a dash when a metric is absent", () => {
    expect(formatMetricPercent(undefined)).toBe("-");
    expect(formatMetricCount(undefined)).toBe("-");
  });

  it("keeps a zero count visible instead of treating it as missing", () => {
    expect(formatMetricCount(0)).toBe("0");
  });

  it("names the known holdout strategies and passes through unknown ones", () => {
    expect(formatHoldoutStrategy("stratified_holdout")).toBe("Stratified holdout");
    expect(formatHoldoutStrategy("resubstitution_small_dataset")).toBe("Small dataset reuse");
    expect(formatHoldoutStrategy("custom_split")).toBe("custom_split");
    expect(formatHoldoutStrategy(undefined)).toBe("-");
  });
});

describe("sample value formatting", () => {
  it("treats null, undefined and empty string as no value", () => {
    expect(formatSampleValue(null)).toBe("-");
    expect(formatSampleValue(undefined)).toBe("-");
    expect(formatSampleValue("")).toBe("-");
  });

  it("keeps integers exact and rounds floats to four decimals", () => {
    expect(formatSampleValue(42)).toBe("42");
    expect(formatSampleValue(0.123456)).toBe("0.1235");
  });

  it("shows a zero rather than hiding it as missing", () => {
    expect(formatSampleValue(0)).toBe("0");
  });
});

describe("per-class rows", () => {
  it("sorts classes by label so the table order is stable", () => {
    const rows = perClassRows({
      accuracy: 0.9,
      per_class: {
        yes: { precision: 0.8 },
        no: { precision: 0.95 },
      },
    });

    expect(rows.map(([label]) => label)).toEqual(["no", "yes"]);
  });

  it("returns nothing when the run has no per-class metrics", () => {
    expect(perClassRows(undefined)).toEqual([]);
  });
});

describe("path-driven preview routing", () => {
  it("routes data files to the data tab and everything else to code", () => {
    expect(previewTabForPath("results/train.csv")).toBe("数据");
    expect(previewTabForPath("results/metrics.json")).toBe("数据");
    expect(previewTabForPath("notebooks/pipeline.py")).toBe("代码");
    expect(previewTabForPath("reports/summary.md")).toBe("代码");
  });

  it("classifies artifact types by extension", () => {
    expect(previewArtifactType("data/raw.csv")).toBe("dataframe");
    expect(previewArtifactType("data/profile.json")).toBe("dataframe");
    expect(previewArtifactType("src/pipeline.py")).toBe("code");
    expect(previewArtifactType("reports/report.md")).toBe("report");
  });

  it("is case-insensitive about extensions", () => {
    expect(previewArtifactType("data/RAW.CSV")).toBe("dataframe");
    expect(previewTabForPath("data/RAW.CSV")).toBe("数据");
  });

  it("takes the basename as the artifact name", () => {
    expect(artifactNameFromPath("results/session-1/metrics.json")).toBe("metrics.json");
    expect(artifactNameFromPath("metrics.json")).toBe("metrics.json");
  });
});

describe("active file read errors", () => {
  it("turns a 415 into the binary notice so the preview can offer a download", () => {
    expect(activeFileReadError(new Error("415 Unsupported Media Type"))).toBe(BINARY_PREVIEW_MESSAGE);
  });

  it("passes other messages through unchanged", () => {
    expect(activeFileReadError(new Error("404 not found"))).toBe("404 not found");
  });

  it("falls back to a readable message for a non-Error rejection", () => {
    expect(activeFileReadError("boom")).toBe("文件读取失败");
  });

  it("reports no error when there is none", () => {
    expect(activeFileReadError(null)).toBeNull();
    expect(activeFileReadError(undefined)).toBeNull();
  });
});

describe("file size formatting", () => {
  it("switches unit at the kilobyte and megabyte boundaries", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("falls back to a dash when the size is unknown", () => {
    expect(formatFileSize(undefined)).toBe("-");
  });
});

describe("panel export filename", () => {
  it("keeps the name filesystem-safe and json-suffixed", () => {
    const filename = formatPanelFilename("训练");

    expect(filename.startsWith("mlagent-")).toBe(true);
    expect(filename.endsWith(".json")).toBe(true);
    expect(filename).not.toMatch(/[:\s]/);
  });

  it("falls back to a generic label when nothing safe remains", () => {
    expect(formatPanelFilename("///")).toMatch(/^mlagent-panel-/);
  });
});
