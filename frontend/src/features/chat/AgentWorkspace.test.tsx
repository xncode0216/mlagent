// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../../app/uiStore";
import { AgentWorkspace } from "./AgentWorkspace";
import { deriveWorkflowCompletionFeedback } from "./completionFeedback";
import type { AgentStreamEvent, Artifact } from "./types";

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    project_id: "project-1",
    session_id: "session-1",
    type: "report",
    name: "data_quality_report.md",
    path: "results/session-1/data_quality_report.md",
    metadata: {},
    created_at: "2026-07-22T03:40:00Z",
    ...overrides,
  };
}

function renderWorkspace(events: AgentStreamEvent[], onSelectFile = vi.fn(), sendMessage = vi.fn()) {
  return {
    onSelectFile,
    sendMessage,
    ...render(
      <AgentWorkspace
        connected
        events={events}
        historyMessages={[]}
        lastError={null}
        mode="analysis"
        onSelectFile={onSelectFile}
        projectId="project-1"
        sendMessage={sendMessage}
      />,
    ),
  };
}

beforeEach(() => {
  useUiStore.setState({ activeFile: "", focusedExperimentId: null });
});

afterEach(cleanup);

describe("workflow completion feedback", () => {
  it("keeps the latest completed stage visible across later progress events", () => {
    const feedback = deriveWorkflowCompletionFeedback([
      {
        type: "stage_completed",
        task_id: "task-1",
        stage: "profile",
        label: "Dataset profile completed",
      },
      { type: "task_progress", task_id: "task-1", progress: 0.6, label: "Preparing report" },
    ]);

    expect(feedback).toMatchObject({
      kind: "stage",
      label: "阶段完成",
      stage: "profile",
      title: "Dataset profile completed",
    });
  });

  it("promotes a later artifact over an earlier stage completion", () => {
    const created = artifact();
    const feedback = deriveWorkflowCompletionFeedback([
      { type: "stage_completed", task_id: "task-1", stage: "profile" },
      { type: "artifact_created", artifact: created },
    ]);

    expect(feedback).toMatchObject({
      kind: "artifact",
      label: "产物已创建",
      title: created.name,
      detail: created.path,
      artifactPath: created.path,
    });
  });

  it("ignores ordinary progress without a completion event", () => {
    expect(
      deriveWorkflowCompletionFeedback([
        { type: "task_progress", task_id: "task-1", progress: 0.8, label: "Still running" },
      ]),
    ).toBeNull();
  });

  it("announces an artifact completion and opens the canonical file", () => {
    const created = artifact();
    const { onSelectFile } = renderWorkspace([{ type: "artifact_created", artifact: created }]);

    const status = screen.getByRole("status", { name: "最新工作流完成" });
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(within(status).getByText("产物已创建")).toBeTruthy();
    expect(within(status).getByText(created.name, { selector: "strong" })).toBeTruthy();
    expect(within(status).getByText(created.path)).toBeTruthy();

    fireEvent.click(within(status).getByRole("button", { name: `打开已完成产物 ${created.name}` }));
    expect(onSelectFile).toHaveBeenCalledWith(created.path);
  });
});

describe("cockpit information disclosure", () => {
  it("shows a friendly artifact name, reveals the canonical path, and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const reportPath = "results/2026-07-22/run-123/model_evaluation_report.md";
    renderWorkspace([
      {
        type: "component_requested",
        task_id: "task-1",
        stage: "evaluate",
        component: "evaluation_report",
        title: "评估报告",
        artifact_path: reportPath,
        props: {
          experiment_id: "f6af6b4db29647b7a8796dbe221dcd43",
          evaluation_report_path: reportPath,
          metrics_path: "results/2026-07-22/run-123/metrics.json",
        },
      },
    ]);

    const card = document.querySelector('[data-cockpit-component="evaluation_report"]');
    expect(card).toBeTruthy();
    const reportDisclosure = within(card as HTMLElement).getByText("model_evaluation_report.md").closest("details");
    expect(reportDisclosure?.hasAttribute("open")).toBe(false);

    fireEvent.click(within(reportDisclosure as HTMLElement).getByText("model_evaluation_report.md"));
    expect(reportDisclosure?.hasAttribute("open")).toBe(true);
    expect(within(reportDisclosure as HTMLElement).getByText(reportPath)).toBeTruthy();

    fireEvent.click(within(reportDisclosure as HTMLElement).getByRole("button", { name: "复制报告完整值" }));
    expect(writeText).toHaveBeenCalledWith(reportPath);
    expect(await within(reportDisclosure as HTMLElement).findByText("已复制")).toBeTruthy();
  });
});

