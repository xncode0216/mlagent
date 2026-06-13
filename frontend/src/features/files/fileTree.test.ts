import { describe, expect, it } from "vitest";

import type { FileItem } from "../../lib/api";
import { buildVisibleTree } from "./fileTree";

const projectFiles: FileItem[] = [
  { name: "agent_schema", path: "agent_schema", type: "directory" },
  { name: "data", path: "data", type: "directory" },
  { name: "evolution", path: "evolution", type: "directory" },
  { name: "experiments", path: "experiments", type: "directory" },
  { name: "logs", path: "logs", type: "directory" },
  { name: "models", path: "models", type: "directory" },
  { name: "notebooks", path: "notebooks", type: "directory" },
  { name: "results", path: "results", type: "directory" },
  { name: "customer_churn.csv", path: "data/customer_churn.csv", type: "file" },
  { name: "raw", path: "data/raw", type: "directory" },
  { name: "telecom.csv", path: "data/raw/telecom.csv", type: "file" },
];

describe("buildVisibleTree", () => {
  it("renders expanded folder children directly below their parent", () => {
    expect(buildVisibleTree(projectFiles, ["data"]).map((item) => item.path)).toEqual([
      "agent_schema",
      "data",
      "data/raw",
      "data/customer_churn.csv",
      "evolution",
      "experiments",
      "logs",
      "models",
      "notebooks",
      "results",
    ]);
  });

  it("keeps nested children under the expanded nested folder", () => {
    expect(buildVisibleTree(projectFiles, ["data", "data/raw"]).map((item) => item.path)).toEqual([
      "agent_schema",
      "data",
      "data/raw",
      "data/raw/telecom.csv",
      "data/customer_churn.csv",
      "evolution",
      "experiments",
      "logs",
      "models",
      "notebooks",
      "results",
    ]);
  });

  it("hides files whose parent folders are collapsed", () => {
    expect(buildVisibleTree(projectFiles, []).map((item) => item.path)).toEqual([
      "agent_schema",
      "data",
      "evolution",
      "experiments",
      "logs",
      "models",
      "notebooks",
      "results",
    ]);
  });
});
