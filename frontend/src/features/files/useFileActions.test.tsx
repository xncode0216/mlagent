// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../../app/uiStore";
import { createQueryClient } from "../../lib/queryClient";
import type { FileItem } from "../../lib/api";
import { listExpandedProjectFiles } from "./useProjectFilesQuery";
import { useFileActions } from "./useFileActions";
import type { ProjectFileMutations } from "./useProjectFileMutations";

vi.mock("./useProjectFilesQuery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useProjectFilesQuery")>();
  return { ...actual, listExpandedProjectFiles: vi.fn() };
});

function file(path: string): FileItem {
  return { path, name: path.split("/").pop() ?? path, type: "file", size: 10 };
}

/** 只桩出 hook 真正调用的 mutateAsync，避免把 React Query 的整套 mutation 形态复制一遍。 */
function fakeMutations() {
  const calls = { create: vi.fn(), rename: vi.fn(), remove: vi.fn(), upload: vi.fn() };
  const mutations = {
    createFile: { mutateAsync: calls.create },
    renameFile: { mutateAsync: calls.rename },
    deleteFile: { mutateAsync: calls.remove },
    uploadFile: { mutateAsync: calls.upload },
  } as unknown as ProjectFileMutations;
  return { calls, mutations };
}

// 显式接收整个参数对象：默认参数遇到 undefined 会回落到默认值，
// 那样就永远测不到"没有项目"这个分支。
function renderFileActions({ projectId }: { projectId?: string } = { projectId: "project-1" }) {
  const { calls, mutations } = fakeMutations();
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const view = renderHook(() => useFileActions({ projectId, mutations }), { wrapper: Wrapper });
  return { ...view, calls };
}

beforeEach(() => {
  vi.mocked(listExpandedProjectFiles).mockResolvedValue([]);
  useUiStore.setState({
    activeFile: "",
    trainingDatasetPath: "",
    selectedPreprocessingPlanPath: null,
    expandedFolders: [],
  });
});

afterEach(() => vi.clearAllMocks());

describe("重命名的路径级联", () => {
  it("重命名文件夹时一并跟随活动文件、训练数据集与预处理计划", async () => {
    useUiStore.setState({
      activeFile: "data/raw/churn.csv",
      trainingDatasetPath: "data/raw/churn.csv",
      selectedPreprocessingPlanPath: "data/raw/preprocessing_plan.json",
      expandedFolders: ["data", "data/raw"],
    });
    const { result } = renderFileActions();

    await act(() => result.current.handleRenameFile("data/raw", "data/bronze"));

    const state = useUiStore.getState();
    expect(state.activeFile).toBe("data/bronze/churn.csv");
    expect(state.trainingDatasetPath).toBe("data/bronze/churn.csv");
    expect(state.selectedPreprocessingPlanPath).toBe("data/bronze/preprocessing_plan.json");
    expect(state.expandedFolders).toContain("data/bronze");
    expect(state.expandedFolders).not.toContain("data/raw");
  });

  it("不触碰仅前缀相似但不在该目录下的路径", async () => {
    // data/raw_backup 只是名字以 data/raw 开头，重命名 data/raw 不该改到它
    useUiStore.setState({
      activeFile: "data/raw_backup/churn.csv",
      trainingDatasetPath: "data/raw_backup/churn.csv",
      expandedFolders: ["data/raw", "data/raw_backup"],
    });
    const { result } = renderFileActions();

    await act(() => result.current.handleRenameFile("data/raw", "data/bronze"));

    const state = useUiStore.getState();
    expect(state.activeFile).toBe("data/raw_backup/churn.csv");
    expect(state.trainingDatasetPath).toBe("data/raw_backup/churn.csv");
    expect(state.expandedFolders).toContain("data/raw_backup");
  });

  it("路径没有变化时不发出请求", async () => {
    const { result, calls } = renderFileActions();

    await act(() => result.current.handleRenameFile("data/churn.csv", "data/churn.csv"));

    expect(calls.rename).not.toHaveBeenCalled();
  });
});

