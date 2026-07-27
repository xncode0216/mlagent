import type {
  AgentSession,
  EvolutionInjectionLog,
  EvolutionProtocol,
  ExperimentRun,
  FileItem,
  GPUStatus,
  Lesson,
  Project,
} from "../lib/api";
import { gpuRefreshIntervalOptions, type AppPreferences } from "./appPreferences";
import { getActivityPanelInfo } from "./activityRail";
import { useUiStore } from "./uiStore";

type MainMode = "analysis" | "machine-learning" | "evolution";

type ActivityPanelProps = {
  artifactCount: number;
  connected: boolean;
  eventsCount: number;
  files: FileItem[];
  gpuStatus: GPUStatus | null;
  injectionLogs: EvolutionInjectionLog[];
  lessons: Lesson[];
  preferences: AppPreferences;
  onPreferenceChange: (patch: Partial<AppPreferences>) => void;
  onSelectFile: (path: string) => void;
  onSelectExperimentRun: (experimentId: string) => void;
  project: Project | null;
  projects: Project[];
  protocols: EvolutionProtocol[];
  sessions: AgentSession[];
  trainingRuns: ExperimentRun[];
};

function formatAccuracy(run: ExperimentRun) {
  return `${Math.round((run.metrics.accuracy ?? 0) * 1000) / 10}%`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="activity-detail-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function EmptyActivity({ children }: { children: string }) {
  return <div className="activity-empty">{children}</div>;
}

function modeName(mode: MainMode) {
  return {
    analysis: "数据分析",
    "machine-learning": "机器学习",
    evolution: "自进化知识",
  }[mode];
}

