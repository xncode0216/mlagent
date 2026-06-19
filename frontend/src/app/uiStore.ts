import { create } from "zustand";

import { type ActivityMode } from "./activityRail";
import { readAppDeepLink, resolveInitialMode, type MainMode, type RightPanelTabId } from "./appDeepLink";
import { readAppPreferences } from "./appPreferences";
import type { TrainingResult } from "../lib/api";

// 全局 UI / 选择态集中存放（zustand 单例 store），逐切片把 AppShell 的 useState 搬入，
// 子组件改为 useUiStore(selector) 直读，消除 AppShell 的 props 钻取。
// 注意：服务端态（projects/sessions/files/...）仍由 react-query 托管，不进此 store；
// project/activeSession（驱动 query key 与 WebSocket）与组件级表单态另行处理。

// 深链与偏好只读一次：纯读 window.location.search / localStorage，模块加载即可用
// （jsdom 下同样安全）。activeMode 初值沿用 resolveInitialMode(deepLink.mode ?? 默认模式)。
const initialDeepLink = readAppDeepLink();
const initialPreferences = readAppPreferences();

const INITIAL_WORKSPACE_STATUS = "Connecting to backend project service...";

interface UiState {
  // 主模式 / 左侧活动栏：导航选择态（深链初始化）。
  activeMode: MainMode;
  activeActivity: ActivityMode;
  setActiveMode: (value: MainMode) => void;
  setActiveActivity: (value: ActivityMode) => void;
  // 选择态：当前文件 / 聚焦实验（深链初始化）。
  activeFile: string;
  focusedExperimentId: string | null;
  setActiveFile: (value: string) => void;
  setFocusedExperimentId: (value: string | null) => void;
  // 训练相关选择态（RightPanel 直读 store；AgentWorkspace 经 AppShell 拿覆盖后的值）。
  trainingDatasetPath: string;
  suggestedTargetColumn: string;
  selectedPreprocessingPlanPath: string | null;
  setTrainingDatasetPath: (value: string) => void;
  setSuggestedTargetColumn: (value: string) => void;
  setSelectedPreprocessingPlanPath: (value: string | null) => void;
  // 工作区状态串 / 命令结果 / 错误串：AppShell 侧纯写，子组件读。
  workspaceStatus: string;
  trainingResult: TrainingResult | null;
  trainingError: string | null;
  gpuActionError: string | null;
  // 右栏：聚焦日志任务 + 当前标签（深链 rightTab 初始化）。
  focusedLogTaskId: string | null;
  rightPanelTab: RightPanelTabId | undefined;
  setWorkspaceStatus: (value: string) => void;
  setTrainingResult: (value: TrainingResult | null) => void;
  setTrainingError: (value: string | null) => void;
  setGpuActionError: (value: string | null) => void;
  setRightPanelTab: (value: RightPanelTabId) => void;
  // 复合动作：打开某任务日志（聚焦任务 + 切到日志标签），替代原先成对的 setState。
  openLogs: (taskId?: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeMode: resolveInitialMode(initialPreferences, initialDeepLink),
  activeActivity: initialDeepLink.activity ?? "explorer",
  setActiveMode: (value) => set({ activeMode: value }),
  setActiveActivity: (value) => set({ activeActivity: value }),
  activeFile: initialDeepLink.file ?? "data/customer_churn.csv",
  focusedExperimentId: initialDeepLink.experimentId ?? null,
  setActiveFile: (value) => set({ activeFile: value }),
  setFocusedExperimentId: (value) => set({ focusedExperimentId: value }),
  trainingDatasetPath: initialDeepLink.file ?? "data/customer_churn.csv",
  suggestedTargetColumn: initialPreferences.defaultTargetColumn,
  selectedPreprocessingPlanPath: null,
  setTrainingDatasetPath: (value) => set({ trainingDatasetPath: value }),
  setSuggestedTargetColumn: (value) => set({ suggestedTargetColumn: value }),
  setSelectedPreprocessingPlanPath: (value) => set({ selectedPreprocessingPlanPath: value }),
  workspaceStatus: INITIAL_WORKSPACE_STATUS,
  trainingResult: null,
  trainingError: null,
  gpuActionError: null,
  focusedLogTaskId: null,
  rightPanelTab: initialDeepLink.rightTab,
  setWorkspaceStatus: (value) => set({ workspaceStatus: value }),
  setTrainingResult: (value) => set({ trainingResult: value }),
  setTrainingError: (value) => set({ trainingError: value }),
  setGpuActionError: (value) => set({ gpuActionError: value }),
  setRightPanelTab: (value) => set({ rightPanelTab: value }),
  openLogs: (taskId) => set({ focusedLogTaskId: taskId ?? null, rightPanelTab: "logs" }),
}));
