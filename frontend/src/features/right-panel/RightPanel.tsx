import { useState } from "react";

import type { AgentStreamEvent } from "../chat/types";
import { LogPanel } from "../logs/LogPanel";

const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;

type RightPanelProps = {
  events: AgentStreamEvent[];
};

export function RightPanel({ events }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("日志");

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
      {activeTab === "日志" ? (
        <LogPanel events={events} />
      ) : (
        <div className="empty-state">{activeTab} 面板将在后续任务接入真实 artifact。</div>
      )}
    </section>
  );
}
