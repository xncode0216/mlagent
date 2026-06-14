import type { ReactElement } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";

/**
 * 统一的测试渲染入口。切片 0 为直通封装；切片 1 接入 react-query 后会在此处
 * 包上 QueryClientProvider（每个用例新建一个隔离的 client），这样所有组件测试
 * 无需各自重复搭建 Provider 桥接。
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, options);
}
