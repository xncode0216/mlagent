import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const backendRoot = fileURLToPath(new URL("../backend", import.meta.url));
const useInstalledChrome = process.platform === "win32" && !process.env.CI;
const localPython = path.join(backendRoot, ".venv", "Scripts", "python.exe");
const pythonExecutable = process.env.E2E_PYTHON ?? (existsSync(localPython) ? localPython : "python");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5174",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(useInstalledChrome ? { channel: "chrome" as const } : {}),
      },
    },
  ],
  webServer: [
    {
      name: "backend",
      command: `${JSON.stringify(pythonExecutable)} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: backendRoot,
      url: "http://127.0.0.1:8000/health",
      env: {
        ...process.env,
        MLAGENT_AUTH_MODE: "development",
        MLAGENT_LOG_LEVEL: "WARNING",
        MLAGENT_WORKSPACE_ROOT: process.env.E2E_WORKSPACE_ROOT ?? ".playwright-workspaces",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      name: "frontend",
      command: "npm run dev",
      cwd: frontendRoot,
      url: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
