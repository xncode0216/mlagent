import type { RightPanelTabId } from "../../app/appDeepLink";

export const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;

export type RightPanelTabLabel = (typeof tabs)[number];

export const tabById: Record<RightPanelTabId, RightPanelTabLabel> = {
  chart: "图表",
  code: "代码",
  data: "数据",
  training: "训练",
  logs: "日志",
};
