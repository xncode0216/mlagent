// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileItem, Project } from "../../lib/api";
import { FileExplorer } from "./FileExplorer";

const project: Project = {
  id: "project-1",
  owner_id: "dev-user",
  name: "Real workspace",
  workspace_path: "E:/workspaces/real-workspace",
};

const baseProps: ComponentProps<typeof FileExplorer> = {
  currentProjectId: project.id,
  files: [],
  onCreateProject: vi.fn(async () => undefined),
  onCreateFile: vi.fn(async () => undefined),
  onDeleteFile: vi.fn(async () => undefined),
  onOpenLocalProject: vi.fn(async () => undefined),
  onRenameFile: vi.fn(async () => undefined),
  onSelect: vi.fn(),
  onSwitchProject: vi.fn(),
  onToggleFolder: vi.fn(),
  onUpload: vi.fn(async () => undefined),
  onSelectSession: vi.fn(),
  projectName: project.name,
  projectPath: project.workspace_path,
  projects: [project],
  sessions: [],
};

function renderExplorer(overrides: Partial<ComponentProps<typeof FileExplorer>> = {}) {
  return render(<FileExplorer {...baseProps} {...overrides} />);
}

afterEach(() => cleanup());

describe("FileExplorer query-backed states", () => {
  it("shows an honest no-project state without retired demo files", () => {
    renderExplorer({ currentProjectId: undefined, projectName: undefined, projectPath: undefined, projects: [] });

    expect(screen.getByText("还没有项目。使用上方的新建或打开操作开始。")).toBeTruthy();
    expect(screen.getByText("创建或选择项目后管理文件。")).toBeTruthy();
    expect(screen.queryByText("customer_churn.csv")).toBeNull();
    expect((screen.getByRole("button", { name: "新建文件" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("上传 CSV").getAttribute("aria-disabled")).toBe("true");
  });

  it("marks the file region busy and renders a stable loading skeleton", () => {
    renderExplorer({ filesBusy: true });

    const region = screen.getByRole("region", { name: "项目文件" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("正在加载项目文件…")).toBeTruthy();
    expect(region.querySelectorAll(".sidebar-skeleton-row")).toHaveLength(3);
    expect(screen.queryByText("当前项目还没有文件。")).toBeNull();
  });

  it("distinguishes a loaded empty project from loading", () => {
    renderExplorer();

    const region = screen.getByRole("region", { name: "项目文件" });
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText("当前项目还没有文件。使用上方的新建或上传操作添加第一个文件。")).toBeTruthy();
    expect(region.querySelector(".sidebar-skeleton")).toBeNull();
  });

  it("keeps stale real files visible when refresh fails and offers retry", () => {
    const onRetryFiles = vi.fn();
    const files: FileItem[] = [{ name: "orders.csv", path: "orders.csv", type: "file" }];
    renderExplorer({ files, filesError: "Network unavailable", onRetryFiles });

    expect(screen.getByText("orders.csv")).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Network unavailable")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "重试项目文件" }));
    expect(onRetryFiles).toHaveBeenCalledOnce();
  });

  it("reports project and session refresh independently", () => {
    renderExplorer({ projectsBusy: true, sessionsBusy: true });

    expect(screen.getByRole("region", { name: "项目管理" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("region", { name: "会话记录" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("正在刷新项目列表…")).toBeTruthy();
    expect(screen.getByText("正在加载会话记录…")).toBeTruthy();
    expect(screen.queryByText("当前项目还没有会话记录。")).toBeNull();
  });
});
