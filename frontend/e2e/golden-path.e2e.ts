import { expect, test, type APIRequestContext } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const DATASET_PATH = "data/playwright_churn.csv";
const E2E_SESSION_ID = "playwright-golden-path";

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
type ArtifactResponse = { artifact: { path: string } };
type PreprocessingResponse = { plan_artifact: { path: string } };
type ExecutePreprocessingResponse = { transformed_data_artifact: { path: string } };
type TrainingResponse = { experiment_id: string; evaluation_report_artifact: { path: string } };

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(`${API_BASE_URL}${path}`, { data });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

test("用户可从数据画像走到可检查的训练实验", async ({ page, playwright }) => {
  const api = await playwright.request.newContext();

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const project = await postJson<Project>(api, "/api/projects", {
      name: `playwright_golden_path_${Date.now()}`,
    });
    await postJson(api, `/api/projects/${project.id}/files/create`, {
      path: DATASET_PATH,
      type: "file",
      content: DATASET_CSV,
    });
    await postJson<ArtifactResponse>(api, `/api/projects/${project.id}/analysis/profile`, {
      dataset_path: DATASET_PATH,
      session_id: E2E_SESSION_ID,
    });
    const plan = await postJson<PreprocessingResponse>(
      api,
      `/api/projects/${project.id}/analysis/preprocess-plan`,
      { dataset_path: DATASET_PATH, session_id: E2E_SESSION_ID },
    );
    const executed = await postJson<ExecutePreprocessingResponse>(
      api,
      `/api/projects/${project.id}/analysis/execute-preprocess-plan`,
      {
        dataset_path: DATASET_PATH,
        preprocessing_plan_path: plan.plan_artifact.path,
        session_id: E2E_SESSION_ID,
      },
    );
    const training = await postJson<TrainingResponse>(api, `/api/projects/${project.id}/ml/train-baseline`, {
      dataset_path: executed.transformed_data_artifact.path,
      target_column: "churn",
      session_id: E2E_SESSION_ID,
    });

    await page.goto(
      `/?mode=analysis&activity=data&rightTab=data&projectId=${project.id}&file=${encodeURIComponent(DATASET_PATH)}`,
    );
    await expect(page).toHaveTitle("MLAgent");
    await expect(page.getByRole("navigation", { name: "主模式" }).getByRole("button", { name: "数据分析" }))
      .toHaveClass(/active/);

    const dataQualityCard = page.locator('[data-cockpit-component="data_quality"]');
    await dataQualityCard.getByRole("button", { name: "生成画像" }).click();
    const completionStatus = page.getByRole("status", { name: "最新工作流完成" });
    await expect(completionStatus).toContainText("产物已创建");
    const completedArtifactValue = completionStatus.locator('.information-value[data-information-kind="path"]');
    await expect(completedArtifactValue.locator("summary code")).toHaveText("data_quality_profile.json");
    await completedArtifactValue.locator("summary").click();
    const generatedProfilePath = await completedArtifactValue.locator(".information-value-expanded > code").innerText();
    expect(generatedProfilePath).toMatch(/^results\/.+\/data_quality_profile\.json$/);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await completedArtifactValue.getByRole("button", { name: "复制产物路径完整值" }).click();
    await expect(completedArtifactValue.getByText("已复制")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generatedProfilePath);
    await completionStatus.getByRole("button", { name: /^打开已完成产物/ }).click();
    await expect(page.locator(".status-bar")).toContainText(generatedProfilePath);
    await expect(page.locator(".data-quality-profile")).toContainText("churn");
    if (process.env.E2E_COMPLETION_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.E2E_COMPLETION_SCREENSHOT_PATH, fullPage: true });
    }
    await expect(page.locator(".data-quality-profile th")).toContainText([
      "字段",
      "类型",
      "缺失",
      "唯一值",
      "质量标记",
    ]);

    // 画像刚产出的目标列候选应当能直接在训练配置卡片里选择，不必离开中心工作台。
    // 用顶栏切换模式而不是重新导航，保持刚生成的画像事件仍在当前会话流中。
    await page.getByRole("navigation", { name: "主模式" }).getByRole("button", { name: "机器学习" }).click();
    const trainingCard = page.locator('[data-cockpit-component="training_config"]');
    const targetSelect = trainingCard.getByRole("combobox", { name: "目标列" });
    await expect(targetSelect).toBeVisible();
    const targetOptions = await targetSelect.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
    expect(targetOptions).toContain("churn");
    await targetSelect.selectOption("churn");
    await expect(trainingCard).toContainText("churn");
    await expect(
      trainingCard.getByRole("button", { name: "启动 sklearn" }),
    ).toBeEnabled();
    if (process.env.E2E_TARGET_SELECT_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.E2E_TARGET_SELECT_SCREENSHOT_PATH, fullPage: true });
    }
    await page.getByRole("navigation", { name: "主模式" }).getByRole("button", { name: "数据分析" }).click();

    await page.goto(
      `/?mode=analysis&activity=data&rightTab=data&projectId=${project.id}&file=${encodeURIComponent(executed.transformed_data_artifact.path)}`,
    );
    await expect(page.locator(".status-bar")).toContainText(executed.transformed_data_artifact.path);
    await expect(page.locator(".data-preview th")).toContainText([
      "age",
      "monthly_spend",
      "support_tickets",
      "churn",
    ]);
    const activeFilePreview = page.getByRole("region", { name: "活动文件预览" });
    await expect(activeFilePreview).toHaveAttribute("aria-busy", "false");
    await activeFilePreview.getByRole("button", { name: "刷新文件内容" }).click();
    await expect(activeFilePreview).toHaveAttribute("aria-busy", "false");
    await expect(activeFilePreview.locator(".data-preview th")).toContainText([
      "age",
      "monthly_spend",
      "support_tickets",
      "churn",
    ]);
    if (process.env.E2E_ACTIVE_FILE_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.E2E_ACTIVE_FILE_SCREENSHOT_PATH, fullPage: true });
    }

    await page.goto(
      `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${project.id}` +
        `&file=${encodeURIComponent(executed.transformed_data_artifact.path)}` +
        `&experimentId=${training.experiment_id}`,
    );
    await expect(
      page.getByRole("navigation", { name: "主模式" }).getByRole("button", { name: "机器学习" }),
    ).toHaveClass(/active/);
    await expect(page.locator(".graph-focused-row")).toContainText("baseline");
    await expect(page.locator(".experiment-detail")).toContainText(training.experiment_id);
    await expect(page.locator(".experiment-detail")).toContainText("Evaluation Report");
    await expect(page.locator(".experiment-detail")).toContainText(training.evaluation_report_artifact.path);

    const experimentHistory = page.locator(".model-compare").filter({ hasText: "历史实验" }).first();
    await experimentHistory.getByLabel("Filter").selectOption("gpu");
    await expect(experimentHistory).toContainText("当前筛选没有匹配的实验");
    await expect(experimentHistory.getByRole("button", { name: "重置实验筛选" })).toBeVisible();
    await experimentHistory.getByRole("button", { name: "重置实验筛选" }).click();
    await expect(experimentHistory.locator(".graph-focused-row")).toContainText("baseline");

    await page.keyboard.press("Control+K");
    const commandPalette = page.getByRole("dialog", { name: "Agent 命令面板" });
    await expect(commandPalette).toBeVisible();
    await commandPalette.getByRole("searchbox", { name: "搜索 Agent 命令" }).fill("错误诊断");
    if (process.env.E2E_COMMAND_PALETTE_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.E2E_COMMAND_PALETTE_SCREENSHOT_PATH, fullPage: true });
    }
    await commandPalette.getByRole("option", { name: /错误诊断/ }).click();
    const agentComposer = page.getByRole("textbox", { name: "Agent 输入" });
    await expect(agentComposer).toHaveValue("/diagnose ");
    await agentComposer.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "已发送：错误诊断" })).toBeVisible();

    await page.goto(`/?mode=evolution&evolutionTab=graph&projectId=${project.id}`);
    const graphRegion = page.getByRole("region", { name: "自进化知识图谱" });
    await expect(graphRegion).toHaveAttribute("aria-busy", "false");
    await expect(graphRegion.locator(".knowledge-graph-canvas")).toBeVisible();
    await expect(graphRegion.locator(".cytoscape-canvas canvas").first()).toBeVisible();
    await expect(graphRegion.getByRole("img", { name: /知识图谱，共 \d+ 个节点、\d+ 条关系/ })).toBeVisible();
    await expect
      .poll(async () =>
        graphRegion.locator(".cytoscape-canvas").evaluate((host) =>
          Array.from(host.querySelectorAll("canvas")).some((canvas) => {
            const context = canvas.getContext("2d");
            if (!context || canvas.width === 0 || canvas.height === 0) return false;
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let index = 3; index < pixels.length; index += 4) {
              if (pixels[index] !== 0) return true;
            }
            return false;
          }),
        ),
      )
      .toBe(true);

    const nodeLocator = graphRegion.getByRole("combobox", { name: "定位图谱节点" });
    await nodeLocator.selectOption(`exp_${training.experiment_id}`);
    await expect(graphRegion.locator(".graph-detail-sidebar")).toContainText(training.experiment_id);

    const zoomOutput = graphRegion.getByRole("status", { name: "知识图谱缩放比例" });
    const zoomBefore = Number.parseInt((await zoomOutput.textContent()) ?? "0", 10);
    await graphRegion.getByRole("button", { name: "放大知识图谱" }).click();
    await expect
      .poll(async () => Number.parseInt((await zoomOutput.textContent()) ?? "0", 10))
      .toBeGreaterThan(zoomBefore);
    await graphRegion.getByRole("button", { name: "适应知识图谱画布" }).click();

    if (process.env.E2E_KNOWLEDGE_GRAPH_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.E2E_KNOWLEDGE_GRAPH_SCREENSHOT_PATH, fullPage: true });
    }

    await graphRegion.getByRole("button", { name: "定位实验" }).click();
    await expect(
      page.getByRole("navigation", { name: "主模式" }).getByRole("button", { name: "机器学习" }),
    ).toHaveClass(/active/);
    await expect(page.locator(".graph-focused-row")).toContainText("baseline");
  } finally {
    await api.dispose();
  }
});
