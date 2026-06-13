import { describe, expect, it } from "vitest";

import type { ExperimentRun } from "../../lib/api";
import {
  diagnosticSummary,
  filterAndSortCandidateRuns,
  filterAndSortExperimentRuns,
  filterPredictionSamples,
  predictionSampleOptions,
  type PredictionSample,
} from "./trainingDiagnostics";

function run(overrides: Partial<ExperimentRun>): ExperimentRun {
  return {
    experiment_id: "exp",
    project_id: "project",
    status: "completed",
    engine: "sklearn",
    dataset_path: "data/churn.csv",
    target_column: "churn",
    use_gpu: false,
    best_model_name: "RandomForest",
    metrics: { accuracy: 0.7, f1_weighted: 0.68, eval_row_count: 10 },
    model: {},
    candidate_runs: [],
    model_artifact: { type: "model", name: "model", path: "models/model.json" },
    metrics_artifact: {
      id: "metrics",
      type: "training",
      name: "metrics",
      path: "results/metrics.json",
      created_at: "2026-05-28T00:00:00.000Z",
    },
    created_at: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("training diagnostics", () => {
  it("filters experiment runs and sorts by the selected metric", () => {
    const runs = [
      run({ experiment_id: "baseline", engine: "baseline", metrics: { accuracy: 0.6 }, created_at: "2026-05-26T00:00:00Z" }),
      run({ experiment_id: "sklearn-a", metrics: { accuracy: 0.91 }, created_at: "2026-05-27T00:00:00Z" }),
      run({ experiment_id: "sklearn-gpu", use_gpu: true, metrics: { accuracy: 0.82 }, created_at: "2026-05-28T00:00:00Z" }),
    ];

    expect(filterAndSortExperimentRuns(runs, { filter: "sklearn", sort: "accuracy" }).map((item) => item.experiment_id)).toEqual([
      "sklearn-a",
      "sklearn-gpu",
    ]);
    expect(filterAndSortExperimentRuns(runs, { filter: "gpu", sort: "newest" }).map((item) => item.experiment_id)).toEqual([
      "sklearn-gpu",
    ]);
    expect(
      filterAndSortExperimentRuns(runs, { filter: "focused", sort: "newest", focusedExperimentId: "baseline" }).map(
        (item) => item.experiment_id,
      ),
    ).toEqual(["baseline"]);
  });

  it("filters candidate runs to the best model and supports stable metric sorting", () => {
    const candidates: ExperimentRun["candidate_runs"] = [
      { model_name: "LogisticRegression", metrics: { accuracy: 0.72, f1_weighted: 0.7, eval_row_count: 20 } },
      { model_name: "RandomForest", metrics: { accuracy: 0.86, f1_weighted: 0.8, eval_row_count: 15 } },
    ];

    expect(filterAndSortCandidateRuns(candidates, { view: "best", sort: "accuracy", bestModelName: "RandomForest" })).toEqual([
      candidates[1],
    ]);
    expect(filterAndSortCandidateRuns(candidates, { view: "all", sort: "evalRows" }).map((item) => item.model_name)).toEqual([
      "LogisticRegression",
      "RandomForest",
    ]);
  });

  it("filters prediction samples by error status, class labels, and feature query", () => {
    const samples: PredictionSample[] = [
      { row_index: 4, actual: "yes", predicted: "no", is_error: true, features: { segment: "enterprise", tenure: 8 } },
      { row_index: 2, actual: "yes", predicted: "yes", is_error: false, features: { segment: "small", tenure: 2 } },
      { row_index: 9, actual: "no", predicted: "yes", is_error: true, features: { segment: "retail", tenure: 5 } },
    ];

    expect(predictionSampleOptions(samples)).toEqual({
      actualLabels: ["no", "yes"],
      predictedLabels: ["no", "yes"],
    });
    expect(
      filterPredictionSamples(samples, { status: "errors", actual: "yes", predicted: "no", query: "enterprise" }).map(
        (sample) => sample.row_index,
      ),
    ).toEqual([4]);
  });

  it("builds a compact diagnostic summary from error slices", () => {
    expect(
      diagnosticSummary([
        {
          label: "yes",
          support: 8,
          correct: 5,
          errors: 3,
          errorRate: 0.375,
          primaryConfusion: { label: "no", count: 3, rate: 0.375 },
        },
      ]),
    ).toMatchObject({
      worstClass: "yes",
      mainConfusion: "yes -> no",
      errorCount: 3,
    });
  });
});
