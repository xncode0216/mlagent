import { describe, expect, it } from "vitest";

import { describeInformationValue } from "./informationDisplay";

describe("describeInformationValue", () => {
  it("uses the file name as the primary label and keeps compact parent context", () => {
    expect(
      describeInformationValue("报告", "results/2026-07-22/run-123/model_evaluation_report.md"),
    ).toEqual({
      context: "results/…/run-123",
      display: "model_evaluation_report.md",
      expandable: true,
      kind: "path",
      value: "results/2026-07-22/run-123/model_evaluation_report.md",
    });
  });

  it("recognizes Windows project paths", () => {
    expect(describeInformationValue("数据集", "E:\\datasets\\customer_churn.csv")).toMatchObject({
      context: "E:/datasets",
      display: "customer_churn.csv",
      expandable: true,
      kind: "path",
    });
  });

  it("shortens long identifiers without discarding the original value", () => {
    const value = "f6af6b4db29647b7a8796dbe221dcd43";
    expect(describeInformationValue("实验", value)).toEqual({
      context: "完整实验标识",
      display: "f6af6b4d…1dcd43",
      expandable: true,
      kind: "identifier",
      value,
    });
  });

  it("leaves ordinary values and placeholders compact", () => {
    expect(describeInformationValue("目标列", "churn")).toEqual({
      display: "churn",
      expandable: false,
      kind: "plain",
      value: "churn",
    });
    expect(describeInformationValue("报告", "未生成").expandable).toBe(false);
  });
});
