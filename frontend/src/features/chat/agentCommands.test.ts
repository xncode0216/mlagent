import { describe, expect, it } from "vitest";

import {
  availableAgentCommands,
  filterAgentCommands,
  quickAgentCommands,
  resolveSlashCommand,
} from "./agentCommands";

const context = {
  mode: "analysis" as const,
  activeFile: "data/customer_churn.csv",
  focusedExperimentId: "experiment-42",
  targetColumn: "churn",
  trainingDatasetPath: "data/clean/customer_churn.csv",
};

describe("agent command registry", () => {
  it("filters commands by slash name, label, description, and keywords", () => {
    const commands = availableAgentCommands("analysis");

    expect(filterAgentCommands(commands, "/diag").map((command) => command.id)).toContain("diagnose");
    expect(filterAgentCommands(commands, "数据画像").map((command) => command.id)).toEqual(["profile"]);
    expect(filterAgentCommands(commands, "错误样本").map((command) => command.id)).toContain("diagnose");
  });

  it("resolves a slash command into the same contextual prompt used by visible actions", () => {
    const resolved = resolveSlashCommand("/train", context);

    expect(resolved?.command.id).toBe("train");
    expect(resolved?.prompt).toContain("data/clean/customer_churn.csv");
    expect(resolved?.prompt).toContain("目标列 churn");
  });

  it("preserves user arguments as an explicit command supplement", () => {
    const resolved = resolveSlashCommand("/diagnose 优先检查召回率", context);

    expect(resolved?.prompt).toContain("experiment-42");
    expect(resolved?.prompt).toContain("用户补充：优先检查召回率");
  });

  it("keeps quick actions as references into the command registry", () => {
    expect(quickAgentCommands("analysis").map((command) => command.id)).toEqual(["profile", "clean", "train"]);
    expect(quickAgentCommands("machine-learning").map((command) => command.id)).toEqual([
      "train",
      "gpu",
      "evaluate",
    ]);
  });

  it("returns null for an unknown slash command", () => {
    expect(resolveSlashCommand("/not-a-command", context)).toBeNull();
  });
});