describe("agent command palette and slash commands", () => {
  it("opens with Ctrl+K, filters commands, and runs the selected slash command", () => {
    useUiStore.setState({ activeFile: "data/customer_churn.csv" });
    const { sendMessage } = renderWorkspace([]);

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Agent 命令面板" });
    const commandSearch = within(dialog).getByRole("searchbox", { name: "搜索 Agent 命令" });
    fireEvent.change(commandSearch, { target: { value: "没有这个命令" } });
    expect(within(dialog).getByText("没有匹配的命令")).toBeTruthy();
    expect(within(dialog).getByText("尝试搜索“训练”“报告”或“重试”。")).toBeTruthy();
    fireEvent.change(commandSearch, {
      target: { value: "数据画像" },
    });
    fireEvent.click(within(dialog).getByRole("option", { name: /数据画像/ }));

    expect(screen.queryByRole("dialog", { name: "Agent 命令面板" })).toBeNull();
    const composer = screen.getByRole("textbox", { name: "Agent 输入" }) as HTMLTextAreaElement;
    expect(composer.value).toBe("/profile ");
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("data/customer_churn.csv"),
      expect.objectContaining({ activeFile: "data/customer_churn.csv", projectId: "project-1" }),
    );
    expect(composer.value).toBe("");
  });

  it("shows keyboard-navigable slash suggestions and keeps unknown commands local", () => {
    const { sendMessage } = renderWorkspace([]);
    const composer = screen.getByRole("textbox", { name: "Agent 输入" }) as HTMLTextAreaElement;

    fireEvent.change(composer, { target: { value: "/tra" } });
    expect(screen.getByRole("listbox", { name: "Slash 命令建议" })).toBeTruthy();
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer.value).toMatch(/^\/(train|transform) /);

    fireEvent.change(composer, { target: { value: "/not-a-command" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(screen.getByText("未知命令 /not-a-command。按 Ctrl+K 查看可用命令。")).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("closes on Escape and restores focus to the composer", () => {
    renderWorkspace([]);
    const composer = screen.getByRole("textbox", { name: "Agent 输入" }) as HTMLTextAreaElement;
    composer.focus();

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const dialog = screen.getByRole("dialog", { name: "Agent 命令面板" });
    expect(document.activeElement).toBe(within(dialog).getByRole("searchbox", { name: "搜索 Agent 命令" }));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Agent 命令面板" })).toBeNull();
    expect(document.activeElement).toBe(composer);
  });
});

describe("训练配置卡片的目标列选择", () => {
  const profileEvent: AgentStreamEvent = {
    type: "component_requested",
    task_id: "session-1",
    stage: "profile",
    component: "data_quality",
    title: "Review data quality profile",
    artifact_path: "results/session-1/data_quality_profile.json",
    props: {
      dataset_path: "data/customer_churn.csv",
      target_candidates: ["churn", "contract_type"],
    },
  };

  const trainingEvent: AgentStreamEvent = {
    type: "component_requested",
    task_id: "session-1",
    stage: "train",
    component: "training_config",
    title: "Configure sklearn training",
    artifact_path: "data/customer_churn.csv",
    props: { dataset_path: "data/customer_churn.csv", engine: "sklearn" },
  };

  function renderTrainingCockpit(onSelectTargetColumn = vi.fn()) {
    render(
      <AgentWorkspace
        connected
        events={[profileEvent, trainingEvent]}
        historyMessages={[]}
        lastError={null}
        mode="machine-learning"
        onSelectFile={vi.fn()}
        onSelectTargetColumn={onSelectTargetColumn}
        projectId="project-1"
        sendMessage={vi.fn()}
        trainingDatasetPath="data/customer_churn.csv"
      />,
    );
    return { onSelectTargetColumn };
  }

  it("在卡片内渲染画像候选并把选择结果回传", () => {
    const { onSelectTargetColumn } = renderTrainingCockpit();

    const select = screen.getByRole("combobox", { name: "目标列" }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(
      expect.arrayContaining(["churn", "contract_type"]),
    );

    fireEvent.change(select, { target: { value: "contract_type" } });
    expect(onSelectTargetColumn).toHaveBeenCalledWith("contract_type");
  });

  it("未生成画像时不渲染目标列选择器", () => {
    render(
      <AgentWorkspace
        connected
        events={[trainingEvent]}
        historyMessages={[]}
        lastError={null}
        mode="machine-learning"
        onSelectFile={vi.fn()}
        onSelectTargetColumn={vi.fn()}
        projectId="project-1"
        sendMessage={vi.fn()}
        trainingDatasetPath="data/customer_churn.csv"
      />,
    );

    expect(screen.queryByRole("combobox", { name: "目标列" })).toBeNull();
  });
});
