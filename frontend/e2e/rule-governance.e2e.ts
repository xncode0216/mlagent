import { expect, test, type APIRequestContext } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";

type Project = { id: string };
type Lesson = { id: string };

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(`${API_BASE_URL}${path}`, { data });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

/** 规则是否会被注入到后续运行——治理生效与否的唯一判据。 */
async function matchedRuleCount(
  api: APIRequestContext,
  projectId: string,
  sessionId: string,
  datasetPath?: string,
) {
  const result = await postJson<{ matched_rules: unknown[] }>(
    api,
    `/api/projects/${projectId}/evolution/rules/match`,
    {
      session_id: sessionId,
      context: {
        mode: "analysis",
        feature_type: "numeric",
        missing_ratio: 0.02,
        tags: ["missing-value"],
        ...(datasetPath ? { dataset_path: datasetPath } : {}),
      },
    },
  );
  return result.matched_rules.length;
}

test("已采纳的规则可以停用、重新启用并限定适用范围", async ({ page, playwright }) => {
  const api = await playwright.request.newContext();

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const project = await postJson<Project>(api, "/api/projects", {
      name: `playwright_rule_governance_${Date.now()}`,
    });

    const lesson = await postJson<Lesson>(
      api,
      `/api/projects/${project.id}/evolution/lessons/extract`,
      {
        source_type: "analysis",
        source_id: "session-1",
        domain: ["data-analysis", "missing-value"],
        observation: "低缺失率数值列适合中位数填充",
        recommendation: "对偏态数值列优先使用中位数填充",
        confidence: 0.86,
        conditions: {
          task_modes: ["analysis"],
          feature_type: "numeric",
          missing_ratio_range: [0, 0.05],
        },
        evidence: {},
      },
    );
    await postJson(api, `/api/projects/${project.id}/evolution/lessons/${lesson.id}/adopt`, {});
    expect(await matchedRuleCount(api, project.id, "before")).toBe(1);

    await page.goto(`/?mode=evolution&evolutionTab=rules&projectId=${project.id}`);
    await page.getByRole("button", { name: /中位数填充/ }).first().click();

    // 停用是这条链路的安全开关：采纳此前无法撤销
    await page.getByRole("button", { name: "停用规则" }).click();
    await expect(page.getByText(/已停用/)).toBeVisible();
    expect(await matchedRuleCount(api, project.id, "after-disable")).toBe(0);

    if (process.env.E2E_RULE_GOVERNANCE_SCREENSHOT_PATH) {
      await page.screenshot({
        path: process.env.E2E_RULE_GOVERNANCE_SCREENSHOT_PATH,
        fullPage: true,
      });
    }

    // 停用不推翻审核结论，因此可以直接重新启用
    await page.getByRole("button", { name: "重新启用" }).click();
    await expect(page.getByRole("button", { name: "停用规则" })).toBeVisible();
    expect(await matchedRuleCount(api, project.id, "after-enable")).toBe(1);

    // 范围限定是比停用更细的边界：规则仍然生效，但只在被限定的数据集上
    await expect(page.getByText(/全部数据集/)).toBeVisible();
    await postJson(api, `/api/projects/${project.id}/evolution/lessons/${lesson.id}/scope`, {
      datasets: ["data/only_here.csv"],
      modes: [],
    });
    await page.reload();
    await page.getByRole("button", { name: /中位数填充/ }).first().click();
    await expect(page.getByText("data/only_here.csv")).toBeVisible();

    expect(await matchedRuleCount(api, project.id, "in-scope", "data/only_here.csv")).toBe(1);
    expect(await matchedRuleCount(api, project.id, "out-of-scope", "data/elsewhere.csv")).toBe(0);

    // 解除限定后恢复全局适用
    await page.getByRole("button", { name: "解除范围限定" }).click();
    await expect(page.getByText(/全部数据集/)).toBeVisible();
    expect(await matchedRuleCount(api, project.id, "unscoped", "data/elsewhere.csv")).toBe(1);
  } finally {
    await api.dispose();
  }
});
