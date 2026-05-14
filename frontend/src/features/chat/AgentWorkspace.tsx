import { Bot, CheckCircle2, Database, FileCode2, SendHorizontal, Sparkles, UserRound } from "lucide-react";
import { useMemo, useState } from "react";

import type { AgentStreamEvent } from "./types";

type AgentWorkspaceProps = {
  activeFile: string;
  mode: "analysis" | "machine-learning";
  connected: boolean;
  events: AgentStreamEvent[];
  lastError: string | null;
  projectId?: string;
  sendMessage: (
    content: string,
    context: { projectId?: string; activeFile?: string },
  ) => void;
};

const modeCopy = {
  analysis: {
    title: "数据分析 Agent",
    description: "面向当前项目文件执行探索、清洗、统计分析和经验沉淀。",
    assistant:
      "我会先完成数据概览和质量检测，然后把结果同步到右侧图表、数据和日志面板。你也可以直接在底部输入新的分析需求。",
    plan: ["加载数据并概览", "检测缺失值", "分析字段相关性", "生成清洗建议", "沉淀可复用经验"],
    tools: ["load_data()", "profile_dataset()", "detect_missing()", "correlation_matrix()"],
    primaryQuick: "示例分析",
    secondaryQuick: "清洗与特征",
    tertiaryQuick: "建模评估",
    primaryPrompt: (file: string) => `分析 ${file} 的缺失值和相关性`,
    secondaryPrompt: (file: string) => `为 ${file} 生成清洗方案和特征工程建议`,
    tertiaryPrompt: (file: string) => `根据 ${file} 判断是否适合进入机器学习建模`,
    code: (file: string) => `import pandas as pd

df = pd.read_csv('${file}')
profile = df.describe(include='all')
missing = df.isnull().mean().sort_values(ascending=False)
corr = df.select_dtypes('number').corr()`,
  },
  "machine-learning": {
    title: "ML 训练 Agent",
    description: "基于清洗后的数据设计训练计划、选择模型、跟踪实验并导出模型产物。",
    assistant:
      "我会先确认目标列、数据切分和评估指标，再启动 baseline/sklearn 训练；如果需要 GPU，会在训练前明确请求。",
    plan: ["确认目标列与任务类型", "划分 Train/Valid/Test", "训练 baseline", "比较 sklearn 候选模型", "导出最佳模型与实验经验"],
    tools: ["load_data()", "build_features()", "train_baseline()", "train_sklearn()"],
    primaryQuick: "启动训练计划",
    secondaryQuick: "申请 GPU",
    tertiaryQuick: "对比实验",
    primaryPrompt: (file: string) => `基于 ${file} 制定 churn 预测训练计划`,
    secondaryPrompt: (file: string) => `评估 ${file} 是否需要 GPU 训练，并说明原因`,
    tertiaryPrompt: (file: string) => `对 ${file} 的历史实验进行模型对比和导出建议`,
    code: (file: string) => `from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier

df = pd.read_csv('${file}')
X = df.drop(columns=['churn'])
y = df['churn']
X_train, X_valid, y_train, y_valid = train_test_split(X, y, stratify=y)`,
  },
};
const sampleRows = [
  ["7590-VHVEG", "1", "29.85", "No"],
  ["5575-GNVDE", "34", "56.95", "No"],
  ["3668-QPYBK", "2", "53.85", "Yes"],
  ["7795-CFOCW", "45", "42.30", "No"],
];

