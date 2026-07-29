import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const DATASET_PATH = "data/nl_churn.csv";

// 24 行、age 缺 1 个（4.2%）：低缺失率数值列，正是经验抽取应当沉淀的情形。
// 缺失值同时让预处理计划的中位数填充走上真实路径。
const DATASET_CSV = [
  "age,monthly_spend,support_tickets,churn",
  "22,49,1,no",
  "24,50,0,no",
  "25,52,0,no",
  "27,55,1,no",
  "29,58,1,no",
  "30,60,0,no",
  "31,61,0,no",
  "33,64,1,no",
  "34,66,2,no",
  "36,69,1,no",
  "38,72,1,no",
  "40,76,2,no",
  "42,81,2,yes",
  "44,85,3,yes",
  "46,88,3,yes",
  "48,92,3,yes",
  "51,96,4,yes",
  "54,101,4,yes",
  "57,105,5,yes",
  "60,112,5,yes",
  "63,118,5,yes",
  "66,121,6,yes",
  "68,124,6,yes",
  ",128,6,yes",
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

function stageStatuses(page: Page) {
  return page
    .locator("[data-workflow-stage]")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.getAttribute("data-workflow-stage") ?? "",
          node.getAttribute("data-workflow-status") ?? "",
        ]),
      ),
    );
}

/**
 * 这条链路从头到尾没有任何产物或事件归属这三个阶段：数据集是直接建文件的（没走摄取意图，
 * 因此没有 dataset_registry_entry），清洗与迭代根本没被提起。它们全程不得显示为 `completed`。
 *
 * 判据刻意不写成"只有用户显式要求过的阶段才能完成"——第一版就是那么写的，被实测推翻：
 * 一次 sklearn 训练本身就会写出 `prediction_samples.json` 与候选对比产物，评估与诊断因此
 * 拿到真属于自己的证据，标成完成是诚实的。**产物归属才是判据，用户说没说过不是。**
 */
const NEVER_RUN_STAGES = ["ingest", "clean", "iterate"];

/**
 * 阶段条的诚实性判据，每走一步查一次：
 * ① 走到过的阶段必须留下痕迹（不能还是 pending，否则"没有谎报"可以靠一条空白阶段条蒙混过关）；
 * ② `NEVER_RUN_STAGES` 一律不得显示为 `completed`——那是成功绿，等于谎报进度。
 *
 * 这条断言是补票：P4-2（未运行阶段显示成功绿）与 P4-3（包裹事件把猜出来的阶段标成完成）
 * 都在全绿的测试套件下活了很久，因为**没有任何一处断言看过阶段条的状态**，包括这条金链路——
 * 它此前只看卡片出没出现。两者的现场都落在这三个阶段里：P4-2 会把清洗与迭代染绿，P4-3 在
 * 分析模式下会把摄取染绿。
 */
async function expectHonestStageStrip(page: Page, ranStages: string[], step: string) {
  await expect
    .poll(async () => {
      const statuses = await stageStatuses(page);
      return {
        未留痕迹: ranStages.filter((id) => statuses[id] === "pending" || statuses[id] === undefined),
        谎报完成: NEVER_RUN_STAGES.filter((id) => statuses[id] === "completed"),
      };
    }, { timeout: 15_000, message: `${step}：阶段条与实际跑过的阶段不符` })
    .toEqual({ 未留痕迹: [], 谎报完成: [] });
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
    // 这条链路自始至终没有走过摄取、清洗、迭代——它们必须一路保持非 completed。
    await expectHonestStageStrip(page, ["profile", "transform"], "画像 + 计划");

    // 2. 批准后才执行变换。该审批由编排器发起，走的是 WebSocket 审批响应通道。
    await planCard.getByRole("button", { name: "批准并执行" }).click();
    await expect(card(page, "planned_dataset")).toBeVisible();
    await expectHonestStageStrip(page, ["profile", "transform"], "变换已执行");

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
    await expectHonestStageStrip(page, ["profile", "transform", "train"], "训练完成");

    // 4. 评估：真实指标、候选模型与报告
    await ask(page, "evaluate this model and show the report");
    await expect
      .poll(() => visibleCardKinds(page), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(["model_comparison", "evaluation_report"]));
    await expectHonestStageStrip(page, ["profile", "transform", "train", "evaluate"], "评估完成");

    // 4. 诊断：类别级误差与行级样本
    await ask(page, "diagnose why recall is poor and show prediction samples");
    await expect(card(page, "error_analysis")).toBeVisible();
    await expect(card(page, "prediction_samples")).toBeVisible();
    await expectHonestStageStrip(page, ["profile", "transform", "train", "evaluate", "diagnose"], "诊断完成");

    // 6. 重试：没有保存的失败状态时必须如实说明，而不是假装恢复了什么。
    // 判据落在助手回复上：这条消息才是"如实说明"本身。此前断言的是进度事件写进阶段条的
    // detail，而那条进度不带 stage，被兜底写到了「接入」——用不相关阶段承载这句话是巧合。
    await ask(page, "retry last failed step");
    await expect(page.getByText("did not find a saved failed task state").first()).toBeVisible();
    await expect(card(page, "task_state_inspector")).toHaveCount(0);
    // 这一步正是 P4-3 的现场：回合包裹事件曾把猜出来的阶段标成完成，而这一步什么都没跑。
    await expectHonestStageStrip(page, ["profile", "transform", "train", "evaluate", "diagnose"], "空转的重试");

    // 6. 导出交接包
    await ask(page, "export the final report and handoff bundle");
    await expect(card(page, "export_bundle")).toBeVisible();
    await expectHonestStageStrip(
      page,
      ["profile", "transform", "train", "evaluate", "diagnose", "export"],
      "导出完成",
    );

    // 7. 经验沉淀：卡片出现还不够，闭环成立的判据是真的产出了可审核的候选。
    // 抽取器此前只认 legacy 流程的 missing.json，主路径跑完后一个候选也没有。
    await ask(page, "extract lessons and propose learned rules");
    await expect(card(page, "lesson_review")).toBeVisible();
    await expectHonestStageStrip(
      page,
      ["profile", "transform", "train", "evaluate", "diagnose", "export", "learn"],
      "经验沉淀完成",
    );
    const sessions = await api.get(`${API_BASE_URL}/api/projects/${project.id}/sessions`);
    const analysisSession = ((await sessions.json()).items as Array<{ id: string; mode: string }>)
      .find((item) => item.mode === "analysis");
    expect(analysisSession, "分析会话应当存在").toBeTruthy();
    const candidates = await postJson<{ items: unknown[] }>(
      api,
      `/api/projects/${project.id}/evolution/lessons/extract-from-session`,
      { session_id: analysisSession!.id },
    );
    expect(candidates.items.length).toBeGreaterThan(0);

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
