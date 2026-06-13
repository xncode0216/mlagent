import type { ExperimentRun, TrainingMetric } from "../../lib/api";
import type { ErrorSlice } from "./errorSlices";

export type ExperimentRunFilter = "all" | "sklearn" | "baseline" | "gpu" | "focused";
export type ExperimentRunSort = "newest" | "accuracy" | "f1" | "evalRows";
export type CandidateRunView = "all" | "best";
export type CandidateRunSort = "accuracy" | "f1" | "evalRows" | "model";
export type PredictionSampleStatusFilter = "all" | "errors";

export type PredictionSample = {
  row_index?: number | string;
  actual?: string | number | null;
  predicted?: string | number | null;
  is_error?: boolean;
  features?: Record<string, unknown>;
};

export type PredictionSampleFilter = {
  status: PredictionSampleStatusFilter;
  actual: string;
  predicted: string;
  query: string;
};

export type PredictionSampleOptions = {
  actualLabels: string[];
  predictedLabels: string[];
};

export type TrainingDiagnosticSummary = {
  worstClass: string | null;
  mainConfusion: string | null;
  errorCount: number;
  recommendation: string;
};

type CandidateRun = ExperimentRun["candidate_runs"][number];

function metricValue(metrics: TrainingMetric, key: "accuracy" | "f1" | "evalRows") {
  if (key === "accuracy") return metrics.accuracy ?? -1;
  if (key === "f1") return metrics.f1_weighted ?? -1;
  return metrics.eval_row_count ?? metrics.row_count ?? -1;
}

function sampleValue(value: unknown) {
  return value === null || typeof value === "undefined" ? "" : String(value);
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

export function filterAndSortExperimentRuns(
  runs: ExperimentRun[],
  options: { filter: ExperimentRunFilter; sort: ExperimentRunSort; focusedExperimentId?: string | null },
) {
  const filtered = runs.filter((run) => {
    if (options.filter === "sklearn") return run.engine === "sklearn";
    if (options.filter === "baseline") return run.engine === "baseline";
    if (options.filter === "gpu") return run.use_gpu;
    if (options.filter === "focused") return Boolean(options.focusedExperimentId && run.experiment_id === options.focusedExperimentId);
    return true;
  });

  return [...filtered].sort((left, right) => {
    if (options.sort === "newest") {
      return Date.parse(right.created_at || "") - Date.parse(left.created_at || "");
    }
    return metricValue(right.metrics, options.sort) - metricValue(left.metrics, options.sort);
  });
}

export function filterAndSortCandidateRuns(
  candidates: CandidateRun[],
  options: { view: CandidateRunView; sort: CandidateRunSort; bestModelName?: string },
) {
  const filtered =
    options.view === "best" && options.bestModelName
      ? candidates.filter((candidate) => candidate.model_name === options.bestModelName)
      : candidates;

  return [...filtered].sort((left, right) => {
    if (options.sort === "model") return compareText(left.model_name, right.model_name);
    return metricValue(right.metrics, options.sort) - metricValue(left.metrics, options.sort);
  });
}

export function predictionSampleOptions(samples: PredictionSample[]): PredictionSampleOptions {
  return {
    actualLabels: Array.from(new Set(samples.map((sample) => sampleValue(sample.actual)).filter(Boolean))).sort(compareText),
    predictedLabels: Array.from(new Set(samples.map((sample) => sampleValue(sample.predicted)).filter(Boolean))).sort(compareText),
  };
}

export function filterPredictionSamples(samples: PredictionSample[], filter: PredictionSampleFilter) {
  const query = filter.query.trim().toLowerCase();
  return samples
    .filter((sample) => {
      if (filter.status === "errors" && !sample.is_error) return false;
      if (filter.actual && sampleValue(sample.actual) !== filter.actual) return false;
      if (filter.predicted && sampleValue(sample.predicted) !== filter.predicted) return false;
      if (!query) return true;

      const searchable = [
        sample.row_index,
        sample.actual,
        sample.predicted,
        ...Object.entries(sample.features ?? {}).flatMap(([key, value]) => [key, value]),
      ]
        .map(sampleValue)
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    })
    .sort((left, right) => {
      if (Boolean(left.is_error) !== Boolean(right.is_error)) return left.is_error ? -1 : 1;
      return compareText(sampleValue(left.row_index), sampleValue(right.row_index));
    });
}

export function diagnosticSummary(errorSlices: ErrorSlice[]): TrainingDiagnosticSummary {
  const errorCount = errorSlices.reduce((total, slice) => total + slice.errors, 0);
  const worstSlice = errorSlices.find((slice) => slice.errors > 0) ?? null;
  const mainConfusion = worstSlice?.primaryConfusion
    ? `${worstSlice.label} -> ${worstSlice.primaryConfusion.label}`
    : null;

  return {
    worstClass: worstSlice?.label ?? null,
    mainConfusion,
    errorCount,
    recommendation: worstSlice
      ? `Inspect ${worstSlice.label} prediction samples, then review features or preprocessing for this class.`
      : "No class-level errors were found in the recorded confusion matrix.",
  };
}
