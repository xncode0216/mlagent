import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const DATASET_PATH = "data/accessibility_churn.csv";
const SESSION_ID = "playwright-accessibility";
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
type TrainingResponse = { experiment_id: string };

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(`${API_BASE_URL}${path}`, { data });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function analyzePage(page: Page, state: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({
      failureSummary: node.failureSummary,
      target: node.target,
    })),
    state,
  }));
}

test("关键工作区和对话框满足自动化 WCAG A/AA 检查", async ({ page, playwright }) => {
  const api = await playwright.request.newContext();
  const findings: Awaited<ReturnType<typeof analyzePage>> = [];

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const project = await postJson<Project>(api, "/api/projects", {
      name: `playwright_accessibility_${Date.now()}`,
    });
    await postJson(api, `/api/projects/${project.id}/files/create`, {
      content: DATASET_CSV,
      path: DATASET_PATH,
      type: "file",
    });
    await postJson(api, `/api/projects/${project.id}/analysis/profile`, {
      dataset_path: DATASET_PATH,
      session_id: SESSION_ID,
    });
    const training = await postJson<TrainingResponse>(
      api,
      `/api/projects/${project.id}/ml/train-baseline`,
      {
        dataset_path: DATASET_PATH,
        session_id: SESSION_ID,
        target_column: "churn",
      },
    );

    await page.goto(
      `/?mode=analysis&activity=data&rightTab=data&projectId=${project.id}` +
        `&file=${encodeURIComponent(DATASET_PATH)}`,
    );
    await expect(page.locator(".data-preview")).toBeVisible();
    findings.push(...(await analyzePage(page, "analysis")));

    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Agent 命令面板" })).toBeVisible();
    findings.push(...(await analyzePage(page, "command-palette")));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^模型服务：/ }).click();
    await expect(page.getByRole("dialog", { name: "模型服务状态" })).toBeVisible();
    findings.push(...(await analyzePage(page, "model-dialog")));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^账户：/ }).click();
    await expect(page.getByRole("dialog", { name: "账户" })).toBeVisible();
    findings.push(...(await analyzePage(page, "account-dialog")));
    await page.keyboard.press("Escape");

    await page.goto(
      `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${project.id}` +
        `&file=${encodeURIComponent(DATASET_PATH)}&experimentId=${training.experiment_id}`,
    );
    await expect(page.locator(".experiment-detail")).toContainText(training.experiment_id);
    findings.push(...(await analyzePage(page, "machine-learning")));

    await page.goto(`/?mode=evolution&evolutionTab=graph&projectId=${project.id}`);
    const graphRegion = page.getByRole("region", { name: "自进化知识图谱" });
    await expect(graphRegion).toHaveAttribute("aria-busy", "false");
    await expect(graphRegion.locator(".cytoscape-canvas canvas").first()).toBeVisible();
    findings.push(...(await analyzePage(page, "evolution-graph")));

    const summary = findings.map((finding) => ({
      id: finding.id,
      impact: finding.impact,
      nodeCount: finding.nodes.length,
      state: finding.state,
      targets: finding.nodes.slice(0, 8).map((node) => node.target),
    }));
    expect(findings.length, JSON.stringify(summary, null, 2)).toBe(0);
  } finally {
    await api.dispose();
  }
});
