import { type ActivityMode, activityPanels } from "./activityRail";
import type { AppPreferences } from "./appPreferences";

export type MainMode = "analysis" | "machine-learning" | "evolution";
export type RightPanelTabId = "chart" | "code" | "data" | "training" | "logs";
export type EvolutionTabId = "rules" | "graph";

export type AppDeepLink = {
  activity?: ActivityMode;
  evolutionTab?: EvolutionTabId;
  experimentId?: string;
  file?: string;
  mode?: MainMode;
  projectId?: string;
  rightTab?: RightPanelTabId;
  sessionId?: string;
};

const mainModes: MainMode[] = ["analysis", "machine-learning", "evolution"];
const rightTabs: RightPanelTabId[] = ["chart", "code", "data", "training", "logs"];
const evolutionTabs: EvolutionTabId[] = ["rules", "graph"];
const activityModes = activityPanels.map((panel) => panel.id);

function firstValid<T extends string>(value: string | null, options: readonly T[]): T | undefined {
  return options.includes(value as T) ? (value as T) : undefined;
}

function safePath(value: string | null) {
  const path = value?.trim();
  if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("..")) return undefined;
  return path.replaceAll("\\", "/");
}

function safeToken(value: string | null) {
  const token = value?.trim();
  return token ? token : undefined;
}

export function parseAppDeepLink(search: string): AppDeepLink {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);

  return {
    activity: firstValid(params.get("activity"), activityModes),
    evolutionTab: firstValid(params.get("evolutionTab"), evolutionTabs),
    experimentId: safeToken(params.get("experimentId")),
    file: safePath(params.get("file")),
    mode: firstValid(params.get("mode"), mainModes),
    projectId: safeToken(params.get("projectId")),
    rightTab: firstValid(params.get("rightTab"), rightTabs),
    sessionId: safeToken(params.get("sessionId")),
  };
}

export function readAppDeepLink() {
  return parseAppDeepLink(window.location.search);
}

export function resolveInitialMode(preferences: AppPreferences, deepLink: AppDeepLink): MainMode {
  return deepLink.mode ?? preferences.defaultMode;
}
