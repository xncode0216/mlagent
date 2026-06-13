import { describe, expect, it } from "vitest";

import { activityPanels, getActivityPanelInfo, type ActivityMode } from "./activityRail";

describe("activity rail configuration", () => {
  it("defines every visible activity entry with panel copy", () => {
    const ids = activityPanels.map((panel) => panel.id);

    expect(ids).toEqual([
      "explorer",
      "search",
      "data",
      "experiments",
      "version",
      "knowledge",
      "account",
      "settings",
    ]);
    expect(activityPanels.every((panel) => panel.label && panel.title && panel.description)).toBe(true);
  });

  it("resolves settings to a real panel", () => {
    expect(getActivityPanelInfo("settings")).toMatchObject({
      id: "settings",
      title: "设置",
      group: "secondary",
    });
  });

  it("falls back to explorer for unknown ids at runtime", () => {
    expect(getActivityPanelInfo("missing" as ActivityMode)).toMatchObject({ id: "explorer" });
  });
});
