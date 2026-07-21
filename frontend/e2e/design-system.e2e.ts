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

  if (process.env.E2E_SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.E2E_SCREENSHOT_PATH, fullPage: true });
  }
});
