import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const STAGE_COUNT = 10;
const READABLE_STAGE_WIDTH = 120;
const SINGLE_LINE_LABEL_HEIGHT = 24;

type Project = { id: string };

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(`${API_BASE_URL}${path}`, { data });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

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

test("顶栏在窄与移动视口下不产生页面横向溢出", async ({ page }) => {
  // 覆盖压缩断点两侧（768/480）与小屏（400/360）：溢出此前从约 448px 以下出现，源自 auth-menu。
  for (const width of [768, 480, 400, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?mode=analysis");
    await expect(page.locator(".top-nav")).toBeVisible();

    const info = await page.evaluate(() => ({
      win: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      authRight: Math.round(
        document.querySelector(".auth-menu")?.getBoundingClientRect().right ?? 0,
      ),
    }));

    // 页面不得出现横向滚动：顶栏内容必须落在视口内或由子容器自身滚动吸收。
    expect(info.doc, `viewport ${width} should not overflow horizontally`).toBeLessThanOrEqual(
      info.win + 1,
    );
    // 最右侧的账户入口必须完整落在视口内。
    expect(info.authRight, `account entry should stay within viewport ${width}`).toBeLessThanOrEqual(
      info.win,
    );
  }
});

test("900px 以下保留可用主工作区并折叠次要面板", async ({ page }) => {
  for (const width of [900, 768, 480, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?mode=analysis");

    const activityBar = page.locator(".activity-bar");
    const workspace = page.locator(".agent-workspace");
    await expect(activityBar).toBeVisible();
    await expect(workspace).toBeVisible();
    await expect(page.locator(".file-sidebar")).toBeHidden();
    await expect(page.locator(".right-panel")).toBeHidden();

    const layout = await page.evaluate(() => {
      const workspaceElement = document.querySelector(".agent-workspace") as HTMLElement | null;
      const workspaceRect = workspaceElement?.getBoundingClientRect();
      return {
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        workspaceLeft: Math.round(workspaceRect?.left ?? 0),
        workspaceRight: Math.round(workspaceRect?.right ?? 0),
        workspaceWidth: Math.round(workspaceRect?.width ?? 0),
      };
    });

    expect(layout.workspaceLeft).toBe(48);
    expect(layout.workspaceRight).toBeLessThanOrEqual(width);
    expect(layout.workspaceWidth).toBeGreaterThanOrEqual(width - 49);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth + 1);

    // 主任务入口仍留在 DOM 与键盘路径中，移动布局不是只读占位页。
    await expect(page.getByRole("textbox", { name: "Agent 输入" })).toBeAttached();
  }
});

test("文件侧栏在 900–1180px 区间截断长路径且不逐字换行", async ({ page, playwright }) => {
  const api = await playwright.request.newContext();
  const longFileName = "customer_retention_features_with_a_very_long_descriptive_filename.csv";

  try {
    const project = await postJson<Project>(api, "/api/projects", {
      name: `responsive_sidebar_project_with_a_long_name_${Date.now()}`,
    });
    await postJson(api, `/api/projects/${project.id}/files/create`, {
      path: longFileName,
      type: "file",
      content: "feature,target\n1,0",
    });

    for (const width of [1180, 901]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/?mode=analysis&projectId=${project.id}&file=${encodeURIComponent(longFileName)}`);

      const sidebar = page.locator(".file-sidebar");
      const projectPath = sidebar.locator(".project-meta code");
      const fileRow = sidebar.locator(`.file-row-main[title="${longFileName}"]`);
      const fileLabel = fileRow.locator("span").last();

      await expect(sidebar).toBeVisible();
      await expect(projectPath).toBeVisible();
      await expect(fileRow).toBeVisible();

      const layout = await page.evaluate(() => {
        const sidebarElement = document.querySelector(".file-sidebar") as HTMLElement | null;
        const projectPathElement = document.querySelector(".project-meta code") as HTMLElement | null;
        const fileLabelElement = document.querySelector(".file-row-main[title]")?.lastElementChild as HTMLElement | null;
        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          fileLabelWhiteSpace: fileLabelElement ? getComputedStyle(fileLabelElement).whiteSpace : "",
          projectPathWhiteSpace: projectPathElement ? getComputedStyle(projectPathElement).whiteSpace : "",
          sidebarClientWidth: sidebarElement?.clientWidth ?? 0,
          sidebarScrollWidth: sidebarElement?.scrollWidth ?? 0,
        };
      });

      expect(layout.projectPathWhiteSpace).toBe("nowrap");
      expect(layout.fileLabelWhiteSpace).toBe("nowrap");
      expect(layout.sidebarScrollWidth).toBeLessThanOrEqual(layout.sidebarClientWidth + 1);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth + 1);

      // 文本仍保留完整可访问值；视觉层仅做单行省略。
      await expect(fileLabel).toHaveText(longFileName);
      await expect(projectPath).toHaveAttribute("title");

      if (width === 901 && process.env.E2E_RESPONSIVE_SIDEBAR_SCREENSHOT_PATH) {
        await page.screenshot({ path: process.env.E2E_RESPONSIVE_SIDEBAR_SCREENSHOT_PATH, fullPage: true });
      }
    }
  } finally {
    await api.dispose();
  }
});
