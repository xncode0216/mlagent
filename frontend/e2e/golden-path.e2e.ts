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
    await expect(page.getByRole("navigation", { name: "Main modes" }).getByRole("button", { name: "Data Analysis" }))
      .toHaveClass(/active/);

    const dataQualityCard = page.locator('[data-cockpit-component="data_quality"]');
    await dataQualityCard.getByRole("button", { name: "Generate Profile" }).click();
    const completionStatus = page.getByRole("status", { name: "Latest workflow completion" });
    await expect(completionStatus).toContainText("Artifact created");
    const generatedProfilePath = await completionStatus.locator("code").innerText();
    expect(generatedProfilePath).toMatch(/^results\/.+\/data_quality_profile\.json$/);
    await completionStatus.getByRole("button", { name: /^Open completed artifact/ }).click();
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
      page.getByRole("navigation", { name: "Main modes" }).getByRole("button", { name: "Machine Learning" }),
    ).toHaveClass(/active/);
    await expect(page.locator(".graph-focused-row")).toContainText("baseline");
    await expect(page.locator(".experiment-detail")).toContainText(training.experiment_id);
    await expect(page.locator(".experiment-detail")).toContainText("Evaluation Report");
    await expect(page.locator(".experiment-detail")).toContainText(training.evaluation_report_artifact.path);
  } finally {
    await api.dispose();
  }
});
