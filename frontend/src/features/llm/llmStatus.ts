import type { LlmStatus } from "../../lib/api";

/**
 * Visual tone for the top-bar model indicator.
 * - `loading`: status request in flight
 * - `error`: status request failed (backend unreachable)
 * - `live`: an LLM client is configured and usable
 * - `offline`: backend reachable but no usable LLM is configured
 */
export type LlmStatusTone = "loading" | "error" | "live" | "offline";

export type LlmStatusView = {
  tone: LlmStatusTone;
  /** Short label shown in the top bar (must fit a narrow pill). */
  label: string;
  /** Longer, human-readable detail for the popover / tooltip. */
  detail: string;
};

type DescribeInput = {
  status: LlmStatus | null;
  loading?: boolean;
  error?: string | null;
};

/**
 * Map the LLM status request state into a renderable view. Pure so it can be
 * unit-tested without rendering the component.
 */
export function describeLlmStatus({ status, loading, error }: DescribeInput): LlmStatusView {
  if (loading && !status) {
    return { tone: "loading", label: "LLM…", detail: "正在检查模型服务…" };
  }
  if (error && !status) {
    return {
      tone: "error",
      label: "LLM 离线",
      detail: `无法连接模型服务：${error}`,
    };
  }
  if (!status) {
    return { tone: "loading", label: "LLM…", detail: "正在检查模型服务…" };
  }
  let current: LlmStatusView;
  if (status.configured) {
    const name = status.provider_label || status.provider || "LLM";
    const detail = status.model ? `${name} · ${status.model}` : name;
    current = { tone: "live", label: name, detail };
  } else {
    current = {
      tone: "offline",
      label: "无 LLM",
      detail: "未配置模型。请在后端设置 MLAGENT_LLM_PROVIDER（及凭据）。",
    };
  }
  if (!error) return current;
  return {
    tone: "error",
    label: current.label,
    detail: current.detail,
  };
}

/**
 * Provider rows for the popover, with a stable status word per provider. Only the
 * active provider can be `configured`; others are shown as available targets the
 * operator could switch the backend to.
 */
export type LlmProviderRow = {
  id: string;
  label: string;
  active: boolean;
  state: "configured" | "active-unconfigured" | "available";
  stateLabel: string;
};

export function buildProviderRows(status: LlmStatus | null): LlmProviderRow[] {
  if (!status) return [];
  return status.providers.map((provider) => {
    let state: LlmProviderRow["state"] = "available";
    let stateLabel = "可用";
    if (provider.active) {
      if (status.configured) {
        state = "configured";
        stateLabel = "使用中";
      } else {
        state = "active-unconfigured";
        stateLabel = "需要凭据";
      }
    }
    return { id: provider.id, label: provider.label, active: provider.active, state, stateLabel };
  });
}
