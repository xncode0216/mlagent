import { expect, test, type Locator, type Page } from "@playwright/test";

const STAGE_COUNT = 10;
const READABLE_STAGE_WIDTH = 120;
const SINGLE_LINE_LABEL_HEIGHT = 24;

async function auditWorkflowStageStrip(page: Page, width: number, height: number): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await page.goto("/?mode=analysis");
  await expect(page.locator(".agent-workspace")).toBeVisible();

  const strip = page.locator(".workflow-stage-strip");
  await expect(strip).toBeVisible();

  const stages = strip.locator(".workflow-stage");
  await expect(stages).toHaveCount(STAGE_COUNT);

  // 全部阶段落在同一行：修复 9 列网格容纳 10 个阶段导致的第 10 个换行到第二行。
  const offsetTops = await stages.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).offsetTop),
  );
  expect(new Set(offsetTops).size).toBe(1);

  // 每张阶段卡足够宽以容纳单词标签，不再被压到 72px 逐字换行。
  const widths = await stages.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().width)),
  );
  for (const cardWidth of widths) {
    expect(cardWidth).toBeGreaterThanOrEqual(READABLE_STAGE_WIDTH);
  }

  // 阶段标签单行渲染，不逐字换行。
  const labelHeights = await strip
    .locator(".workflow-stage strong")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  for (const labelHeight of labelHeights) {
    expect(labelHeight).toBeLessThanOrEqual(SINGLE_LINE_LABEL_HEIGHT);
  }

  // 阶段条溢出由自身横向滚动吸收，不撑破外层 cockpit。
  const containment = await strip.evaluate((el) => {
    const cockpit = el.closest(".workflow-cockpit") as HTMLElement | null;
    return {
      cockpitScrollWidth: cockpit?.scrollWidth ?? 0,
      cockpitClientWidth: cockpit?.clientWidth ?? 0,
    };
  });
  expect(containment.cockpitScrollWidth).toBeLessThanOrEqual(containment.cockpitClientWidth + 1);

  return strip;
}

test("workflow 阶段条在桌面与窄中心列下单行可读且不逐字换行", async ({ page }) => {
  // 桌面基线：1440×900，四栏布局、右侧面板可见、中心列约 686px。
  await auditWorkflowStageStrip(page, 1440, 900);

  // 窄中心列：1200×900 仍为四栏，中心列压到约 446px，是最拥挤的工况。
  const narrowStrip = await auditWorkflowStageStrip(page, 1200, 900);

  // 拥挤时溢出必须由阶段条横向滚动吸收，而不是让页面出现横向滚动。
  const scroll = await narrowStrip.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
});
