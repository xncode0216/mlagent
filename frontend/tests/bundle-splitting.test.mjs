import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appShellPath = fileURLToPath(
  new globalThis.URL("../src/app/AppShell.tsx", import.meta.url),
);
const appShell = readFileSync(appShellPath, "utf8");

// AppShell 按 activeMode 互斥渲染这些工作区，任一时刻只有一个在屏幕上。
// 静态 import 会把全部工作区打进首屏主包，因此它们必须走路由级懒加载。
const ROUTE_LEVEL_WORKSPACES = [
  ["EvolutionWorkspace", "../features/evolution/EvolutionWorkspace"],
];

describe("route-level code splitting contract", () => {
  it.each(ROUTE_LEVEL_WORKSPACES)(
    "loads %s lazily instead of statically importing it",
    (component, modulePath) => {
      const staticImport = new RegExp(
        `import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from\\s*["']${modulePath}["']`,
      );
      const lazyImport = new RegExp(
        `const\\s+${component}\\s*=\\s*lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(["']${modulePath}["']\\)`,
      );

      expect(appShell).not.toMatch(staticImport);
      expect(appShell).toMatch(lazyImport);
    },
  );

  it("wraps the lazily loaded workspace in a Suspense boundary", () => {
    expect(appShell).toMatch(/\bSuspense\b/);
    expect(appShell).toMatch(/import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*["']react["']/);
  });
});
