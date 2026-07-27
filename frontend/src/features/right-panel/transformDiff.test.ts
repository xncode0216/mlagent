import { describe, expect, it } from "vitest";

import { buildTransformDiff, isTransformationReport } from "./transformDiff";

const report = {
  source_dataset_path: "data/customer_churn.csv",
  output_dataset_path: "results/session-1/customer_churn_planned.csv",
  target_column: "churn",
  input_shape: { rows: 120, columns: 5 },
  output_shape: { rows: 120, columns: 6 },
  drop_columns: ["customer_id"],
  numeric_features: ["age"],
  categorical_features: ["contract"],
  encoded_feature_columns: ["age", "contract_annual", "contract_monthly"],
  transformations: {
    numeric: {
      age: { imputer: "median", fill_value: 41, scaler: "standard", mean: 41.2, std: 12.4 },
    },
    categorical: {
      contract: { imputer: "most_frequent", fill_value: "monthly", encoder: "one_hot_ignore_unknown" },
    },
  },
};

describe("transformation report detection", () => {
  it("recognizes an execute-plan summary", () => {
    expect(isTransformationReport(report)).toBe(true);
  });

  it("does not claim unrelated artifacts", () => {
    expect(isTransformationReport({ columns: [], target_candidates: [] })).toBe(false);
    expect(isTransformationReport(null)).toBe(false);
  });
});

describe("transform diff", () => {
  it("summarizes the shape change", () => {
    const diff = buildTransformDiff(report);

    expect(diff.summary).toMatchObject({
      inputColumns: 5,
      outputColumns: 6,
      droppedCount: 1,
      targetColumn: "churn",
      rowsChanged: false,
    });
  });

  it("reports each dropped column", () => {
    const diff = buildTransformDiff(report);
    const dropped = diff.rows.find((row) => row.column === "customer_id");

    expect(dropped).toMatchObject({ kind: "dropped", outputColumns: [] });
  });

  it("describes numeric imputation and scaling", () => {
    const diff = buildTransformDiff(report);
    const age = diff.rows.find((row) => row.column === "age");

    expect(age).toMatchObject({ kind: "numeric", outputColumns: ["age"] });
    expect(age?.detail).toContain("median");
    expect(age?.detail).toContain("standard");
  });

  it("expands categorical columns into their encoded outputs", () => {
    const diff = buildTransformDiff(report);
    const contract = diff.rows.find((row) => row.column === "contract");

    expect(contract).toMatchObject({ kind: "categorical" });
    expect(contract?.outputColumns).toEqual(["contract_annual", "contract_monthly"]);
  });

  it("attributes encoded columns to the longest matching source column", () => {
    const diff = buildTransformDiff({
      ...report,
      categorical_features: ["contract", "contract_type"],
      encoded_feature_columns: ["contract_annual", "contract_type_premium"],
      transformations: {
        numeric: {},
        categorical: {
          contract: { imputer: "most_frequent", fill_value: "annual", encoder: "one_hot_ignore_unknown" },
          contract_type: { imputer: "most_frequent", fill_value: "premium", encoder: "one_hot_ignore_unknown" },
        },
      },
    });

    expect(diff.rows.find((row) => row.column === "contract")?.outputColumns).toEqual([
      "contract_annual",
    ]);
    expect(diff.rows.find((row) => row.column === "contract_type")?.outputColumns).toEqual([
      "contract_type_premium",
    ]);
  });

  it("flags a row count change so silent row loss stays visible", () => {
    const diff = buildTransformDiff({
      ...report,
      output_shape: { rows: 100, columns: 6 },
    });

    expect(diff.summary).toMatchObject({ inputRows: 120, outputRows: 100, rowsChanged: true });
  });
});