export function ActivityPanel({
  artifactCount,
  connected,
  eventsCount,
  files,
  gpuStatus,
  injectionLogs,
  lessons,
  preferences,
  onPreferenceChange,
  onSelectFile,
  onSelectExperimentRun,
  project,
  projects,
  protocols,
  sessions,
  trainingRuns,
}: ActivityPanelProps) {
  // 导航态改为直接订阅 uiStore（替代原先经 AppShell 钻取的 activity / onSelectMode）。
  const activity = useUiStore((state) => state.activeActivity);
  const onSelectMode = useUiStore((state) => state.setActiveMode);
  const activeFile = useUiStore((state) => state.activeFile);
  const focusedExperimentId = useUiStore((state) => state.focusedExperimentId);
  const info = getActivityPanelInfo(activity);
  const dataFiles = files.filter((file) => file.type === "file" && (file.path.startsWith("data/") || file.path.endsWith(".csv")));
  const highConfidenceLessons = lessons.filter((lesson) => lesson.status === "high_confidence");
  const pendingLessons = lessons.filter((lesson) => lesson.status === "pending_review");

  return (
    <div className="activity-panel">
      <section className="workspace-panel">
        <div className="workspace-header">
          <div>
            <span className="sidebar-kicker">ACTIVITY</span>
            <strong>{info.title}</strong>
          </div>
        </div>
        <p>{info.description}</p>
      </section>

      {activity === "data" ? (
        <section className="workspace-panel">
          <div className="section-header">
            <span className="panel-title">数据文件</span>
            <span className="sidebar-kicker">{dataFiles.length}</span>
          </div>
          <DetailRow label="当前文件" value={activeFile || "未选择"} />
          {dataFiles.length === 0 ? (
            <EmptyActivity>当前项目还没有可识别的数据文件。</EmptyActivity>
          ) : (
            <div className="activity-action-list">
              {dataFiles.slice(0, 8).map((file) => (
                <button className={file.path === activeFile ? "selected" : ""} key={file.path} onClick={() => onSelectFile(file.path)} type="button">
                  <span>{file.name}</span>
                  <small>{file.path}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activity === "experiments" ? (
        <section className="workspace-panel">
          <div className="section-header">
            <span className="panel-title">训练实验</span>
            <span className="sidebar-kicker">{trainingRuns.length}</span>
          </div>
          <DetailRow label="GPU" value={gpuStatus?.status ?? "unknown"} />
          {trainingRuns.length === 0 ? (
            <EmptyActivity>还没有训练实验。切换到机器学习页启动 baseline 或 sklearn 训练。</EmptyActivity>
          ) : (
            <div className="activity-action-list">
              {trainingRuns.slice(0, 6).map((run) => (
                <button
                  className={run.experiment_id === focusedExperimentId ? "selected" : ""}
                  key={run.experiment_id}
                  onClick={() => onSelectExperimentRun(run.experiment_id)}
                  type="button"
                >
                  <span>{run.best_model_name || run.engine}</span>
                  <small>
                    {formatAccuracy(run)} · {run.dataset_path}
                  </small>
                </button>
              ))}
            </div>
          )}
          <button className="activity-primary-button" onClick={() => onSelectMode("machine-learning")} type="button">
            打开机器学习页
          </button>
        </section>
      ) : null}

      {activity === "version" ? (
        <section className="workspace-panel">
          <div className="section-header">
            <span className="panel-title">项目审计</span>
            <span className="sidebar-kicker">{sessions.length} sessions</span>
          </div>
          <DetailRow label="项目 ID" value={project?.id ?? "未选择"} />
          <DetailRow label="工作区" value={project?.workspace_path ?? "未选择"} />
          <DetailRow label="活跃文件" value={activeFile || "未选择"} />
          <DetailRow label="事件数" value={String(eventsCount)} />
          <DetailRow label="产物数" value={String(artifactCount)} />
        </section>
      ) : null}

      {activity === "knowledge" ? (
        <section className="workspace-panel">
          <div className="section-header">
            <span className="panel-title">自进化知识</span>
            <span className="sidebar-kicker">{lessons.length}</span>
          </div>
          <DetailRow label="高置信规则" value={String(highConfidenceLessons.length)} />
          <DetailRow label="待审核经验" value={String(pendingLessons.length)} />
          <DetailRow label="注入审计" value={String(injectionLogs.length)} />
          <DetailRow label="协议" value={String(protocols.length)} />
          <button className="activity-primary-button" onClick={() => onSelectMode("evolution")} type="button">
            打开知识图谱
          </button>
        </section>
      ) : null}

      {activity === "account" ? (
        <section className="workspace-panel">
          <div className="section-header">
            <span className="panel-title">开发账户</span>
            <span className="sidebar-kicker">{connected ? "online" : "offline"}</span>
          </div>
          <DetailRow label="用户" value={project?.owner_id ?? "dev-user"} />
          <DetailRow label="当前项目" value={project?.name ?? "未选择"} />
          <DetailRow label="项目数" value={String(projects.length)} />
          <DetailRow label="WebSocket" value={connected ? "Connected" : "Disconnected"} />
        </section>
      ) : null}

      {activity === "settings" ? (
        <section className="workspace-panel">
          <div className="section-header">
            <span className="panel-title">本地设置</span>
            <span className="sidebar-kicker">runtime</span>
          </div>
          <DetailRow label="前端" value="http://127.0.0.1:5174/" />
          <DetailRow label="后端 API" value="http://127.0.0.1:8000" />
          <DetailRow label="API 文档" value="http://127.0.0.1:8000/docs" />
          <DetailRow label="GPU 状态" value={gpuStatus?.status ?? "unknown"} />
          <DetailRow label="活跃文件" value={activeFile || "未选择"} />
          <div className="activity-form-grid">
            <label>
              默认启动模式
              <select
                aria-label="默认启动模式"
                value={preferences.defaultMode}
                onChange={(event) => onPreferenceChange({ defaultMode: event.target.value as MainMode })}
              >
                <option value="analysis">数据分析</option>
                <option value="machine-learning">机器学习</option>
                <option value="evolution">自进化知识</option>
              </select>
            </label>
            <label>
              默认目标列
              <input
                aria-label="默认目标列"
                value={preferences.defaultTargetColumn}
                onChange={(event) => onPreferenceChange({ defaultTargetColumn: event.target.value })}
              />
            </label>
            <label>
              GPU 刷新间隔
              <select
                aria-label="GPU 刷新间隔"
                value={preferences.gpuRefreshIntervalMs}
                onChange={(event) => onPreferenceChange({ gpuRefreshIntervalMs: Number(event.target.value) })}
              >
                {gpuRefreshIntervalOptions.map((interval) => (
                  <option key={interval} value={interval}>
                    {interval / 1000}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="activity-empty">
            下次打开应用将默认进入{modeName(preferences.defaultMode)}；训练面板会优先使用当前默认目标列。
          </div>
          <div className="activity-button-grid">
            <button onClick={() => onSelectMode("analysis")} type="button">
              数据分析
            </button>
            <button onClick={() => onSelectMode("machine-learning")} type="button">
              机器学习
            </button>
            <button onClick={() => onSelectMode("evolution")} type="button">
              自进化知识
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
