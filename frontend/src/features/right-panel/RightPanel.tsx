import { useEffect, useMemo, useState } from "react";

import { readProjectFileContent, type ExperimentRun, type TrainingResult } from "../../lib/api";
import type { AgentStreamEvent, Artifact } from "../chat/types";
import { LogPanel } from "../logs/LogPanel";

const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;
type TrainingEngine = "baseline" | "sklearn";

type RightPanelProps = {
  activeFile: string;
  events: AgentStreamEvent[];
  projectId?: string;
  trainingError: string | null;
  trainingResult: TrainingResult | null;
  trainingRuns: ExperimentRun[];
  onTrainModel: (targetColumn: string, engine: TrainingEngine, useGpu: boolean) => Promise<void>;
};

function artifactEvents(events: AgentStreamEvent[]) {
  return events
    .filter((event): event is Extract<AgentStreamEvent, { type: "artifact_created" }> => {
      return event.type === "artifact_created";
    })
    .map((event) => event.artifact);
}

function ArtifactList({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: Artifact[];
  selectedId?: string;
  onSelect: (artifact: Artifact) => void;
}) {
  if (artifacts.length === 0) {
    return <div className="empty-state">当前还没有可展示的产物。</div>;
  }

  return (
    <div className="artifact-list compact">
      {artifacts.map((artifact) => (
        <button
          className={artifact.id === selectedId ? "artifact-card selected" : "artifact-card"}
          key={artifact.id}
          onClick={() => onSelect(artifact)}
        >
          <div>
            <strong>{artifact.name}</strong>
            <span>{artifact.type}</span>
          </div>
          <code>{artifact.path}</code>
          <small>{artifact.created_at}</small>
        </button>
      ))}
    </div>
  );
}

