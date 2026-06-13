import { describe, expect, it } from "vitest";

import { deriveErrorSlices } from "./errorSlices";

describe("deriveErrorSlices", () => {
  it("summarizes per-class errors and the primary confusion target", () => {
    const slices = deriveErrorSlices({
      confusion_matrix: {
        no: { no: 8, yes: 2, maybe: 1 },
        yes: { no: 1, yes: 9, maybe: 0 },
        maybe: { no: 0, yes: 0, maybe: 4 },
      },
    });

    expect(slices).toEqual([
      {
        label: "no",
        support: 11,
        correct: 8,
        errors: 3,
        errorRate: 3 / 11,
        primaryConfusion: { label: "yes", count: 2, rate: 2 / 11 },
      },
      {
        label: "yes",
        support: 10,
        correct: 9,
        errors: 1,
        errorRate: 0.1,
        primaryConfusion: { label: "no", count: 1, rate: 0.1 },
      },
      {
        label: "maybe",
        support: 4,
        correct: 4,
        errors: 0,
        errorRate: 0,
        primaryConfusion: null,
      },
    ]);
  });

  it("returns an empty list when confusion matrix is missing", () => {
    expect(deriveErrorSlices()).toEqual([]);
  });
});
