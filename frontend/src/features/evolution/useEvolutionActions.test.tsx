// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../../app/uiStore";
import { createQueryClient } from "../../lib/queryClient";
import {
  adoptLesson,
  extractLessonsFromSession,
  setLessonEnabled,
  setLessonScope,
  type AgentSession,
  type Project,
} from "../../lib/api";
import type { AgentStreamEvent } from "../chat/types";
import { lessonsQueryKey } from "./useEvolutionQueries";
import { useEvolutionActions } from "./useEvolutionActions";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    adoptLesson: vi.fn(),
    rejectLesson: vi.fn(),
    setLessonEnabled: vi.fn(),
    setLessonScope: vi.fn(),
    extractLessonsFromSession: vi.fn(),
  };
});

const project = { id: "project-1", name: "p", workspace_path: "/w" } as Project;
const session = { id: "session-1", project_id: "project-1", mode: "analysis" } as AgentSession;

function renderEvolutionActions() {
  const events: AgentStreamEvent[] = [];
  const setLocalEvents = vi.fn((update) => {
    const next = typeof update === "function" ? update(events) : update;
    events.length = 0;
    events.push(...next);
  });
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const view = renderHook(
    () => useEvolutionActions({ project, activeSession: session, setLocalEvents }),
    { wrapper: Wrapper },
  );
  return { ...view, events, queryClient };
}

beforeEach(() => {
  vi.mocked(adoptLesson).mockResolvedValue({ id: "lesson-1" } as never);
  vi.mocked(setLessonEnabled).mockResolvedValue({ id: "lesson-1" } as never);
  vi.mocked(setLessonScope).mockResolvedValue({ id: "lesson-1" } as never);
  vi.mocked(extractLessonsFromSession).mockResolvedValue([
    { id: "lesson-1", confidence: 0.8 },
  ] as never);
  useUiStore.setState({ activeMode: "analysis", activeActivity: "explorer" });
});

afterEach(() => vi.clearAllMocks());

describe("治理操作后的缓存一致性", () => {
  // 采纳、停用、限定范围都会改变哪些规则参与注入，
  // 因此每一个都必须让经验列表失效，否则界面继续显示旧的治理状态。
  it.each([
    ["采纳", (actions: ReturnType<typeof useEvolutionActions>) => actions.handleAdoptLesson("lesson-1")],
    ["停用", (actions: ReturnType<typeof useEvolutionActions>) => actions.handleSetLessonEnabled("lesson-1", false)],
    ["限定范围", (actions: ReturnType<typeof useEvolutionActions>) => actions.handleSetLessonScope("lesson-1", { datasets: ["data/a.csv"] })],
  ])("%s 后使经验列表失效", async (_label, run) => {
    const { result, queryClient } = renderEvolutionActions();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(() => run(result.current));

    const invalidatedKeys = invalidate.mock.calls.map((call) =>
      JSON.stringify(call[0]?.queryKey ?? []),
    );
    expect(invalidatedKeys.join("|")).toContain(JSON.stringify(lessonsQueryKey("project-1")));
  });
});

describe("从会话沉淀经验", () => {
  it("成功后跳转到自进化知识并发出经验事件", async () => {
    const { result, events } = renderEvolutionActions();

    await act(() => result.current.handleExtractLessonsFromSession());

    const state = useUiStore.getState();
    expect(state.activeMode).toBe("evolution");
    expect(state.activeActivity).toBe("knowledge");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["lesson_extracted", "stage_completed"]),
    );
  });

  it("失败时发出可重试事件并向上抛出", async () => {
    vi.mocked(extractLessonsFromSession).mockRejectedValue(new Error("extraction failed"));
    const { result, events } = renderEvolutionActions();

    await act(async () => {
      await expect(result.current.handleExtractLessonsFromSession()).rejects.toThrow(
        "extraction failed",
      );
    });

    expect(events.find((event) => event.type === "step_failed")).toMatchObject({
      stage: "learn",
      retryable: true,
    });
    // 失败不该把用户带去知识页看空结果
    expect(useUiStore.getState().activeMode).toBe("analysis");
  });

  it("没有会话可沉淀时不发出请求", async () => {
    const queryClient = createQueryClient();
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(
      () =>
        useEvolutionActions({ project, activeSession: null, setLocalEvents: vi.fn() }),
      { wrapper: Wrapper },
    );

    await act(() => result.current.handleExtractLessonsFromSession());

    expect(extractLessonsFromSession).not.toHaveBeenCalled();
  });
});
