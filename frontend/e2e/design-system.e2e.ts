import { expect, test } from "@playwright/test";

test("设计系统加载领域样式并支持 ML 品牌强调色覆盖", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=analysis");

  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".agent-workspace")).toBeVisible();
  await expect(page.locator(".right-panel")).toBeVisible();

  const colors = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-accent)";
    document.body.append(probe);

    const defaultAccent = getComputedStyle(probe).color;
    document.documentElement.dataset.brandAccent = "ml";
    const mlAccent = getComputedStyle(probe).color;

    delete document.documentElement.dataset.brandAccent;
    probe.remove();
    return { defaultAccent, mlAccent };
  });

  expect(colors.defaultAccent).toBe("rgb(137, 180, 250)");
  expect(colors.mlAccent).toBe("rgb(203, 166, 247)");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "workflow-completion-feedback";
    document.body.append(probe);
    const styles = getComputedStyle(probe);
    const result = {
      animationDuration: styles.animationDuration,
      animationIterationCount: styles.animationIterationCount,
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    probe.remove();
    return result;
  });
  expect(reducedMotion.matches).toBe(true);
  expect(Number.parseFloat(reducedMotion.animationDuration)).toBeLessThanOrEqual(0.00001);
  expect(reducedMotion.animationIterationCount).toBe("1");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const modelTrigger = page.getByRole("button", { name: /^模型服务：/ });
  await modelTrigger.click();
  const modelDialog = page.getByRole("dialog", { name: "模型服务状态" });
  await expect(modelDialog).toBeVisible();
  await expect(modelDialog).toHaveAttribute("aria-busy", "false");
  await modelDialog.getByRole("button", { name: "刷新模型状态" }).click();
  await expect(modelDialog).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("Escape");

  const accountTrigger = page.getByRole("button", { name: /^账户：/ });
  await accountTrigger.click();
  const accountDialog = page.getByRole("dialog", { name: "账户" });
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog).toHaveAttribute("aria-busy", "false");
  await accountDialog.getByRole("button", { name: "刷新账户状态" }).click();
  await expect(accountDialog).toHaveAttribute("aria-busy", "false");
  if (process.env.E2E_SERVICE_STATUS_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.E2E_SERVICE_STATUS_SCREENSHOT_PATH, fullPage: true });
  }
  await page.keyboard.press("Escape");

  await page
    .getByRole("navigation", { name: "主模式" })
    .getByRole("button", { name: "自进化知识" })
    .click();
  await expect(page.locator(".evolution-workspace")).toBeVisible();
  await expect(page.getByRole("tab", { name: "经验审计列表" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("tab", { name: "自进化知识图谱 & 高级洞察" }).click();
  const graphRegion = page.getByRole("region", { name: "自进化知识图谱" });
  await expect(graphRegion).toBeVisible();
  await expect(graphRegion).toHaveAttribute("aria-busy", "false");
  await expect(
    graphRegion.locator(".graph-container, .graph-empty-state, .graph-error-state").first(),
  ).toBeVisible();
  await expect(page.locator(".evolution-workspace style")).toHaveCount(0);

  if (process.env.E2E_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.E2E_SCREENSHOT_PATH, fullPage: true });
  }
});
