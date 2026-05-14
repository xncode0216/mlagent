import { BarChart3, Code2, Database, Download, FileText, LineChart, Play, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { readProjectFileContent, type ExperimentRun, type TrainingResult } from "../../lib/api";
import type { AgentStreamEvent, Artifact } from "../chat/types";
import { LogPanel } from "../logs/LogPanel";

const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;
type TrainingEngine = "baseline" | "sklearn";

type RightPanelProps = {
  activeFile: string;
  events: AgentStreamEvent[];
  mode: "analysis" | "machine-learning" | "evolution";
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
  if (artifacts.length === 0) return null;

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
              <th>缺失数量</th>
              <th>缺失比例</th>
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
  if (!artifact) return null;
  if (error) return <div className="empty-state">{error}</div>;
  if (!content) return <div className="empty-state">正在读取产物内容...</div>;

  try {
    return <JsonTable value={JSON.parse(content)} />;
  } catch {
    return <pre className="json-preview">{content}</pre>;
  }
}

function DemoChartGallery() {
  const bars = [18, 42, 68, 86, 76, 58, 35, 20, 12];
  const heatCells = Array.from({ length: 42 }, (_, index) => (index % 9 === 0 ? "hot" : index % 5 === 0 ? "warm" : ""));

  return (
    <div className="chart-gallery">
      <section className="visual-card wide">
        <div className="card-heading">
          <BarChart3 size={15} />
          缺失值热力图
        </div>
        <div className="heatmap-grid" aria-label="缺失值热力图">
          {heatCells.map((state, index) => (
            <span key={index} className={state} />
          ))}
        </div>
      </section>
      <section className="visual-card">
        <div className="card-heading">
          <LineChart size={15} />
          月费分布
        </div>
        <div className="histogram" aria-label="月费分布">
          {bars.map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      </section>
      <section className="visual-card">
        <div className="card-heading">
          <Table2 size={15} />
          特征相关性
        </div>
        <div className="correlation-grid" aria-label="特征相关性矩阵">
          {["1.00", "-0.25", "0.83", "-0.35", "0.65", "1.00", "0.19", "-0.20", "0.42"].map((value, index) => (
            <span key={`${value}-${index}`}>{value}</span>
          ))}
        </div>
      </section>
      <div className="panel-actions">
        <button>
          <FileText size={15} />
          生成报告
        </button>
        <button>
          <Database size={15} />
          清洗数据
        </button>
        <button>
          <Play size={15} />
          传给 ML Agent
        </button>
      </div>
    </div>
  );
}

function CodeWorkspace({ activeFile }: { activeFile: string }) {
  return (
    <div className="code-workspace">
      <div className="card-heading">
        <Code2 size={15} />
        可复现分析脚本
      </div>
      <pre className="json-preview code-panel">{`import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt

df = pd.read_csv("${activeFile}")
profile = df.describe(include="all")
missing = df.isnull().mean().sort_values(ascending=False)
corr = df.select_dtypes("number").corr()

print(profile.head())
print(missing.head(10))`}</pre>
    </div>
  );
}

function DataWorkspace({ activeFile }: { activeFile: string }) {
  const rows = [
    ["customer_id", "object", "0", "唯一客户编号"],
    ["tenure", "int64", "0", "客户在网时长"],
    ["monthly_charges", "float64", "0", "月费金额"],
    ["total_charges", "float64", "11", "累计费用"],
    ["churn", "category", "0", "是否流失"],
  ];
  return (
    <div className="data-workspace">
      <div className="dataset-strip">
        <span>当前数据集</span>
        <strong>{activeFile}</strong>
      </div>
      <div className="data-preview">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>类型</th>
              <th>缺失</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell) => (
                  <td key={cell}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedRun = runs.find((run) => run.experiment_id === selectedRunId) ?? runs[0];
  const featureImportance = Array.isArray(selectedRun?.model.feature_importance)
    ? (selectedRun.model.feature_importance as Array<{ feature?: string; importance?: number }>)
    : [];
  const confusionMatrix = selectedRun?.metrics.confusion_matrix;
  const confusionLabels = confusionMatrix ? Object.keys(confusionMatrix) : [];

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
          <strong>{result ? "已完成" : submitting ? "运行中" : "等待建模任务"}</strong>
        </div>
      </div>
      {error ? <div className="inline-alert">{error}</div> : null}
      {result ? (
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
            <span>Best Model</span>
            <strong>{String(result.model.strategy ?? result.model.algorithm)}</strong>
          </div>
        </div>
      ) : null}
      <div className="model-compare">
        <div className="panel-title">历史实验</div>
        {runs.length === 0 ? (
          <div className="empty-state compact-empty">还没有训练记录，启动一次训练后这里会显示实验历史。</div>
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
                <tr
                  className={run.experiment_id === selectedRun?.experiment_id ? "selected-row" : ""}
                  key={run.experiment_id}
                  onClick={() => setSelectedRunId(run.experiment_id)}
                >
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
      {selectedRun ? (
        <div className="experiment-detail">
          <div className="panel-title">实验详情</div>
          <div className="detail-grid">
            <div>
              <span>实验 ID</span>
              <code>{selectedRun.experiment_id}</code>
            </div>
            <div>
              <span>目标列</span>
              <strong>{selectedRun.target_column}</strong>
            </div>
            <div>
              <span>模型文件</span>
              <code>{selectedRun.model_artifact.path}</code>
            </div>
          </div>
          {featureImportance.length > 0 ? (
            <div className="model-compare nested">
              <div className="panel-title">特征重要性</div>
              <table>
                <tbody>
                  {featureImportance.slice(0, 8).map((item) => (
                    <tr key={String(item.feature)}>
                      <td>{item.feature}</td>
                      <td>{typeof item.importance === "number" ? item.importance.toFixed(4) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {confusionMatrix && confusionLabels.length > 0 ? (
            <div className="model-compare nested">
              <div className="panel-title">混淆矩阵</div>
              <table>
                <thead>
                  <tr>
                    <th>真实 \\ 预测</th>
                    {confusionLabels.map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {confusionLabels.map((label) => (
                    <tr key={label}>
                      <th>{label}</th>
                      {confusionLabels.map((predicted) => (
                        <td key={predicted}>{confusionMatrix[label]?.[predicted] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RightPanel({
  activeFile,
  events,
  mode,
  projectId,
  trainingError,
  trainingResult,
  trainingRuns,
  onTrainModel,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("图表");
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
    setActiveTab(mode === "machine-learning" ? "训练" : mode === "evolution" ? "日志" : "图表");
  }, [mode]);

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
          <ArtifactList artifacts={chartArtifacts} selectedId={selectedArtifact?.id} onSelect={setSelectedArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
          ) : (
            <DemoChartGallery />
          )}
        </>
      ) : null}
      {activeTab === "代码" ? (
        <>
          <ArtifactList artifacts={codeArtifacts} selectedId={selectedArtifact?.id} onSelect={setSelectedArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
          ) : (
            <CodeWorkspace activeFile={activeFile} />
          )}
        </>
      ) : null}
      {activeTab === "数据" ? (
        <>
          <ArtifactList artifacts={dataArtifacts} selectedId={selectedArtifact?.id} onSelect={setSelectedArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
          ) : (
            <DataWorkspace activeFile={activeFile} />
          )}
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
      <div className="right-panel-footer">
        <button>
          <Download size={14} />
          导出当前面板
        </button>
      </div>
    </section>
  );
}