function JsonTable({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") {
    return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
  }

  if (
    "sample" in value &&
    Array.isArray(value.sample) &&
    value.sample.length > 0 &&
    typeof value.sample[0] === "object"
  ) {
    const rows = value.sample as Record<string, unknown>[];
    const columns = Object.keys(rows[0]);
    return (
      <div className="data-preview">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column}>{String(row[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if ("columns" in value && "matrix" in value && Array.isArray(value.columns) && Array.isArray(value.matrix)) {
    const columns = value.columns as string[];
    const matrix = value.matrix as number[][];
    return (
      <div className="data-preview">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, index) => (
              <tr key={columns[index]}>
                <th>{columns[index]}</th>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if ("columns" in value && value.columns && typeof value.columns === "object") {
    return (
      <div className="data-preview">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>缺失数</th>
              <th>缺失率</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(value.columns as Record<string, { missing_count?: number; missing_ratio?: number }>).map(
              ([column, profile]) => (
                <tr key={column}>
                  <td>{column}</td>
                  <td>{profile.missing_count ?? 0}</td>
                  <td>{((profile.missing_ratio ?? 0) * 100).toFixed(2)}%</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function ArtifactPreview({
  artifact,
  content,
  error,
}: {
  artifact?: Artifact;
  content: string | null;
  error: string | null;
}) {
  if (!artifact) {
    return null;
  }
  if (error) {
    return <div className="empty-state">{error}</div>;
  }
  if (!content) {
    return <div className="empty-state">正在读取产物内容...</div>;
  }

  try {
    return <JsonTable value={JSON.parse(content)} />;
  } catch {
    return <pre className="json-preview">{content}</pre>;
  }
}

function TrainingPanel({
  activeFile,
  disabled,
  error,
  result,
  runs,
  onTrainModel,
}: {
  activeFile: string;
  disabled: boolean;
  error: string | null;
  result: TrainingResult | null;
  runs: ExperimentRun[];
  onTrainModel: (targetColumn: string, engine: TrainingEngine, useGpu: boolean) => Promise<void>;
}) {
  const [targetColumn, setTargetColumn] = useState("churn");
  const [engine, setEngine] = useState<TrainingEngine>("sklearn");
  const [useGpu, setUseGpu] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submitTraining() {
    setSubmitting(true);
    try {
      await onTrainModel(targetColumn, engine, useGpu);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="training-panel">
      <div className="segmented-control" aria-label="训练引擎">
        <button className={engine === "sklearn" ? "active" : ""} onClick={() => setEngine("sklearn")}>
          sklearn 实验
        </button>
        <button className={engine === "baseline" ? "active" : ""} onClick={() => setEngine("baseline")}>
          快速 baseline
        </button>
      </div>
      <div className="training-form">
        <label>
          目标列
          <input value={targetColumn} onChange={(event) => setTargetColumn(event.target.value)} />
        </label>
        <button disabled={disabled || submitting || !targetColumn} onClick={submitTraining}>
          {submitting ? "训练中..." : engine === "sklearn" ? "启动 sklearn 训练" : "训练 baseline"}
        </button>
      </div>
      <label className="gpu-toggle">
        <input
          checked={useGpu}
          disabled={engine !== "sklearn"}
          type="checkbox"
          onChange={(event) => setUseGpu(event.target.checked)}
        />
        <span>请求 GPU 执行</span>
      </label>
      <div className="training-snapshot">
        <div>
          <span>数据集</span>
          <strong>{activeFile}</strong>
        </div>
        <div>
          <span>引擎</span>
          <strong>{result?.engine ?? engine}</strong>
        </div>
        <div>
          <span>GPU</span>
          <strong>{result?.use_gpu || useGpu ? "已请求" : "未请求"}</strong>
        </div>
        <div>
          <span>状态</span>
          <strong>{result ? "已完成" : "等待建模任务"}</strong>
        </div>
      </div>
      {error ? <div className="inline-alert">{error}</div> : null}
      {result ? (
        <>
          <div className="metrics-grid">
            <div>
              <span>Accuracy</span>
              <strong>{(result.metrics.accuracy * 100).toFixed(2)}%</strong>
            </div>
            <div>
              <span>F1 weighted</span>
              <strong>{result.metrics.f1_weighted !== undefined ? `${(result.metrics.f1_weighted * 100).toFixed(2)}%` : "-"}</strong>
            </div>
            <div>
              <span>Rows</span>
              <strong>{result.metrics.row_count}</strong>
            </div>
            <div>
              <span>Classes</span>
              <strong>{result.metrics.class_count}</strong>
            </div>
            <div>
              <span>Best Model</span>
              <strong>{String(result.model.strategy ?? result.model.algorithm)}</strong>
            </div>
          </div>
          <div className="model-compare">
            <div className="panel-title">模型对比</div>
            <table>
              <thead>
                <tr>
                  <th>模型</th>
                  <th>Accuracy</th>
                  <th>F1</th>
                  <th>样本</th>
                </tr>
              </thead>
              <tbody>
                {[...result.runs]
                  .sort((left, right) => right.metrics.accuracy - left.metrics.accuracy)
                  .map((run) => (
                    <tr key={run.model_name}>
                      <td>{run.model_name}</td>
                      <td>{(run.metrics.accuracy * 100).toFixed(2)}%</td>
                      <td>{run.metrics.f1_weighted !== undefined ? `${(run.metrics.f1_weighted * 100).toFixed(2)}%` : "-"}</td>
                      <td>{run.metrics.row_count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <div className="model-compare">
        <div className="panel-title">历史实验</div>
        {runs.length === 0 ? (
          <div className="empty-state compact-empty">还没有训练记录。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>引擎</th>
                <th>最佳模型</th>
                <th>Accuracy</th>
                <th>GPU</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.experiment_id}>
                  <td>{run.engine}</td>
                  <td>{run.best_model_name}</td>
                  <td>{(run.metrics.accuracy * 100).toFixed(2)}%</td>
                  <td>{run.use_gpu ? "是" : "否"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function RightPanel({
  activeFile,
  events,
  projectId,
  trainingError,
  trainingResult,
  trainingRuns,
  onTrainModel,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("日志");
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | undefined>();
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const artifacts = useMemo(() => artifactEvents(events), [events]);
  const chartArtifacts = artifacts.filter((artifact) => artifact.type === "chart");
  const dataArtifacts = artifacts.filter((artifact) => artifact.type === "dataframe");
  const codeArtifacts = artifacts.filter((artifact) => artifact.type === "code");
  const activeArtifacts =
    activeTab === "图表" ? chartArtifacts : activeTab === "数据" ? dataArtifacts : codeArtifacts;

  useEffect(() => {
    if (!["图表", "代码", "数据"].includes(activeTab)) {
      setSelectedArtifact(undefined);
      return;
    }
    if (!selectedArtifact || !activeArtifacts.some((artifact) => artifact.id === selectedArtifact.id)) {
      setSelectedArtifact(activeArtifacts[0]);
    }
  }, [activeArtifacts, activeTab, selectedArtifact]);

  useEffect(() => {
    if (!projectId || !selectedArtifact) {
      setArtifactContent(null);
      return;
    }

    let cancelled = false;
    setArtifactContent(null);
    setArtifactError(null);
    readProjectFileContent(projectId, selectedArtifact.path)
      .then((result) => {
        if (!cancelled) setArtifactContent(result.content);
      })
      .catch((error) => {
        if (!cancelled) {
          setArtifactError(error instanceof Error ? error.message : "产物读取失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedArtifact]);

  return (
    <section className="right-panel">
      <div className="right-tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={tab === activeTab ? "active" : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      {activeTab === "图表" ? (
        <>
          <ArtifactList
            artifacts={chartArtifacts}
            selectedId={selectedArtifact?.id}
            onSelect={setSelectedArtifact}
          />
          <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
        </>
      ) : null}
      {activeTab === "代码" ? (
        <>
          <ArtifactList
            artifacts={codeArtifacts}
            selectedId={selectedArtifact?.id}
            onSelect={setSelectedArtifact}
          />
          <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
        </>
      ) : null}
      {activeTab === "数据" ? (
        <>
          <ArtifactList
            artifacts={dataArtifacts}
            selectedId={selectedArtifact?.id}
            onSelect={setSelectedArtifact}
          />
          <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
        </>
      ) : null}
      {activeTab === "训练" ? (
        <TrainingPanel
          activeFile={activeFile}
          disabled={!projectId}
          error={trainingError}
          result={trainingResult}
          runs={trainingRuns}
          onTrainModel={onTrainModel}
        />
      ) : null}
      {activeTab === "日志" ? <LogPanel events={events} /> : null}
    </section>
  );
}
