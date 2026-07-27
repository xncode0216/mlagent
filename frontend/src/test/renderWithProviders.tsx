import type { ReactElement, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";

import { createQueryClient } from "../lib/queryClient";

/**
 * 统一的测试渲染入口：每个用例新建一个隔离的 QueryClient（缓存互不串台），
 * 并包上 QueryClientProvider，这样所有组件测试无需各自重复搭建 Provider 桥接。
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(ui, { ...options, wrapper: Wrapper });
}