export function AgentWorkspace({
  activeFile,
  mode,
  connected,
  events,
  lastError,
  projectId,
  sendMessage,
}: AgentWorkspaceProps) {
  const copy = modeCopy[mode];
  const [draft, setDraft] = useState("");
  const message = events
    .filter((event) => event.type === "message_delta")
    .map((event) => event.delta)
    .join("");
  const toolEvents = events.filter(
    (event) => event.type === "tool_call_started" || event.type === "tool_call_finished",
  );
  const progressEvents = events.filter((event) => event.type === "task_progress");
  const latestProgress = progressEvents.at(-1);
  const toolNames = useMemo(() => {
    const names = toolEvents
      .map((event) => (event.type === "tool_call_started" ? event.tool : event.result_ref ?? event.status))
      .filter(Boolean);
    return names.length > 0 ? names : copy.tools;
  }, [copy.tools, toolEvents]);

  function submit(content = draft) {
    const text = content.trim();
    if (!text || !connected || !projectId) return;
    sendMessage(text, { projectId, activeFile });
    setDraft("");
  }

  return (
    <main className="agent-workspace">
      <div className="agent-header workbench-header">
        <div>
          <h2>
            <Bot size={18} />
            {copy.title}
          </h2>
          <p>{copy.description}</p>
        </div>
        <div className="runtime-chips" aria-label="运行环境">
          <span className="runtime-chip ready">Kernel: Python 3.11</span>
          <span className="runtime-chip">Tools: 20</span>
          <span className="runtime-chip muted">GPU: 未启用</span>
        </div>
      </div>

      {lastError ? <div className="inline-alert">{lastError}</div> : null}

      <div className="conversation-stream">
        <div className="chat-row user">
          <div className="avatar user-avatar">
            <UserRound size={16} />
          </div>
          <div className="message-card user-message">
            <span className="message-label">你 · 10:21</span>
            请分析 <code>{activeFile}</code> 的缺失值、字段类型和相关性，并给出可执行的数据处理建议。
          </div>
        </div>

        <div className="chat-row agent">
          <div className="avatar agent-avatar">
            <Sparkles size={16} />
          </div>
          <div className="message-card agent-message">
            <span className="message-label">数据分析 Agent · 10:21</span>
            <p>
              {message ||
                copy.assistant}
            </p>
            <div className="plan-card">
              <div className="panel-title">执行计划</div>
              <div className="plan-grid">
                {copy.plan.map((step, index) => (
                  <span key={step}>
                    <CheckCircle2 size={14} />
                    {index + 1}. {step}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="analysis-grid" aria-label="分析结果预览">
        <div className="workbench-card">
          <div className="card-heading">
            <Database size={15} />
            数据预览（前 4 行）
          </div>
          <div className="compact-table">
            <table>
              <thead>
                <tr>
                  <th>customer_id</th>
                  <th>tenure</th>
                  <th>monthly_charges</th>
                  <th>churn</th>
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row) => (
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

        <div className="workbench-card">
          <div className="card-heading">
            <FileCode2 size={15} />
            分析代码
          </div>
          <pre className="code-preview">{copy.code(activeFile)}</pre>
        </div>
      </section>

      <div className="tool-strip">
        {toolNames.map((tool, index) => (
          <span key={`${tool}-${index}`} className="tool-chip">
            {tool}
          </span>
        ))}
        {latestProgress ? <span className="tool-chip progress">{Math.round(latestProgress.progress * 100)}% · {latestProgress.label}</span> : null}
      </div>

      <div className="composer">
        <textarea
          aria-label="Agent 输入"
          placeholder="输入你的数据分析需求，或输入 / 查看可用命令"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          aria-label="发送消息"
          disabled={!connected || !projectId || !draft.trim()}
          onClick={() => submit()}
          title="发送"
          type="button"
        >
          <SendHorizontal size={17} />
        </button>
      </div>

      <div className="quick-actions">
        <button disabled={!connected || !projectId} onClick={() => submit(copy.primaryPrompt(activeFile))}>
          {copy.primaryQuick}
        </button>
        <button disabled={!connected || !projectId} onClick={() => submit(copy.secondaryPrompt(activeFile))}>
          {copy.secondaryQuick}
        </button>
        <button disabled={!connected || !projectId} onClick={() => submit(copy.tertiaryPrompt(activeFile))}>
          {copy.tertiaryQuick}
        </button>
      </div>
    </main>
  );
}