describe("删除后的选择回退", () => {
  it("删除当前数据集后回退到剩余的数据集文件", async () => {
    vi.mocked(listExpandedProjectFiles).mockResolvedValue([
      file("data/notes.md"),
      file("data/backup.csv"),
    ]);
    useUiStore.setState({
      activeFile: "data/churn.csv",
      trainingDatasetPath: "data/churn.csv",
      expandedFolders: ["data"],
    });
    const { result } = renderFileActions();

    await act(() => result.current.handleDeleteFile("data/churn.csv"));

    const state = useUiStore.getState();
    // 活动文件回退到第一个文件，训练数据集只回退到真正的数据集文件
    expect(state.activeFile).toBe("data/notes.md");
    expect(state.trainingDatasetPath).toBe("data/backup.csv");
  });

  it("没有可回退的文件时清空选择而不是留下已删除的路径", async () => {
    useUiStore.setState({ activeFile: "data/churn.csv", trainingDatasetPath: "data/churn.csv" });
    const { result } = renderFileActions();

    await act(() => result.current.handleDeleteFile("data/churn.csv"));

    expect(useUiStore.getState().activeFile).toBe("");
    expect(useUiStore.getState().trainingDatasetPath).toBe("");
  });

  it("删除计划所在目录后清空预处理计划选择", async () => {
    useUiStore.setState({ selectedPreprocessingPlanPath: "results/s1/preprocessing_plan.json" });
    const { result } = renderFileActions();

    await act(() => result.current.handleDeleteFile("results/s1"));

    expect(useUiStore.getState().selectedPreprocessingPlanPath).toBeNull();
  });

  it("删除无关文件时不动当前选择", async () => {
    useUiStore.setState({ activeFile: "data/churn.csv", trainingDatasetPath: "data/churn.csv" });
    const { result } = renderFileActions();

    await act(() => result.current.handleDeleteFile("data/other.csv"));

    expect(useUiStore.getState().activeFile).toBe("data/churn.csv");
    expect(useUiStore.getState().trainingDatasetPath).toBe("data/churn.csv");
  });
});

describe("选中文件与目录展开", () => {
  it("选中深层文件时展开其全部祖先目录", () => {
    const { result } = renderFileActions();

    act(() => result.current.handleSelectProjectFile("results/session-1/metrics.json"));

    expect(useUiStore.getState().expandedFolders).toEqual(
      expect.arrayContaining(["results", "results/session-1"]),
    );
    expect(useUiStore.getState().activeFile).toBe("results/session-1/metrics.json");
  });

  it("只有数据集文件才成为训练数据集", () => {
    const { result } = renderFileActions();

    act(() => result.current.handleSelectProjectFile("results/report.md"));
    expect(useUiStore.getState().trainingDatasetPath).toBe("");

    act(() => result.current.handleSelectProjectFile("data/churn.csv"));
    expect(useUiStore.getState().trainingDatasetPath).toBe("data/churn.csv");
  });

  it("预处理计划不会被误当作训练数据集", () => {
    const { result } = renderFileActions();

    act(() => result.current.handleSelectProjectFile("results/s1/preprocessing_plan.json"));

    const state = useUiStore.getState();
    expect(state.selectedPreprocessingPlanPath).toBe("results/s1/preprocessing_plan.json");
    expect(state.trainingDatasetPath).toBe("");
  });

  it("折叠目录时一并折叠其子目录", () => {
    useUiStore.setState({ expandedFolders: ["data", "data/raw", "data/raw/2024", "results"] });
    const { result } = renderFileActions();

    act(() => result.current.handleToggleFolder("data/raw"));

    expect(useUiStore.getState().expandedFolders).toEqual(["data", "results"]);
  });
});

describe("没有项目时的写操作", () => {
  it("不发出任何文件请求", async () => {
    const { result, calls } = renderFileActions({});

    await act(() => result.current.handleCreateFile("data/new.csv", "file"));
    await act(() => result.current.handleDeleteFile("data/churn.csv"));
    await act(() => result.current.handleRenameFile("a", "b"));

    expect(calls.create).not.toHaveBeenCalled();
    expect(calls.remove).not.toHaveBeenCalled();
    expect(calls.rename).not.toHaveBeenCalled();
  });
});
