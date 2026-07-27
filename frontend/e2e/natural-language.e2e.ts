import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const DATASET_PATH = "data/nl_churn.csv";

const DATASET_CSV = [
  "age,monthly_spend,support_tickets,churn",
  "22,49,1,no",
  "25,52,0,no",
  "29,58,1,no",
  "31,61,0,no",
  "34,66,2,no",
  "38,72,1,no",
  "42,81,2,yes",
  "46,88,3,yes",
  "51,96,4,yes",
  "57,105,5,yes",
  "63,118,5,yes",
  "68,124,6,yes",
].join("\n");

type Project = { id: string };

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(`${API_BASE_URL}${path}`, { data });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

/** 通过对话框发送自然语言，等待回执后再继续，避免下一条指令抢在流式响应之前。 */
async function ask(page: Page, content: string) {
  const composer = page.getByRole("textbox", { name: "Agent 输入" });
  await composer.fill(content);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

function card(page: Page, kind: string) {
  return page.locator(`[data-cockpit-component="${kind}"]`);
}

/** cockpit 只渲染前若干张卡片，断言失败时需要看到实际渲染了哪些。 */
function visibleCardKinds(page: Page) {
  return page
    .locator("[data-cockpit-component]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-cockpit-component") ?? ""));
}

// 这条链路要走完 8 次编排往返并真实训练一次 sklearn，默认 30s 上限在 CI 上不够；
// 上限低于单个断言的等待时间时，断言还没等到结果测试就先超时了。
test.describe.configure({ timeout: 180_000 });

test("自然语言可驱动从原始数据到经验沉淀的完整工作流", async ({ page, playwright }) => {
  const api = await playwright.request.newContext();

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const project = await postJson<Project>(api, "/api/projects", {
      name: `playwright_natural_language_${Date.now()}`,
    });
    await postJson(api, `/api/projects/${project.id}/files/create`, {
      path: DATASET_PATH,
      type: "file",
      content: DATASET_CSV,
    });

    // 刻意不带 rightTab 深链：检查器应当自己跟随工作流阶段
    await page.goto(
      `/?mode=analysis&activity=data&projectId=${project.id}` +
        `&file=${encodeURIComponent(DATASET_PATH)}`,
    );
    await expect(page.locator(".status-bar")).toContainText(DATASET_PATH);
    // 只有真实会话就绪后才会建立连接，因此"已连接"即代表可以安全发送指令。
    await expect(page.locator(".status-bar")).toContainText("WebSocket 已连接");

    // 1. 原始数据 -> 画像与预处理计划，并刻意停在审批检查点（变换属于会改数据的动作）
    await ask(page, "Analyze this dataset and prepare it for modeling");
    await expect(card(page, "data_quality")).toBeVisible();
    const planCard = card(page, "preprocessing_plan");
    await expect(planCard).toBeVisible();
    await expect(card(page, "planned_dataset")).toHaveCount(0);

    // 2. 批准后才执行变换。该审批由编排器发起，走的是 WebSocket 审批响应通道。
    await planCard.getByRole("button", { name: "批准并执行" }).click();
    await expect(card(page, "planned_dataset")).toBeVisible();

    // 3. 训练意图只召唤配置卡片，真实训练仍需用户确认——同样是刻意的人控自动化边界
    await ask(page, "train sklearn on this dataset");
    const trainingCard = card(page, "training_config");
    await expect(trainingCard).toBeVisible();
    await expect(trainingCard).toContainText("churn");
    await trainingCard.getByRole("button", { name: "启动 sklearn" }).click();
    await expect(page.getByRole("status").filter({ hasText: "启动 sklearn 已完成" })).toBeVisible({
      timeout: 60_000,
    });
    // 检查器应当已经跟到训练页，而不是把用户留在数据页自己去找
    await expect(page.getByRole("button", { name: "训练", pressed: true })).toBeVisible();

    // 4. 评估：真实指标、候选模型与报告
    await ask(page, "evaluate this model and show the report");
    await expect
      .poll(() => visibleCardKinds(page), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(["model_comparison", "evaluation_report"]));

    // 4. 诊断：类别级误差与行级样本
    await ask(page, "diagnose why recall is poor and show prediction samples");
    await expect(card(page, "error_analysis")).toBeVisible();
    await expect(card(page, "prediction_samples")).toBeVisible();

    // 6. 重试：没有保存的失败状态时必须如实说明，而不是假装恢复了什么
    await ask(page, "retry last failed step");
    await expect(page.getByText("No saved failed task state").first()).toBeVisible();

    // 6. 导出交接包
    await ask(page, "export the final report and handoff bundle");
    await expect(card(page, "export_bundle")).toBeVisible();

    // 7. 经验沉淀
    await ask(page, "extract lessons and propose learned rules");
    await expect(card(page, "lesson_review")).toBeVisible();

    // 8. 回溯：任一回复都能追到产生它的那次执行，日志随即按该 trace 过滤
    await page.getByRole("button", { name: "查看该回复的执行链路" }).last().click();
    await expect(page.getByRole("button", { name: "日志", pressed: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "清除过滤" })).toBeVisible();
    // 过滤后仍有事件，才说明这条回复真的能追回它的执行链路
    await expect(page.locator(".log-row").first()).toBeVisible();

    if (process.env.E2E_NATURAL_LANGUAGE_SCREENSHOT_PATH) {
      await page.screenshot({
        path: process.env.E2E_NATURAL_LANGUAGE_SCREENSHOT_PATH,
        fullPage: true,
      });
    }

    // 全流程结束后工作台不应残留错误提示
    await expect(page.locator(".agent-error")).toHaveCount(0);
  } finally {
    await api.dispose();
  }
});
