import { describe, expect, it } from "vitest";

import {
  appPreferenceDefaults,
  normalizeAppPreferences,
  readAppPreferences,
  updateAppPreferences,
  writeAppPreferences,
} from "./appPreferences";

function memoryStorage(initial?: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("app preferences", () => {
  it("normalizes invalid stored values to safe defaults", () => {
    expect(
      normalizeAppPreferences({
        defaultMode: "unknown",
        defaultTargetColumn: "   ",
        gpuRefreshIntervalMs: 1234,
      }),
    ).toEqual(appPreferenceDefaults);
  });

  it("keeps valid values and trims target columns", () => {
    expect(
      normalizeAppPreferences({
        defaultMode: "machine-learning",
        defaultTargetColumn: " Churn ",
        gpuRefreshIntervalMs: 10000,
      }),
    ).toEqual({
      defaultMode: "machine-learning",
      defaultTargetColumn: "Churn",
      gpuRefreshIntervalMs: 10000,
    });
  });

  it("persists preferences through storage", () => {
    const storage = memoryStorage();
    const preferences = updateAppPreferences(appPreferenceDefaults, {
      defaultMode: "evolution",
      defaultTargetColumn: "label",
      gpuRefreshIntervalMs: 30000,
    });

    writeAppPreferences(preferences, storage);

    expect(readAppPreferences(storage)).toEqual(preferences);
  });
});
