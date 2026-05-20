import { BarChart3, Database, Download, FileText, LineChart, Play, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  readProjectFileContent,
  updateProjectFileContent,
  type ExperimentRun,
  type ProjectFileContent,
  type TrainingResult,
} from "../../lib/api";
import type { AgentStreamEvent, Artifact } from "../chat/types";
import { LogPanel } from "../logs/LogPanel";

const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;
type TrainingEngine = "baseline" | "sklearn";

type RightPanelProps = {
  activeFile: string;
  events: AgentStreamEvent[];
  mode: "analysis" | "machine-learning" | "evolution";
  projectId?: string;
  sessionId?: string;
  trainingError: string | null;
  trainingResult: TrainingResult | null;
  trainingRuns: ExperimentRun[];
  onCleanDataset: () => Promise<void>;
  onGenerateReport: () => Promise<void>;
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

  if ("chart_type" in value && value.chart_type === "histogram" && "bins" in value && Array.isArray(value.bins)) {
    const bins = value.bins as Array<{ start?: number; end?: number; count?: number }>;
    const maxCount = Math.max(1, ...bins.map((bin) => Number(bin.count ?? 0)));
    const summary =
      "summary" in value && value.summary && typeof value.summary === "object"
        ? (value.summary as Record<string, unknown>)
        : {};
    return (
      <div className="artifact-chart">
        <div className="dataset-strip">
          <span>分布字段</span>
          <strong>{"column" in value ? String(value.column ?? "-") : "-"}</strong>
        </div>
        <div className="artifact-histogram" aria-label="真实数据分布图">
          {bins.map((bin, index) => (
            <span
              key={`${bin.start}-${bin.end}-${index}`}
              style={{ height: `${Math.max(8, ((bin.count ?? 0) / maxCount) * 100)}%` }}
              title={`${Number(bin.start ?? 0).toFixed(2)} - ${Number(bin.end ?? 0).toFixed(2)}: ${bin.count ?? 0}`}
            />
          ))}
        </div>
        <div className="chart-summary">
          <span>均值 {typeof summary.mean === "number" ? summary.mean.toFixed(2) : "-"}</span>
          <span>中位数 {typeof summary.median === "number" ? summary.median.toFixed(2) : "-"}</span>
          <span>非空 {String(summary.non_null_count ?? "-")}</span>
        </div>
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

function formatFileSize(size?: number) {
  if (typeof size !== "number") return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function parseCsvPreview(content: string, maxRows = 50) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      if (rows.length > maxRows) break;
      continue;
    }
    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headers = [], ...body] = rows.filter((item) => item.some((cell) => cell.length > 0));
  return { headers, rows: body.slice(0, maxRows) };
}

function CsvFilePreview({ content }: { content: string }) {
  const preview = useMemo(() => parseCsvPreview(content), [content]);
  if (preview.headers.length === 0) return <div className="empty-state compact-empty">CSV 文件为空。</div>;

  return (
    <div className="data-preview">
      <table>
        <thead>
          <tr>
            {preview.headers.map((header, index) => (
              <th key={`${header}-${index}`}>{header || `列 ${index + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {preview.headers.map((_, columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActiveFilePreview({
  activeFile,
  mode,
  projectId,
}: {
  activeFile: string;
  mode: "code" | "data";
  projectId?: string;
}) {
  const [fileContent, setFileContent] = useState<ProjectFileContent | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!projectId || !activeFile) {
      setFileContent(null);
      return;
    }

    let cancelled = false;
    setFileContent(null);
    setError(null);
    readProjectFileContent(projectId, activeFile)
      .then((result) => {
        if (!cancelled) {
          setFileContent(result);
          setDraftContent(result.content);
          setSaveState("idle");
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "文件读取失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFile, projectId]);

  async function saveFile() {
    if (!projectId || !fileContent) return;
    setSaveState("saving");
    setError(null);
    try {
      const result = await updateProjectFileContent(projectId, fileContent.path, draftContent);
      setFileContent(result);
      setDraftContent(result.content);
      setSaveState("saved");
    } catch (nextError) {
      setSaveState("error");
      setError(nextError instanceof Error ? nextError.message : "文件保存失败");
    }
  }

  if (!projectId) return <div className="empty-state">请选择项目后查看文件内容。</div>;
  if (!activeFile) return <div className="empty-state">请选择一个文件。</div>;
  if (error) return <div className="empty-state">{error.includes("415") ? "当前文件是二进制内容，暂不支持直接预览。" : error}</div>;
  if (!fileContent) return <div className="empty-state">正在读取 {activeFile}...</div>;

  const isCsv = activeFile.toLowerCase().endsWith(".csv") || fileContent.mime_type === "text/csv";
  const isJson = activeFile.toLowerCase().endsWith(".json") || fileContent.mime_type === "application/json";

  return (
    <div className={mode === "data" ? "data-workspace" : "code-workspace"}>
      <div className="dataset-strip">
        <span>当前文件</span>
        <strong title={fileContent.path}>{fileContent.path}</strong>
      </div>
      <div className="file-meta-row">
        <span>{fileContent.mime_type}</span>
        <span>{formatFileSize(fileContent.size)}</span>
        {mode === "code" && draftContent !== fileContent.content ? <span>未保存</span> : null}
        {mode === "code" && saveState === "saved" ? <span>已保存</span> : null}
      </div>
      {mode === "data" && isCsv ? <CsvFilePreview content={fileContent.content} /> : null}
      {mode === "data" && isJson ? (
        (() => {
          try {
            return <JsonTable value={JSON.parse(fileContent.content)} />;
          } catch {
            return <pre className="json-preview">{fileContent.content}</pre>;
          }
        })()
      ) : null}
      {mode === "data" && !isCsv && !isJson ? (
        <pre className="json-preview">{fileContent.content}</pre>
      ) : null}
      {mode === "code" ? (
        <div className="code-editor">
          <textarea
            aria-label="文件内容编辑器"
            spellCheck={false}
            value={draftContent}
            onChange={(event) => {
              setDraftContent(event.target.value);
              setSaveState("idle");
            }}
          />
          <div className="editor-actions">
            <button disabled={saveState === "saving" || draftContent === fileContent.content} onClick={() => void saveFile()}>
              {saveState === "saving" ? "保存中..." : "保存文件"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DemoChartGallery({
  onCleanDataset,
  onGenerateReport,
}: {
  onCleanDataset: () => Promise<void>;
  onGenerateReport: () => Promise<void>;
}) {
  const bars = [18, 42, 68, 86, 76, 58, 35, 20, 12];
  const heatCells = Array.from({ length: 42 }, (_, index) => (index % 9 === 0 ? "hot" : index % 5 === 0 ? "warm" : ""));
  const [submitting, setSubmitting] = useState<"report" | "clean" | null>(null);

  async function generateReport() {
    setSubmitting("report");
    try {
      await onGenerateReport();
    } finally {
      setSubmitting(null);
    }
  }

  async function cleanDataset() {
    setSubmitting("clean");
    try {
      await onCleanDataset();
    } finally {
      setSubmitting(null);
    }
  }

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
        <button disabled={submitting !== null} onClick={() => void generateReport()}>
          <FileText size={15} />
          {submitting === "report" ? "生成中..." : "生成报告"}
        </button>
        <button disabled={submitting !== null} onClick={() => void cleanDataset()}>
          <Database size={15} />
          {submitting === "clean" ? "清洗中..." : "清洗数据"}
        </button>
        <button>
          <Play size={15} />
          传给 ML Agent
        </button>
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
  sessionId,
  trainingError,
  trainingResult,
  trainingRuns,
  onCleanDataset,
  onGenerateReport,
  onTrainModel,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("图表");
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | undefined>();
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const artifacts = useMemo(() => artifactEvents(events), [events]);
  const chartArtifacts = artifacts.filter((artifact) => artifact.type === "chart");
  const dataArtifacts = artifacts.filter((artifact) => artifact.type === "dataframe");
  const codeArtifacts = artifacts.filter((artifact) => ["code", "markdown", "report"].includes(artifact.type));
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
            <DemoChartGallery onCleanDataset={onCleanDataset} onGenerateReport={onGenerateReport} />
          )}
        </>
      ) : null}
      {activeTab === "代码" ? (
        <>
          <ArtifactList artifacts={codeArtifacts} selectedId={selectedArtifact?.id} onSelect={setSelectedArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
          ) : (
            <ActiveFilePreview activeFile={activeFile} mode="code" projectId={projectId} />
          )}
        </>
      ) : null}
      {activeTab === "数据" ? (
        <>
          <ArtifactList artifacts={dataArtifacts} selectedId={selectedArtifact?.id} onSelect={setSelectedArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview artifact={selectedArtifact} content={artifactContent} error={artifactError} />
          ) : (
            <ActiveFilePreview activeFile={activeFile} mode="data" projectId={projectId} />
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
      {activeTab === "日志" ? <LogPanel events={events} sessionId={sessionId} /> : null}
      <div className="right-panel-footer">
        <button>
          <Download size={14} />
          导出当前面板
        </button>
      </div>
    </section>
  );
}
