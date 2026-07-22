import { describe, expect, it } from "vitest";

import type { LlmStatus } from "../../lib/api";
import { buildProviderRows, describeLlmStatus } from "./llmStatus";

const catalog: LlmStatus["providers"] = [
  { id: "anthropic", label: "Claude", active: false },
  { id: "openai", label: "OpenAI", active: false },
  { id: "deepseek", label: "DeepSeek", active: false },
  { id: "vllm", label: "Local vLLM", active: false },
];

function status(overrides: Partial<LlmStatus>): LlmStatus {
  return {
    configured: false,
    provider: "",
    provider_label: "",
    model: "",
    providers: catalog.map((p) => ({ ...p })),
    ...overrides,
  };
}

describe("describeLlmStatus", () => {
  it("shows a loading tone while the first request is in flight", () => {
    const view = describeLlmStatus({ status: null, loading: true });
    expect(view.tone).toBe("loading");
    expect(view.label).toBe("LLM…");
  });

  it("shows an error tone with detail when the request failed", () => {
    const view = describeLlmStatus({ status: null, error: "Failed to fetch" });
    expect(view.tone).toBe("error");
    expect(view.label).toBe("LLM offline");
    expect(view.detail).toContain("Failed to fetch");
  });

  it("keeps the last provider label when a refresh fails", () => {
    const view = describeLlmStatus({
      status: status({ configured: true, provider_label: "Local vLLM", model: "qwen2.5" }),
      error: "Failed to refresh",
    });
    expect(view.tone).toBe("error");
    expect(view.label).toBe("Local vLLM");
    expect(view.detail).toContain("Local vLLM · qwen2.5");
  });

  it("shows a live tone with provider and model when configured", () => {
    const view = describeLlmStatus({
      status: status({ configured: true, provider: "vllm", provider_label: "Local vLLM", model: "qwen2.5" }),
    });
    expect(view.tone).toBe("live");
    expect(view.label).toBe("Local vLLM");
    expect(view.detail).toBe("Local vLLM · qwen2.5");
  });

  it("falls back to the provider label when no model is set", () => {
    const view = describeLlmStatus({
      status: status({ configured: true, provider: "openai", provider_label: "OpenAI", model: "" }),
    });
    expect(view.tone).toBe("live");
    expect(view.detail).toBe("OpenAI");
  });

  it("shows an offline tone when the backend has no usable LLM", () => {
    const view = describeLlmStatus({ status: status({ configured: false }) });
    expect(view.tone).toBe("offline");
    expect(view.label).toBe("No LLM");
    expect(view.detail).toContain("MLAGENT_LLM_PROVIDER");
  });
});

describe("buildProviderRows", () => {
  it("returns nothing without a status", () => {
    expect(buildProviderRows(null)).toEqual([]);
  });

  it("marks the active provider as configured when the LLM is usable", () => {
    const rows = buildProviderRows(
      status({ configured: true, provider: "vllm", providers: catalog.map((p) => ({ ...p, active: p.id === "vllm" })) }),
    );
    const vllm = rows.find((r) => r.id === "vllm");
    expect(vllm?.state).toBe("configured");
    expect(vllm?.stateLabel).toBe("Active");
    expect(rows.filter((r) => r.state === "available")).toHaveLength(3);
  });

  it("marks an active-but-uncredentialed provider as needing credentials", () => {
    const rows = buildProviderRows(
      status({ configured: false, provider: "anthropic", providers: catalog.map((p) => ({ ...p, active: p.id === "anthropic" })) }),
    );
    const anthropic = rows.find((r) => r.id === "anthropic");
    expect(anthropic?.state).toBe("active-unconfigured");
    expect(anthropic?.stateLabel).toBe("Needs credentials");
  });
});
