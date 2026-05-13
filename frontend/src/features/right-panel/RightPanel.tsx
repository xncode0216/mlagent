import { useMemo, useState } from "react";

import type { AgentStreamEvent, Artifact } from "../chat/types";
import { LogPanel } from "../logs/LogPanel";

const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;

type RightPanelProps = {
  events: AgentStreamEvent[];
};

function artifactEvents(events: AgentStreamEvent[]) {
  return events
    .filter((event): event is Extract<AgentStreamEvent, { type: "artifact_created" }> => {
      return event.type === "artifact_created";
    })
    .map((event) => event.artifact);
}

function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return <div className="empty-state">当前还没有可展示的产物。</div>;
  }

  return (
    <div className="artifact-list">
      {artifacts.map((artifact) => (
        <article className="artifact-card" key={artifact.id}>
          <div>
            <strong>{artifact.name}</strong>
            <span>{artifact.type}</span>
          </div>
          <code>{artifact.path}</code>
          <small>{artifact.created_at}</small>
        </article>
      ))}
    </div>
  );
}

export function RightPanel({ events }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("日志");
  const artifacts = useMemo(() => artifactEvents(events), [events]);
  const chartArtifacts = artifacts.filter((artifact) => artifact.type === "chart");
  const dataArtifacts = artifacts.filter((artifact) => artifact.type === "dataframe");
  const codeArtifacts = artifacts.filter((artifact) => artifact.type === "code");

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
      {activeTab === "图表" ? <ArtifactList artifacts={chartArtifacts} /> : null}
      {activeTab === "代码" ? <ArtifactList artifacts={codeArtifacts} /> : null}
      {activeTab === "数据" ? <ArtifactList artifacts={dataArtifacts} /> : null}
      {activeTab === "训练" ? (
        <div className="training-snapshot">
          <div>
            <span>状态</span>
            <strong>等待建模任务</strong>
          </div>
          <div>
            <span>GPU</span>
            <strong>按需申请</strong>
          </div>
          <div>
            <span>模型对比</span>
            <strong>待接入</strong>
          </div>
        </div>
      ) : null}
      {activeTab === "日志" ? <LogPanel events={events} /> : null}
    </section>
  );
}
