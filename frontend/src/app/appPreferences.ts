export type AppMode = "analysis" | "machine-learning" | "evolution";

export type AppPreferences = {
  defaultMode: AppMode;
  defaultTargetColumn: string;
  gpuRefreshIntervalMs: number;
};

export const appPreferenceDefaults: AppPreferences = {
  defaultMode: "analysis",
  defaultTargetColumn: "churn",
  gpuRefreshIntervalMs: 5000,
};

export const gpuRefreshIntervalOptions = [3000, 5000, 10000, 30000] as const;

const storageKey = "mlagent.appPreferences.v1";
const appModes = new Set<AppMode>(["analysis", "machine-learning", "evolution"]);
let memoryFallbackPreferences: AppPreferences = appPreferenceDefaults;

function browserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function normalizeTargetColumn(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : appPreferenceDefaults.defaultTargetColumn;
}

function normalizeGpuRefreshInterval(value: unknown) {
  const interval = typeof value === "number" ? value : Number(value);
  return gpuRefreshIntervalOptions.includes(interval as (typeof gpuRefreshIntervalOptions)[number])
    ? interval
    : appPreferenceDefaults.gpuRefreshIntervalMs;
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return appPreferenceDefaults;
  }

  const input = value as Partial<AppPreferences>;
  return {
    defaultMode: input.defaultMode && appModes.has(input.defaultMode) ? input.defaultMode : appPreferenceDefaults.defaultMode,
    defaultTargetColumn: normalizeTargetColumn(input.defaultTargetColumn),
    gpuRefreshIntervalMs: normalizeGpuRefreshInterval(input.gpuRefreshIntervalMs),
  };
}

export function readAppPreferences(storage = browserStorage()): AppPreferences {
  if (!storage) return memoryFallbackPreferences;
  try {
    return normalizeAppPreferences(JSON.parse(storage.getItem(storageKey) ?? "null"));
  } catch {
    return appPreferenceDefaults;
  }
}

export function writeAppPreferences(preferences: AppPreferences, storage = browserStorage()) {
  const normalizedPreferences = normalizeAppPreferences(preferences);
  memoryFallbackPreferences = normalizedPreferences;
  if (!storage) return;
  storage.setItem(storageKey, JSON.stringify(normalizedPreferences));
}

export function updateAppPreferences(current: AppPreferences, patch: Partial<AppPreferences>) {
  return normalizeAppPreferences({ ...current, ...patch });
}
