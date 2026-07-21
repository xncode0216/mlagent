// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import { renderWithProviders } from "../test/renderWithProviders";
import { installWebSocketStub } from "../test/websocketStub";

/**
 * 把 api 层的每个函数换成惰性 async 桩：所有数据加载在挂载时 resolve `undefined`，
 * 既不真正联网，也不会让组件里的 `.then()` 链炸掉（如 getLlmStatus 返回 Promise）。
 * AppShell 的 bootstrap 在拿到 undefined 时会落到自身的 try/catch 兜底分支，
 * 因此组件会稳定渲染出“后端不可用”的初始骨架——这正是生产环境每次加载前的真实状态。
 *
 * 用 importOriginal 枚举真实导出名（真实模块无顶层副作用），vitest 才能为每个
 * 命名导出建立静态绑定；逐个把函数替换为桩，非函数导出原样保留。
 */
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const mocked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(actual)) {
    // Return null (not undefined): react-query v5 rejects undefined query data,
    // and every consumer already coalesces with `?? []` / null-checks. Undefined
    // here made the run intermittently emit unhandled query errors.
    mocked[key] = typeof value === "function" ? vi.fn(async () => null) : value;
  }
  return mocked;
});

beforeAll(() => {
  installWebSocketStub();
});

describe("AppShell 冒烟", () => {
  it("后端数据未就绪时仍渲染出工作台骨架", async () => {
    const { AppShell } = await import("./AppShell");
    renderWithProviders(<AppShell />);

    // 品牌与主模式导航是静态地标，任何渲染路径都应存在。
    expect(screen.getByText("MLAgent")).toBeTruthy();

    const nav = screen.getByRole("navigation", { name: "Main modes" });
    expect(within(nav).getByRole("button", { name: "Data Analysis" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Machine Learning" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "Evolution Knowledge" })).toBeTruthy();
  });
});
