import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new globalThis.URL("../src", import.meta.url));

function readProductionSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readProductionSources(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [readFileSync(path, "utf8")];
  });
}

const productionSource = readProductionSources(sourceRoot).join("\n");

describe("production data honesty contract", () => {
  it("does not bootstrap, select, or render the retired churn demo", () => {
    expect(productionSource).not.toMatch(/\b(?:sampleCsv|fallbackItems)\b/);
    expect(productionSource).not.toMatch(/["']data\/customer_churn\.csv["']/);
    expect(productionSource).not.toMatch(/createProject\(["']sales_churn_analysis["']\)/);
  });
});
