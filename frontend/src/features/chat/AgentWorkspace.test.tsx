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

function renderWorkspace(events: AgentStreamEvent[], onSelectFile = vi.fn()) {
  return {
    onSelectFile,
    ...render(
      <AgentWorkspace
        connected
        events={events}
        historyMessages={[]}
        lastError={null}
        mode="analysis"
        onSelectFile={onSelectFile}
        projectId="project-1"
        sendMessage={vi.fn()}
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
    expect(within(status).getByText(created.name)).toBeTruthy();
    expect(within(status).getByText(created.path)).toBeTruthy();

    fireEvent.click(within(status).getByRole("button", { name: `打开已完成产物 ${created.name}` }));
    expect(onSelectFile).toHaveBeenCalledWith(created.path);
  });
});
