// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LlmStatus } from "../../lib/api";
import { ModelStatusIndicator } from "./ModelStatusIndicator";

function llmStatus(overrides: Partial<LlmStatus> = {}): LlmStatus {
  return {
    configured: true,
    provider: "vllm",
    provider_label: "Local vLLM",
    model: "qwen2.5",
    providers: [
      { id: "openai", label: "OpenAI", active: false },
      { id: "vllm", label: "Local vLLM", active: true },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderIndicator(loadStatus: () => Promise<LlmStatus>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<ModelStatusIndicator loadStatus={loadStatus} />, { wrapper: Wrapper });
}

afterEach(cleanup);

describe("ModelStatusIndicator query states", () => {
  it("marks the popover busy during the first status request", () => {
    const firstRead = deferred<LlmStatus>();
    renderIndicator(() => firstRead.promise);

    fireEvent.click(screen.getByRole("button", { name: /模型服务：/ }));
    const dialog = screen.getByRole("dialog", { name: "模型服务状态" });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(within(dialog).getByRole("status").textContent).toContain("正在检查模型服务");
  });

  it("recovers from an initial error through a local retry", async () => {
    const loadStatus = vi
      .fn<() => Promise<LlmStatus>>()
      .mockRejectedValueOnce(new Error("status API unavailable"))
      .mockResolvedValueOnce(llmStatus());
    renderIndicator(loadStatus);

    await waitFor(() => expect(screen.getByRole("button", { name: /status API unavailable/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /模型服务：/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("status API unavailable");
    fireEvent.click(within(alert).getByRole("button", { name: "重试模型状态" }));

    await waitFor(() =>
      expect(within(screen.getByRole("dialog", { name: "模型服务状态" })).getByText("Local vLLM · qwen2.5")).toBeTruthy(),
    );
    expect(loadStatus).toHaveBeenCalledTimes(2);
  });

  it("preserves the last provider state when a background refresh fails", async () => {
    const refresh = deferred<LlmStatus>();
    const loadStatus = vi
      .fn<() => Promise<LlmStatus>>()
      .mockResolvedValueOnce(llmStatus())
      .mockImplementationOnce(() => refresh.promise);
    renderIndicator(loadStatus);

    await screen.findByText("Local vLLM");
    fireEvent.click(screen.getByRole("button", { name: /模型服务：/ }));
    const dialog = screen.getByRole("dialog", { name: "模型服务状态" });
    fireEvent.click(within(dialog).getByRole("button", { name: "刷新模型状态" }));

    await waitFor(() => expect(dialog.getAttribute("aria-busy")).toBe("true"));
    expect(within(dialog).getByText("正在刷新模型状态…")).toBeTruthy();
    expect(within(dialog).getByText("使用中")).toBeTruthy();

    refresh.reject(new Error("model refresh failed"));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("model refresh failed");
    expect(within(dialog).getByText("Local vLLM · qwen2.5")).toBeTruthy();
    expect(within(dialog).getByText("使用中")).toBeTruthy();
  });
});

describe("ModelStatusIndicator focus management", () => {
  it("moves keyboard focus into the popover when it opens", async () => {
    renderIndicator(() => Promise.resolve(llmStatus()));
    const trigger = screen.getByRole("button", { name: /模型服务：/ });
    trigger.focus();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "模型服务状态" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it("restores focus to the trigger when Escape closes the popover", async () => {
    renderIndicator(() => Promise.resolve(llmStatus()));
    const trigger = screen.getByRole("button", { name: /模型服务：/ });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "模型服务状态" });

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
